-- ============================================================
-- 03_triggers.sql — TRIGGERS DEL SISTEMA
-- ============================================================
-- 5 triggers que mantienen consistencia automática:
--
--   1. trg_actualizar_fin_cita
--      Cuando cambia `detalle_cita` (servicios de una cita),
--      recalcula `cita.fecha_hora_fin` = inicio + suma de duraciones.
--      Por qué trigger y no calculado en consulta: necesitamos el
--      campo materializado para que el índice de traslapes funcione.
--
--   2. trg_bloquear_telefono
--      Al crear una cita ONLINE, registra el teléfono del cliente
--      en `bloqueo_telefono` para que no pueda reservar otra el
--      mismo día en la misma sucursal (anti-spam).
--
--   3. trg_liberar_bloqueo_telefono
--      Si la cita pasa a cancelada/no_presentada, elimina el
--      bloqueo correspondiente. Permite que el cliente reagende.
--
--   4. trg_actualizar_estado_barbero
--      Cambia `empleado.estado_actual` (libre/en_espera/ocupado/
--      ausente) según las citas del barbero. Es el corazón del
--      "semáforo" del dashboard.
--
--   5. trg_asignar_posicion_cola
--      BEFORE INSERT en cita: si origen='walkin' y no se pasó
--      posición, calcula la siguiente disponible.
--
-- SECURITY DEFINER en triggers 2/3/4: corren como postgres, no
-- como el caller. anon necesita escribir en bloqueo_telefono y
-- empleado al crear citas, pero sin SECURITY DEFINER el trigger
-- falla con "permission denied".
-- ============================================================


-- ============================================================
-- 1. trg_actualizar_fin_cita
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_actualizar_fin_cita()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_id_cita UUID;
BEGIN
  v_id_cita := COALESCE(NEW.id_cita, OLD.id_cita);
  UPDATE cita
  SET fecha_hora_fin = calcular_fin_cita(v_id_cita)
  WHERE id_cita = v_id_cita;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_actualizar_fin_cita
  AFTER INSERT OR DELETE OR UPDATE ON detalle_cita
  FOR EACH ROW
  EXECUTE FUNCTION trigger_actualizar_fin_cita();


-- ============================================================
-- 2. trg_bloquear_telefono (anti-spam reservas online)
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_bloquear_telefono()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_telefono VARCHAR;
BEGIN
  -- Solo bloqueamos reservas online (telefónica y walk-in las maneja admin)
  IF NEW.origen != 'online' THEN
    RETURN NEW;
  END IF;

  SELECT telefono INTO v_telefono
  FROM cliente
  WHERE id_cliente = NEW.id_cliente;

  IF v_telefono IS NOT NULL THEN
    INSERT INTO bloqueo_telefono (telefono, id_sucursal, fecha_bloqueo, id_cita)
    VALUES (v_telefono, NEW.id_sucursal, DATE(NEW.fecha_hora_inicio), NEW.id_cita)
    ON CONFLICT (telefono, id_sucursal, fecha_bloqueo) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bloquear_telefono
  AFTER INSERT ON cita
  FOR EACH ROW
  EXECUTE FUNCTION trigger_bloquear_telefono();


-- ============================================================
-- 3. trg_liberar_bloqueo_telefono
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_liberar_bloqueo_telefono()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.estado IN ('cancelada', 'no_presentada')
     AND OLD.estado NOT IN ('cancelada', 'no_presentada') THEN
    DELETE FROM bloqueo_telefono
    WHERE id_cita = NEW.id_cita;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_liberar_bloqueo_telefono
  AFTER UPDATE OF estado ON cita
  FOR EACH ROW
  EXECUTE FUNCTION trigger_liberar_bloqueo_telefono();


-- ============================================================
-- 4. trg_actualizar_estado_barbero (semáforo del dashboard)
-- ============================================================
-- Reglas:
--   · Nueva cita 'pendiente'              → libre        → en_espera
--   · Cita 'en_curso' (admin inició)      → cualquiera   → ocupado
--   · Cita 'completada/cancelada/no_present.':
--       si quedan más citas pendientes hoy → en_espera
--       si no                              → libre
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_actualizar_estado_barbero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.estado = 'pendiente' AND
     (TG_OP = 'INSERT' OR OLD.estado != 'pendiente') THEN
    UPDATE empleado
    SET estado_actual = 'en_espera'
    WHERE id_empleado = NEW.id_empleado
      AND estado_actual = 'libre';

  ELSIF NEW.estado = 'en_curso' AND OLD.estado = 'pendiente' THEN
    UPDATE empleado
    SET estado_actual = 'ocupado'
    WHERE id_empleado = NEW.id_empleado;

  ELSIF NEW.estado IN ('completada', 'cancelada', 'no_presentada')
        AND OLD.estado NOT IN ('completada', 'cancelada', 'no_presentada') THEN
    IF EXISTS (
      SELECT 1 FROM cita
      WHERE id_empleado = NEW.id_empleado
        AND estado = 'pendiente'
        AND DATE(fecha_hora_inicio) = CURRENT_DATE
        AND id_cita != NEW.id_cita
    ) THEN
      UPDATE empleado SET estado_actual = 'en_espera'
      WHERE id_empleado = NEW.id_empleado;
    ELSE
      UPDATE empleado SET estado_actual = 'libre'
      WHERE id_empleado = NEW.id_empleado;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_actualizar_estado_barbero
  AFTER INSERT OR UPDATE OF estado ON cita
  FOR EACH ROW
  EXECUTE FUNCTION trigger_actualizar_estado_barbero();


-- ============================================================
-- 5. trg_asignar_posicion_cola (walk-ins)
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_asignar_posicion_cola()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.origen = 'walkin' AND NEW.posicion_cola IS NULL THEN
    NEW.posicion_cola := siguiente_posicion_cola(
      NEW.id_empleado,
      DATE(NEW.fecha_hora_inicio)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asignar_posicion_cola
  BEFORE INSERT ON cita
  FOR EACH ROW
  EXECUTE FUNCTION trigger_asignar_posicion_cola();
