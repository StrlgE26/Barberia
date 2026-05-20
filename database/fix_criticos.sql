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
-- FIX 2 — URL de confirmacion + tipo de retorno
-- Antes apuntaba a https://tubarberia.com (dominio inexistente)
-- y la columna 8 (servicio_nombre) se declaraba VARCHAR pero
-- STRING_AGG retorna TEXT → 42804. Cambio a TEXT.
-- DROP previo porque cambiar tipo de retorno con OR REPLACE falla.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS generar_token_confirmacion(UUID);

CREATE FUNCTION generar_token_confirmacion(p_id_cita UUID)
RETURNS TABLE (
  token VARCHAR,
  url_confirmacion TEXT,
  fecha_expiracion TIMESTAMPTZ,
  nombre_cliente VARCHAR,
  fecha_cita TIMESTAMPTZ,
  hora_cita TIME,
  barbero_nombre VARCHAR,
  servicio_nombre TEXT
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


-- ------------------------------------------------------------
-- FIX 5 — RPC cancelar_mi_cita (cliente cancela su propia cita)
-- El cliente registrado puede cancelar sus citas futuras desde
-- la página /mi-cuenta. Valida ownership comparando auth.uid()
-- con cliente.auth_user_id. SECURITY DEFINER porque las policies
-- de cita solo permiten al cliente SELECT, no UPDATE.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancelar_mi_cita(
  p_id_cita UUID,
  p_motivo  TEXT DEFAULT NULL
)
RETURNS TABLE (
  ok       BOOLEAN,
  mensaje  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_cliente UUID;
  v_estado     estado_cita;
BEGIN
  -- Tomar id_cliente y estado actual
  SELECT c.id_cliente, c.estado
    INTO v_id_cliente, v_estado
  FROM cita c
  WHERE c.id_cita = p_id_cita;

  IF v_id_cliente IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Cita no encontrada'::TEXT;
    RETURN;
  END IF;

  -- Verificar que la cita le pertenece al cliente del JWT actual
  IF NOT EXISTS (
    SELECT 1 FROM cliente
    WHERE id_cliente   = v_id_cliente
      AND auth_user_id = auth.uid()
  ) THEN
    RETURN QUERY SELECT FALSE, 'No tienes permiso para cancelar esta cita'::TEXT;
    RETURN;
  END IF;

  -- Solo se pueden cancelar citas activas
  IF v_estado IN ('completada', 'cancelada', 'no_presentada') THEN
    RETURN QUERY SELECT FALSE, 'Esta cita ya no se puede cancelar'::TEXT;
    RETURN;
  END IF;

  UPDATE cita
  SET estado             = 'cancelada',
      motivo_cancelacion = COALESCE(NULLIF(TRIM(p_motivo), ''), 'Cancelada por el cliente')
  WHERE id_cita = p_id_cita;

  RETURN QUERY SELECT TRUE, 'Cita cancelada exitosamente'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION cancelar_mi_cita(UUID, TEXT) TO authenticated;


-- ------------------------------------------------------------
-- FIX 6 — confirmar_cita_por_token también mueve estado
-- Antes solo seteaba confirmado=TRUE pero dejaba estado en
-- 'pendiente_confirmacion'. El dashboard la seguía viendo como
-- "por confirmar" aunque el cliente ya hubiera confirmado.
-- Ahora también cambia estado → 'pendiente' (cita activa normal).
-- DROP previo porque OR REPLACE no permite cambiar tipos de salida.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS confirmar_cita_por_token(VARCHAR);

CREATE FUNCTION confirmar_cita_por_token(p_token VARCHAR)
RETURNS TABLE (
  exito BOOLEAN,
  mensaje TEXT,
  id_cita UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_cita UUID;
  v_ya_usado BOOLEAN;
  v_expirado BOOLEAN;
BEGIN
  SELECT id_cita, usado, fecha_expiracion < NOW()
  INTO v_id_cita, v_ya_usado, v_expirado
  FROM token_confirmacion_cita
  WHERE token = p_token
  LIMIT 1;

  IF v_id_cita IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Enlace inválido o expirado'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_ya_usado THEN
    RETURN QUERY SELECT FALSE, 'Este enlace ya fue utilizado'::TEXT, v_id_cita;
    RETURN;
  END IF;

  IF v_expirado THEN
    RETURN QUERY SELECT FALSE, 'El enlace expiró. Por favor, reserva nuevamente'::TEXT, v_id_cita;
    RETURN;
  END IF;

  UPDATE cita
  SET confirmado = TRUE,
      estado     = 'pendiente'
  WHERE id_cita = v_id_cita
    AND estado  = 'pendiente_confirmacion';

  UPDATE token_confirmacion_cita
  SET usado = TRUE, fecha_confirmacion = NOW()
  WHERE token = p_token;

  RETURN QUERY SELECT TRUE, 'Cita confirmada exitosamente'::TEXT, v_id_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION confirmar_cita_por_token(VARCHAR) TO anon, authenticated;
