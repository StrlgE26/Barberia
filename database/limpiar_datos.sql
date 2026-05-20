-- ============================================================
-- LIMPIAR DATOS DE PRUEBA — dejar la BD lista para entrega
-- ============================================================
-- Ejecutar en Supabase SQL Editor (bypassa RLS).
-- Borra SOLO datos transaccionales/prueba. Conserva la config
-- operativa: sucursal, servicio, empleado, horario_barbero.
--
-- TRUNCATE ... CASCADE limpia en el orden correcto de FKs.
-- ============================================================

TRUNCATE TABLE
  token_confirmacion_cita,
  detalle_cita,
  bloqueo_telefono,
  cita,
  cliente
RESTART IDENTITY CASCADE;

-- Resetear el estado en tiempo real de todos los barberos a 'libre'
-- (por si quedaron en 'ocupado'/'en_espera' de pruebas anteriores)
UPDATE empleado SET estado_actual = 'libre';

-- ------------------------------------------------------------
-- Verificación: cuántos registros quedan en cada tabla
-- ------------------------------------------------------------
SELECT 'sucursal'        AS tabla, COUNT(*) FROM sucursal
UNION ALL SELECT 'servicio',        COUNT(*) FROM servicio
UNION ALL SELECT 'empleado',        COUNT(*) FROM empleado
UNION ALL SELECT 'horario_barbero', COUNT(*) FROM horario_barbero
UNION ALL SELECT 'cliente',         COUNT(*) FROM cliente
UNION ALL SELECT 'cita',            COUNT(*) FROM cita
UNION ALL SELECT 'detalle_cita',    COUNT(*) FROM detalle_cita
UNION ALL SELECT 'bloqueo_telefono',COUNT(*) FROM bloqueo_telefono
UNION ALL SELECT 'token_confirmacion_cita', COUNT(*) FROM token_confirmacion_cita;
