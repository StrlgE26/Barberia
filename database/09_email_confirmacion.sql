-- ============================================================
-- 09_email_confirmacion.sql — SISTEMA DE CONFIRMACIÓN POR EMAIL
-- ============================================================
-- Flujo end-to-end:
--   1. El wizard inserta cita con `estado='pendiente_confirmacion'`.
--   2. La API serverless (api/enviar-confirmacion-cita.js) llama a
--      `generar_token_confirmacion()` para obtener un token + datos
--      formateados del email + URL de confirmación.
--   3. Resend envía el email con un botón "Confirmar Cita" que apunta
--      a /confirmar?token=...
--   4. La página /confirmar invoca `confirmar_cita_por_token()`,
--      que valida el token (no usado, no expirado), mueve el estado
--      a 'pendiente' y marca confirmado=TRUE.
--   5. Job pg_cron (ver 10_limpieza_automatica.sql) ejecuta
--      `cancelar_tokens_expirados()` cada minuto para autocancelar
--      reservas que el cliente nunca confirmó.
--
-- Por qué token y no acceso directo a la cita por UUID:
--   Si solo usáramos id_cita, cualquiera con el ID podría confirmar
--   citas ajenas. El token es un secreto de un solo uso, con TTL
--   de 10 min, que evita ese abuso.
-- ============================================================


