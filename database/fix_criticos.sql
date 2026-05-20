-- ============================================================
-- FIX CRITICOS — aplicar sobre la BD de PRODUCCION ya existente
-- ============================================================
-- Para una BD nueva NO se necesita: schema_consolidado.sql ya
-- incorpora estos arreglos. Este script es solo para parchear
-- la instancia Supabase que ya esta corriendo en produccion.
--
-- Ejecutar los 3 bloques. El bloque 1 (ALTER TYPE ADD VALUE)
-- debe correrse SOLO, fuera de cualquier transaccion.
-- ============================================================


-- ------------------------------------------------------------
-- FIX 1 — ENUM estado_cita: agregar 'pendiente_confirmacion'
-- El codigo (script.js) inserta citas con este estado.
-- Idempotente: IF NOT EXISTS evita error si ya existe.
-- ------------------------------------------------------------
ALTER TYPE estado_cita ADD VALUE IF NOT EXISTS 'pendiente_confirmacion';


-- ------------------------------------------------------------
-- FIX 2 — URL de confirmacion: dominio real de produccion
-- Antes apuntaba a https://tubarberia.com (dominio inexistente),
-- el boton del email no funcionaba.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION generar_token_confirmacion(p_id_cita UUID)
RETURNS TABLE (
  token VARCHAR,
  url_confirmacion TEXT,
  fecha_expiracion TIMESTAMPTZ,
  nombre_cliente VARCHAR,
  fecha_cita TIMESTAMPTZ,
  hora_cita TIME,
  barbero_nombre VARCHAR,
  servicio_nombre VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token VARCHAR;
  v_fecha_exp TIMESTAMPTZ;
BEGIN
  v_token := encode(gen_random_bytes(24), 'hex');
  v_fecha_exp := NOW() + INTERVAL '10 minutes';

  RETURN QUERY
  SELECT
    v_token,
    'https://barber-kodde.vercel.app/confirmar?token=' || v_token,
    v_fecha_exp,
    COALESCE(cl.nombre, c.nombre_walkin, 'Cliente'),
    c.fecha_hora_inicio,
    c.fecha_hora_inicio::TIME,
    e.nombre,
    (SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
     FROM detalle_cita dc
     JOIN servicio s ON s.id_servicio = dc.id_servicio
     WHERE dc.id_cita = p_id_cita)
  FROM cita c
  JOIN empleado e ON e.id_empleado = c.id_empleado
  LEFT JOIN cliente cl ON cl.id_cliente = c.id_cliente
  WHERE c.id_cita = p_id_cita;
END;
$$;


-- ------------------------------------------------------------
-- FIX 3 — Seguridad: quitar lectura anonima de tokens
-- Con SELECT para anon, cualquiera con la publishable key podia
-- listar todos los tokens y confirmar citas ajenas. La confirmacion
-- se hace solo via RPC confirmar_cita_por_token (SECURITY DEFINER).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "token_anon_select" ON token_confirmacion_cita;
REVOKE SELECT ON token_confirmacion_cita FROM anon;


-- ------------------------------------------------------------
-- FIX 4 — RPC para buscar cliente por email (multi-servicio wizard)
-- El wizard necesita saber si un email ya pertenece a un cliente
-- REGISTRADO (con Auth) antes de crear un duplicado anonimo.
-- Anon no tiene SELECT directo sobre cliente (RLS), por eso va
-- como SECURITY DEFINER que devuelve lo minimo necesario.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION buscar_cliente_por_email(p_email VARCHAR)
RETURNS TABLE (
  id_cliente   UUID,
  auth_user_id UUID,
  tipo         tipo_cliente
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id_cliente, c.auth_user_id, c.tipo
  FROM cliente c
  WHERE LOWER(c.email) = LOWER(TRIM(p_email));
END;
$$;

GRANT EXECUTE ON FUNCTION buscar_cliente_por_email(VARCHAR) TO anon, authenticated;
