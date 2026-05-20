-- ============================================================
-- 02_funciones_base.sql — HELPERS Y FUNCIONES DE NEGOCIO
-- ============================================================
-- Funciones que NO son llamadas directamente desde el frontend
-- (las RPCs públicas viven en 06_rpc_publicas.sql). Aquí están:
--
--   · Helpers de auth: leen el JWT actual (auth.uid()) y resuelven
--     rol / sucursal / tipo de usuario. Son SECURITY DEFINER para
--     atravesar el RLS sin "circular dependency" cuando se usan
--     dentro de las propias policies.
--
--   · Lógica de negocio interna: calcular_fin_cita (usada por trigger),
--     siguiente_posicion_cola (asignación automática de cola walk-in).
--
--   · Validador de teléfono: rechaza formatos inválidos, números
--     test y secuencias obvias. Llamada desde el wizard antes de
--     intentar insertar el cliente.
-- ============================================================


-- ============================================================
-- HELPERS DE AUTH — leen el JWT del usuario actual
-- ============================================================
-- ¿Por qué SECURITY DEFINER?
--   Las policies RLS de `empleado` se filtran por estos helpers.
--   Si la función corriera con permisos del caller, leer empleado
--   activaría RLS, que a su vez llamaría al helper → recursión.
--   SECURITY DEFINER rompe el ciclo: la función corre como postgres,
--   sin RLS.
-- ============================================================

-- Devuelve el rol del usuario logueado (NULL si no es empleado)
CREATE OR REPLACE FUNCTION obtener_rol_usuario()
RETURNS rol_empleado
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_rol rol_empleado;
BEGIN
  SELECT rol INTO v_rol
  FROM empleado
  WHERE auth_user_id = auth.uid();
  RETURN v_rol;
END;
$$;

-- Sucursal del empleado logueado (admin de sucursal solo ve la suya)
CREATE OR REPLACE FUNCTION obtener_sucursal_usuario()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_sucursal UUID;
BEGIN
  SELECT id_sucursal INTO v_sucursal
  FROM empleado
  WHERE auth_user_id = auth.uid();
  RETURN v_sucursal;
END;
$$;

-- ¿El usuario autenticado es cliente con tipo='registrado'?
CREATE OR REPLACE FUNCTION es_cliente_registrado()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cliente
    WHERE auth_user_id = auth.uid()
      AND tipo = 'registrado'
  );
END;
$$;


-- ============================================================
-- LÓGICA DE NEGOCIO INTERNA
-- ============================================================

-- ------------------------------------------------------------
-- calcular_fin_cita — suma duraciones de detalle_cita para
-- obtener el fin de la cita. Usada por el trigger que recalcula
-- `cita.fecha_hora_fin` cuando cambia detalle_cita (multi-servicio).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION calcular_fin_cita(p_id_cita UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
  v_inicio    TIMESTAMPTZ;
  v_duracion  INT;
BEGIN
  SELECT fecha_hora_inicio INTO v_inicio
  FROM cita WHERE id_cita = p_id_cita;

  SELECT COALESCE(SUM(s.duracion_min), 0) INTO v_duracion
  FROM detalle_cita dc
  JOIN servicio s ON s.id_servicio = dc.id_servicio
  WHERE dc.id_cita = p_id_cita;

  -- Si no hay servicios aún, fin = inicio (se corregirá al insertarlos)
  RETURN v_inicio + (v_duracion || ' minutes')::INTERVAL;
END;
$$;


-- ------------------------------------------------------------
-- siguiente_posicion_cola — siguiente número en la cola de walk-ins
-- por barbero y día. Usada por el trigger BEFORE INSERT en cita.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION siguiente_posicion_cola(
  p_id_empleado UUID,
  p_fecha       DATE DEFAULT CURRENT_DATE
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_max INT;
BEGIN
  SELECT COALESCE(MAX(posicion_cola), 0) INTO v_max
  FROM cita
  WHERE id_empleado = p_id_empleado
    AND origen = 'walkin'
    AND DATE(fecha_hora_inicio) = p_fecha
    AND estado NOT IN ('cancelada', 'no_presentada');
  RETURN v_max + 1;
END;
$$;


-- ============================================================
-- VALIDACIÓN DE TELÉFONO
-- ============================================================
-- Por qué a nivel BD y no solo en frontend:
--   · Cualquiera con acceso a la publishable key puede saltarse
--     el JS y POSTear directo. Tener la validación en BD evita
--     basura en la tabla cliente y bloqueo_telefono.
--   · Rechaza números test conocidos (todos los dígitos iguales,
--     secuencias 1234..., y números de tarjeta de prueba).
-- Retorna {valido, error} para que el front lo muestre.
-- ============================================================
CREATE OR REPLACE FUNCTION validar_telefono(p_telefono VARCHAR)
RETURNS TABLE (
  valido BOOLEAN,
  error  TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_limpio VARCHAR;
  v_length INT;
BEGIN
  -- Limpiar: solo dígitos
  v_limpio := regexp_replace(p_telefono, '[^0-9]', '', 'g');
  v_length := LENGTH(v_limpio);

  -- 10 dígitos (formato MX sin lada internacional)
  IF v_length != 10 THEN
    RETURN QUERY SELECT FALSE, 'El teléfono debe tener 10 dígitos'::TEXT;
    RETURN;
  END IF;

  -- Rechazar todos los dígitos iguales (1111111111, etc.)
  IF v_limpio ~ '^([0-9])\1{9,}$' THEN
    RETURN QUERY SELECT FALSE, 'Este número de teléfono no es válido'::TEXT;
    RETURN;
  END IF;

  -- Rechazar secuencias obvias
  IF v_limpio ~ '^(0123456789|1234567890|9876543210|0987654321)' THEN
    RETURN QUERY SELECT FALSE, 'Este número de teléfono no es válido'::TEXT;
    RETURN;
  END IF;

  -- Rechazar números test conocidos
  IF v_limpio IN ('5555555555','4111111111','5105105105','9999999999','3333333333') THEN
    RETURN QUERY SELECT FALSE, 'Este número de teléfono no es válido'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION validar_telefono(VARCHAR) TO anon, authenticated;