-- ============================================================
-- TABLA: token_confirmacion_cita
-- ============================================================
CREATE TABLE IF NOT EXISTS token_confirmacion_cita (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_cita            UUID NOT NULL REFERENCES cita(id_cita) ON DELETE CASCADE,
  token              VARCHAR(255) UNIQUE NOT NULL,
  fecha_creacion     TIMESTAMPTZ DEFAULT NOW(),
  fecha_expiracion   TIMESTAMPTZ NOT NULL,
  usado              BOOLEAN DEFAULT FALSE,
  fecha_confirmacion TIMESTAMPTZ,

  CONSTRAINT token_no_vacio  CHECK (LENGTH(TRIM(token)) > 0),
  CONSTRAINT fechas_validas  CHECK (fecha_expiracion > fecha_creacion)
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_token_confirmacion_token
  ON token_confirmacion_cita(token);
CREATE INDEX IF NOT EXISTS idx_token_confirmacion_id_cita
  ON token_confirmacion_cita(id_cita);
CREATE INDEX IF NOT EXISTS idx_token_confirmacion_expiracion
  ON token_confirmacion_cita(fecha_expiracion);


-- ============================================================
-- RLS de la tabla
-- ============================================================
-- Decisión de seguridad: anon NO tiene SELECT.
-- Si lo tuviera, cualquiera con la publishable key podría listar
-- TODOS los tokens y confirmar citas ajenas. La confirmación se
-- hace exclusivamente vía confirmar_cita_por_token (SECURITY DEFINER).
ALTER TABLE token_confirmacion_cita ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "token_anon_insert" ON token_confirmacion_cita;
DROP POLICY IF EXISTS "token_anon_select" ON token_confirmacion_cita;
DROP POLICY IF EXISTS "token_auth_all"    ON token_confirmacion_cita;

-- anon puede INSERT (la API lo hace tras generar el token)
CREATE POLICY "token_anon_insert"
  ON token_confirmacion_cita FOR INSERT
  TO anon
  WITH CHECK (TRUE);

-- authenticated tiene acceso completo (admin)
CREATE POLICY "token_auth_all"
  ON token_confirmacion_cita FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- Grants (sin SELECT para anon — ver nota de seguridad arriba)
GRANT INSERT          ON token_confirmacion_cita TO anon;
GRANT SELECT, INSERT  ON token_confirmacion_cita TO authenticated;


-- ============================================================
-- generar_token_confirmacion
-- ============================================================
-- Genera token aleatorio + devuelve todos los datos para armar el
-- email (nombre cliente, fecha, hora, barbero, servicios).
--
-- Notas:
--   · STRING_AGG retorna TEXT, por eso servicio_nombre se declara
--     TEXT (no VARCHAR) en RETURNS TABLE — si no, error 42804.
--   · URL del confirmar apunta al dominio de producción.
--   · El INSERT a la tabla token_confirmacion_cita lo hace la API
--     desde fuera (no aquí) para mantener esta función pura.
-- ============================================================
DROP FUNCTION IF EXISTS generar_token_confirmacion(UUID);

CREATE FUNCTION generar_token_confirmacion(p_id_cita UUID)
RETURNS TABLE (
  token             VARCHAR,
  url_confirmacion  TEXT,
  fecha_expiracion  TIMESTAMPTZ,
  nombre_cliente    VARCHAR,
  fecha_cita        TIMESTAMPTZ,
  hora_cita         TIME,
  barbero_nombre    VARCHAR,
  servicio_nombre   TEXT  -- STRING_AGG retorna TEXT, no VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token     VARCHAR;
  v_fecha_exp TIMESTAMPTZ;
BEGIN
  v_token     := encode(gen_random_bytes(24), 'hex');
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
  JOIN empleado e   ON e.id_empleado = c.id_empleado
  LEFT JOIN cliente cl ON cl.id_cliente = c.id_cliente
  WHERE c.id_cita = p_id_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_token_confirmacion(UUID) TO anon, authenticated;


-- ============================================================
-- confirmar_cita_por_token
-- ============================================================
-- Validaciones secuenciales:
--   · Token existe → si no, "Enlace inválido o expirado"
--   · No usado     → si no, "Este enlace ya fue utilizado"
--   · No expirado  → si no, "El enlace expiró"
-- Si pasa, MUEVE el estado de 'pendiente_confirmacion' → 'pendiente'
-- y marca `confirmado=TRUE`. Esto evita que el job de autocancelación
-- la borre.
--
-- ¿Por qué alias `t`/`c`?
--   El RETURNS TABLE declara `id_cita` como columna de salida; sin
--   alias en las queries, Postgres lanza 42702 "column reference is
--   ambiguous" porque también existe la columna en cita y en token.
-- ============================================================
DROP FUNCTION IF EXISTS confirmar_cita_por_token(VARCHAR);

CREATE FUNCTION confirmar_cita_por_token(p_token VARCHAR)
RETURNS TABLE (
  exito   BOOLEAN,
  mensaje TEXT,
  id_cita UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_cita  UUID;
  v_ya_usado BOOLEAN;
  v_expirado BOOLEAN;
BEGIN
  SELECT t.id_cita, t.usado, t.fecha_expiracion < NOW()
  INTO v_id_cita, v_ya_usado, v_expirado
  FROM token_confirmacion_cita t
  WHERE t.token = p_token
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

  -- Mover estado pendiente_confirmacion → pendiente
  UPDATE cita c
  SET confirmado = TRUE,
      estado     = 'pendiente'
  WHERE c.id_cita = v_id_cita
    AND c.estado  = 'pendiente_confirmacion';

  -- Marcar token como usado (prevenir reusos)
  UPDATE token_confirmacion_cita t
  SET usado              = TRUE,
      fecha_confirmacion = NOW()
  WHERE t.token = p_token;

  RETURN QUERY SELECT TRUE, 'Cita confirmada exitosamente'::TEXT, v_id_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION confirmar_cita_por_token(VARCHAR) TO anon, authenticated;


-- ============================================================
-- cancelar_tokens_expirados
-- ============================================================
-- Job idempotente que limpia el sistema:
--   · Cancela citas en 'pendiente_confirmacion' cuyo token expiró
--     y nunca se usó (cliente no abrió el email a tiempo).
--   · Borra tokens viejos (>1 día) para no acumular basura.
--
-- Programado con pg_cron en 10_limpieza_automatica.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION cancelar_tokens_expirados()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE cita
  SET estado             = 'cancelada',
      motivo_cancelacion = 'Reserva no confirmada en tiempo límite'
  WHERE confirmado = FALSE
    AND estado     = 'pendiente_confirmacion'
    AND id_cita IN (
      SELECT id_cita
      FROM token_confirmacion_cita
      WHERE fecha_expiracion < NOW()
        AND usado = FALSE
    );

  DELETE FROM token_confirmacion_cita
  WHERE fecha_expiracion < NOW() - INTERVAL '1 day';
END;
$$;
