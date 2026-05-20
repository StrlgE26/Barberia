-- ============================================================
-- 06_rpc_publicas.sql — RPCs LLAMABLES DESDE ANON
-- ============================================================
-- Funciones que el frontend público (landing, kiosko, página de
-- confirmación de cita) ejecuta sin sesión iniciada.
--
-- Todas son SECURITY DEFINER: corren con permisos de postgres y
-- atraviesan RLS. Esto es necesario porque consultan tablas que
-- anon no puede leer directamente (cliente, bloqueo_telefono).
-- Son seguras porque devuelven solo la información necesaria y
-- no aceptan parámetros peligrosos.
--
-- Lista de RPCs:
--   · obtener_slots_disponibles     — calcula slots libres del barbero
--   · telefono_puede_reservar       — anti-spam (1 cita/día/sucursal)
--   · barbero_disponible            — verifica traslapes
--   · buscar_cliente_por_telefono   — usado al reservar (dedup)
--   · buscar_cliente_por_email      — usado al detectar email con Auth
-- ============================================================


-- ============================================================
-- obtener_slots_disponibles
-- ============================================================
-- Genera los slots de tiempo donde un barbero está disponible en
-- una fecha, dada una duración (suma de servicios del wizard).
--
-- Lógica:
--   1. Día de la semana del p_fecha (en español, locale-independent).
--   2. Trae turno semanal del barbero (horario_barbero).
--   3. Si no trabaja ese día, no retorna nada.
--   4. Itera de hora_inicio a hora_fin en pasos de p_duracion_min:
--      - El slot debe empezar después de NOW() + buffer de la sucursal.
--      - No debe traslapar con citas activas del barbero.
--   5. Devuelve también los slots NO disponibles (con disponible=false)
--      para que el frontend pueda mostrarlos en gris si quisiera.
-- ============================================================
CREATE OR REPLACE FUNCTION obtener_slots_disponibles(
  p_id_empleado  UUID,
  p_fecha        DATE,
  p_duracion_min INT
)
RETURNS TABLE (
  slot_inicio TIMESTAMPTZ,
  slot_fin    TIMESTAMPTZ,
  disponible  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_turno_inicio TIME;
  v_turno_fin    TIME;
  v_dia_semana   dia_semana;
  v_buffer_min   INT;
  v_slot_actual  TIMESTAMPTZ;
  v_slot_fin_ts  TIMESTAMPTZ;
  v_turno_fin_ts TIMESTAMPTZ;
  v_ahora        TIMESTAMPTZ := NOW();
BEGIN
  -- Día de semana en español (DOW: 0=domingo, 1=lunes, ..., 6=sábado)
  v_dia_semana := CASE EXTRACT(DOW FROM p_fecha)
    WHEN 1 THEN 'lunes'
    WHEN 2 THEN 'martes'
    WHEN 3 THEN 'miercoles'
    WHEN 4 THEN 'jueves'
    WHEN 5 THEN 'viernes'
    WHEN 6 THEN 'sabado'
    WHEN 0 THEN 'domingo'
  END::dia_semana;

  -- Buffer de anticipación de la sucursal del barbero
  SELECT COALESCE(s.buffer_reserva_min, 0)
  INTO   v_buffer_min
  FROM   empleado e
  JOIN   sucursal s ON s.id_sucursal = e.id_sucursal
  WHERE  e.id_empleado = p_id_empleado;
  v_buffer_min := COALESCE(v_buffer_min, 0);

  -- Turno del barbero para ese día
  SELECT hora_inicio, hora_fin
  INTO   v_turno_inicio, v_turno_fin
  FROM   horario_barbero
  WHERE  id_empleado = p_id_empleado
    AND  dia_semana  = v_dia_semana
    AND  activo      = TRUE;

  -- Barbero no trabaja ese día → 0 filas
  IF v_turno_inicio IS NULL THEN
    RETURN;
  END IF;

  -- Interpretamos la hora del turno como zona México City (no UTC).
  -- Postgres convierte TIMESTAMP sin tz → TIMESTAMPTZ correctamente.
  v_slot_actual  := (p_fecha::TEXT || ' ' || v_turno_inicio::TEXT)::TIMESTAMP
                    AT TIME ZONE 'America/Mexico_City';
  v_turno_fin_ts := (p_fecha::TEXT || ' ' || v_turno_fin::TEXT)::TIMESTAMP
                    AT TIME ZONE 'America/Mexico_City';

  LOOP
    v_slot_fin_ts := v_slot_actual + (p_duracion_min || ' minutes')::INTERVAL;
    EXIT WHEN v_slot_fin_ts > v_turno_fin_ts;

    slot_inicio := v_slot_actual;
    slot_fin    := v_slot_fin_ts;
    disponible  := (
      v_slot_actual > v_ahora + (v_buffer_min || ' minutes')::INTERVAL
      AND NOT EXISTS (
        SELECT 1 FROM cita c
        WHERE c.id_empleado = p_id_empleado
          AND c.estado NOT IN ('cancelada', 'no_presentada', 'completada')
          AND c.fecha_hora_inicio < v_slot_fin_ts
          AND c.fecha_hora_fin    > v_slot_actual
      )
    );
    RETURN NEXT;

    v_slot_actual := v_slot_actual + (p_duracion_min || ' minutes')::INTERVAL;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION obtener_slots_disponibles TO anon, authenticated;


-- ============================================================
-- telefono_puede_reservar — anti-spam
-- ============================================================
-- Retorna TRUE si el teléfono NO está bloqueado en esa sucursal/fecha.
-- El bloqueo se crea automáticamente al insertar la cita (trigger).
-- Se libera si la cita se cancela (otro trigger).
-- ============================================================
CREATE OR REPLACE FUNCTION telefono_puede_reservar(
  p_telefono    VARCHAR,
  p_id_sucursal UUID,
  p_fecha       DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_existe INT;
BEGIN
  SELECT COUNT(*) INTO v_existe
  FROM bloqueo_telefono
  WHERE telefono      = p_telefono
    AND id_sucursal   = p_id_sucursal
    AND fecha_bloqueo = p_fecha;
  RETURN v_existe = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION telefono_puede_reservar TO anon, authenticated;


-- ============================================================
-- barbero_disponible — doble check de disponibilidad
-- ============================================================
-- Igual que obtener_slots_disponibles pero para un rango específico:
-- el wizard llama a esto justo antes del INSERT para evitar carreras
-- (otro cliente reservó el mismo slot mientras tú escribías tus datos).
-- Acepta p_excluir_id_cita para que la edición de una cita propia
-- no se considere a sí misma como conflicto.
-- ============================================================
CREATE OR REPLACE FUNCTION barbero_disponible(
  p_id_empleado     UUID,
  p_inicio          TIMESTAMPTZ,
  p_fin             TIMESTAMPTZ,
  p_excluir_id_cita UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_traslape INT;
  v_buffer   INT;
  v_ahora    TIMESTAMPTZ := NOW();
BEGIN
  SELECT s.buffer_reserva_min INTO v_buffer
  FROM empleado e
  JOIN sucursal s ON s.id_sucursal = e.id_sucursal
  WHERE e.id_empleado = p_id_empleado;

  IF p_inicio < v_ahora + (v_buffer || ' minutes')::INTERVAL THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_traslape
  FROM cita c
  WHERE c.id_empleado = p_id_empleado
    AND c.estado NOT IN ('cancelada', 'no_presentada', 'completada')
    AND (p_excluir_id_cita IS NULL OR c.id_cita != p_excluir_id_cita)
    AND c.fecha_hora_inicio < p_fin
    AND c.fecha_hora_fin    > p_inicio;

  RETURN v_traslape = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION barbero_disponible TO anon, authenticated;


-- ============================================================
-- buscar_cliente_por_telefono — dedup de invitados
-- ============================================================
-- Usado en el wizard para reusar id_cliente cuando un invitado
-- regresa con el mismo teléfono → así sus citas pasadas siguen
-- vinculadas a la misma identidad.
-- ============================================================
DROP FUNCTION IF EXISTS buscar_cliente_por_telefono(TEXT);
DROP FUNCTION IF EXISTS buscar_cliente_por_telefono(VARCHAR);

CREATE FUNCTION buscar_cliente_por_telefono(p_telefono VARCHAR)
RETURNS TABLE (
  id_cliente UUID,
  nombre     VARCHAR,
  apellido   VARCHAR,
  email      VARCHAR,
  tipo       tipo_cliente
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id_cliente, nombre, apellido, email, tipo
  FROM cliente
  WHERE telefono = p_telefono
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono TO anon, authenticated;


-- ============================================================
-- buscar_cliente_por_email — detección de email con cuenta Auth
-- ============================================================
-- El wizard usa esto antes de crear un cliente anónimo: si el
-- email ya pertenece a un cliente REGISTRADO (con auth_user_id),
-- bloquea la reserva y le pide iniciar sesión (para no duplicar
-- identidades).
-- ============================================================
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
