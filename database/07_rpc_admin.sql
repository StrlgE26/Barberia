-- ============================================================
-- 07_rpc_admin.sql — RPCs PARA EL DASHBOARD DE ADMINISTRADOR
-- ============================================================
-- Funciones para empleados con rol admin_sucursal o admin_general.
-- Validan rol/sucursal internamente, así que el frontend no puede
-- saltarse permisos manipulando payloads.
--
--   · registrar_walkin       — registra cliente anónimo + cita walk-in
--                              en una sola transacción. Asigna barbero
--                              automáticamente si no se especifica.
--
--   · cambiar_estado_cita    — único punto de cambio de estado. Valida
--                              transiciones permitidas y permisos por
--                              sucursal. Dispara los triggers del
--                              semáforo del barbero.
--
-- Ambas SECURITY DEFINER porque tocan múltiples tablas y necesitan
-- saltar RLS para operaciones legítimas del admin.
-- ============================================================


-- ============================================================
-- registrar_walkin — flujo completo de walk-in en una llamada
-- ============================================================
-- Por qué función y no múltiples queries desde el frontend:
--   · Atomicidad: cliente + cita + detalle se crean juntos.
--   · El cálculo de "barbero con menos carga" requiere queries que
--     son tediosas desde el front.
--   · El cálculo del inicio del slot (justo después de la última
--     cita activa del barbero) es lógica de negocio.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_walkin(
  p_id_sucursal UUID,
  p_nombre      VARCHAR,
  p_telefono    VARCHAR,
  p_id_servicio UUID,
  p_id_empleado UUID DEFAULT NULL  -- NULL = asignar automáticamente
)
RETURNS UUID  -- id_cita creado
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_empleado UUID;
  v_duracion    INT;
  v_precio      DECIMAL;
  v_inicio      TIMESTAMPTZ;
  v_fin         TIMESTAMPTZ;
  v_id_cita     UUID;
  v_posicion    INT;
BEGIN
  -- 1) Resolver duración y precio del servicio
  SELECT duracion_min, precio INTO v_duracion, v_precio
  FROM servicio WHERE id_servicio = p_id_servicio;

  IF v_duracion IS NULL THEN
    RAISE EXCEPTION 'Servicio no encontrado: %', p_id_servicio;
  END IF;

  -- 2) Asignar barbero: el de menor carga hoy en la sucursal
  IF p_id_empleado IS NULL THEN
    SELECT e.id_empleado INTO v_id_empleado
    FROM empleado e
    WHERE e.id_sucursal = p_id_sucursal
      AND e.rol = 'barbero'
      AND e.activo = TRUE
      AND e.estado_actual != 'ausente'
    ORDER BY (
      SELECT COUNT(*) FROM cita c
      WHERE c.id_empleado = e.id_empleado
        AND c.estado IN ('pendiente', 'en_curso')
        AND DATE(c.fecha_hora_inicio) = CURRENT_DATE
    ) ASC,
    e.estado_actual ASC  -- desempate: estados 'libre' van primero
    LIMIT 1;
  ELSE
    v_id_empleado := p_id_empleado;
  END IF;

  IF v_id_empleado IS NULL THEN
    RAISE EXCEPTION 'No hay barberos disponibles en esta sucursal';
  END IF;

  -- 3) Inicio = justo después de la última cita activa del barbero hoy
  --    (o ahora si el barbero está libre)
  SELECT COALESCE(MAX(fecha_hora_fin), NOW()) INTO v_inicio
  FROM cita
  WHERE id_empleado = v_id_empleado
    AND estado IN ('pendiente', 'en_curso')
    AND DATE(fecha_hora_inicio) = CURRENT_DATE;

  IF v_inicio < NOW() THEN
    v_inicio := NOW();
  END IF;
  v_fin := v_inicio + (v_duracion || ' minutes')::INTERVAL;

  -- 4) Posición en la cola del día
  v_posicion := siguiente_posicion_cola(v_id_empleado, CURRENT_DATE);

  -- 5) Insertar cita (id_cliente=NULL → nombre_walkin/telefono_walkin)
  INSERT INTO cita (
    id_sucursal, id_empleado, id_cliente,
    fecha_hora_inicio, fecha_hora_fin,
    origen, estado,
    nombre_walkin, telefono_walkin, posicion_cola
  ) VALUES (
    p_id_sucursal, v_id_empleado, NULL,
    v_inicio, v_fin,
    'walkin', 'pendiente',
    p_nombre, p_telefono, v_posicion
  )
  RETURNING id_cita INTO v_id_cita;

  -- 6) Detalle (el trigger recalcula fecha_hora_fin sobre el ya correcto)
  INSERT INTO detalle_cita (id_cita, id_servicio, precio_aplicado, orden)
  VALUES (v_id_cita, p_id_servicio, v_precio, 1);

  RETURN v_id_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION registrar_walkin TO authenticated;


-- ============================================================
-- cambiar_estado_cita — máquina de estados centralizada
-- ============================================================
-- Único punto donde se cambia `cita.estado`. Valida:
--   · Transiciones permitidas (no se puede ir de 'completada' a 'en_curso').
--   · Permisos: admin_sucursal solo puede tocar citas de su sucursal.
--   · Motivo obligatorio en cancelaciones.
-- Devuelve JSONB con {ok, error?, ...}.
-- ============================================================
CREATE OR REPLACE FUNCTION cambiar_estado_cita(
  p_id_cita      UUID,
  p_nuevo_estado estado_cita,
  p_motivo       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_estado_actual estado_cita;
  v_id_sucursal   UUID;
  v_rol           rol_empleado;
BEGIN
  -- Estado actual + sucursal
  SELECT estado, id_sucursal INTO v_estado_actual, v_id_sucursal
  FROM cita WHERE id_cita = p_id_cita;

  IF v_estado_actual IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cita no encontrada');
  END IF;

  -- Permisos por sucursal (admin_general pasa siempre)
  v_rol := obtener_rol_usuario();
  IF v_rol = 'admin_sucursal' AND v_id_sucursal != obtener_sucursal_usuario() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos para esta sucursal');
  END IF;

  -- Reglas de transición
  IF p_nuevo_estado = 'en_curso' AND v_estado_actual != 'pendiente' THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Solo se puede iniciar una cita que esté pendiente');
  END IF;
  IF p_nuevo_estado = 'completada' AND v_estado_actual != 'en_curso' THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Solo se puede finalizar una cita que esté en curso');
  END IF;
  IF p_nuevo_estado = 'cancelada' AND p_motivo IS NULL THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Se requiere un motivo para cancelar una cita');
  END IF;

  -- UPDATE → dispara trg_actualizar_estado_barbero automáticamente
  UPDATE cita
  SET estado = p_nuevo_estado,
      motivo_cancelacion = CASE
        WHEN p_nuevo_estado = 'cancelada' THEN p_motivo
        ELSE motivo_cancelacion
      END
  WHERE id_cita = p_id_cita;

  RETURN jsonb_build_object(
    'ok',           true,
    'id_cita',      p_id_cita,
    'estado_nuevo', p_nuevo_estado
  );
END;
$$;

GRANT EXECUTE ON FUNCTION cambiar_estado_cita TO authenticated;
