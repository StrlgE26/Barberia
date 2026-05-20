-- ============================================================
-- 11_seed.sql — DATOS INICIALES
-- ============================================================
-- Datos mínimos para que el sistema funcione tras instalación:
--
--   1. Una sucursal "Academia De Barberia The Hipster" (Lindavista).
--   2. Catálogo de 6 servicios (corte, barba, combo, etc.).
--   3. 1 admin general + 1 admin sucursal + 4 barberos.
--   4. Horarios Lun-Sáb 09:00-21:00 para todos los barberos.
--
-- Los empleados se crean SIN auth_user_id. El paso manual
-- post-setup es:
--   a) Crear cuentas Auth en Supabase Dashboard → Authentication.
--   b) Ejecutar vincular_empleados.sql con los UUIDs reales para
--      enlazar cada empleado a su cuenta.
--
-- Para una BD ya en producción NO ejecutar este archivo (sobre-
-- escribiría datos reales). Es solo para setup desde cero.
-- ============================================================


-- ============================================================
-- 1. SUCURSAL (entidad raíz)
-- ============================================================
INSERT INTO sucursal (nombre, direccion, telefono, horario_apertura, horario_cierre, buffer_reserva_min)
VALUES (
  'Academia De Barberia The Hipster',
  'Riobamba 690, Lindavista, CDMX, 07300',
  '5568410903',
  '09:00',
  '21:00',
  30
)
ON CONFLICT DO NOTHING;


-- ============================================================
-- 2. CATÁLOGO DE SERVICIOS
-- ============================================================
INSERT INTO servicio (nombre, descripcion, duracion_min, precio, categoria) VALUES
  ('Corte Clásico',     'Degradado limpio, perfil definido.',                    30,  150.00, 'corte'),
  ('Arreglo de Barba',  'Perfilado, delineado y acabado con productos premium.', 20,  100.00, 'barba'),
  ('Corte + Barba',     'Corte degradado más arreglo completo de barba.',        50,  230.00, 'combo'),
  ('Diseño de Líneas',  'Grabados y fade artístico a máquina.',                  50,  200.00, 'diseno'),
  ('Tratamiento Facial','Limpieza profunda, vapor y mascarilla.',                45,  220.00, 'tratamiento'),
  ('Coloración',        'Mechas, tinte completo o decoloración.',                90,  350.00, 'color')
ON CONFLICT DO NOTHING;


-- ============================================================
-- 3. EMPLEADOS + HORARIOS
-- ============================================================
-- Insertados SIN auth_user_id. Después vincularás con
-- vincular_empleados.sql.
DO $$
DECLARE
  v_id_sucursal UUID;
BEGIN
  SELECT id_sucursal INTO v_id_sucursal
  FROM sucursal
  WHERE nombre ILIKE '%Hipster%'
  LIMIT 1;

  IF v_id_sucursal IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada. Corre primero el INSERT de sucursal arriba.';
  END IF;

  -- Admins
  INSERT INTO empleado (id_sucursal, nombre, apellidos, email, rol, estado_actual, activo)
  VALUES (v_id_sucursal, 'Ricardo', 'Hernández', 'admin@barbercerdas.com', 'admin_general', 'libre', TRUE)
  ON CONFLICT DO NOTHING;

  INSERT INTO empleado (id_sucursal, nombre, apellidos, email, rol, estado_actual, activo)
  VALUES (v_id_sucursal, 'Sofía', 'Martínez', 'sucursal@barbercerdas.com', 'admin_sucursal', 'libre', TRUE)
  ON CONFLICT DO NOTHING;

  -- Barberos
  INSERT INTO empleado (id_sucursal, nombre, apellidos, email, rol, especialidad, foto_url, estado_actual, activo)
  VALUES
  (v_id_sucursal, 'Carlos', 'Reyes', 'carlos@barbercerdas.com',
   'barbero', 'Degradados y cortes clásicos',
   'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
   'libre', TRUE),
  (v_id_sucursal, 'Miguel', 'Torres', 'miguel@barbercerdas.com',
   'barbero', 'Diseño de barba y perfilado',
   'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
   'libre', TRUE),
  (v_id_sucursal, 'Andrés', 'Vega', 'andres@barbercerdas.com',
   'barbero', 'Grabados y diseño de líneas',
   'https://images.unsplash.com/photo-1552058544-f2b08422138a?w=400&auto=format&fit=crop&q=80',
   'libre', TRUE),
  (v_id_sucursal, 'Luis', 'Mendoza', 'luis@barbercerdas.com',
   'barbero', 'Coloración y tratamientos',
   'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&auto=format&fit=crop&q=80',
   'libre', TRUE)
  ON CONFLICT DO NOTHING;

  -- Horarios: Lunes a Sábado 9:00 – 21:00 para todos los barberos
  INSERT INTO horario_barbero (id_empleado, dia_semana, hora_inicio, hora_fin)
  SELECT
    e.id_empleado,
    d.dia::dia_semana,
    '09:00'::TIME,
    '21:00'::TIME
  FROM empleado e
  CROSS JOIN (
    VALUES ('lunes'),('martes'),('miercoles'),('jueves'),('viernes'),('sabado')
  ) AS d(dia)
  WHERE e.rol = 'barbero'
    AND e.id_sucursal = v_id_sucursal
  ON CONFLICT (id_empleado, dia_semana) DO NOTHING;

  RAISE NOTICE 'Seed listo. % empleados, horarios insertados.', (
    SELECT COUNT(*) FROM empleado WHERE id_sucursal = v_id_sucursal
  );
END;
$$;


-- ============================================================
-- Verificación
-- ============================================================
SELECT
  e.nombre,
  e.apellidos,
  e.rol,
  e.estado_actual,
  COUNT(h.id_horario) AS dias_laborales
FROM empleado e
LEFT JOIN horario_barbero h ON h.id_empleado = e.id_empleado
GROUP BY e.id_empleado, e.nombre, e.apellidos, e.rol, e.estado_actual
ORDER BY e.rol, e.nombre;
