-- ============================================================
-- SEMANA 3 — Vincular cuentas Supabase Auth con empleados
-- ============================================================
--
-- PASO 1 (manual — hacer ANTES de correr este script):
--
--   Ir a: Supabase Dashboard → Authentication → Users → "Add user"
--   Crear un usuario por cada empleado con estas credenciales:
--
--   | Email                        | Contraseña sugerida  | Rol            |
--   |------------------------------|----------------------|----------------|
--   | admin@barbercerdas.com       | Admin#2024!          | admin_general  |
--   | sucursal@barbercerdas.com    | Sucursal#2024!       | admin_sucursal |
--   | carlos@barbercerdas.com      | Carlos#2024!         | barbero        |
--   | miguel@barbercerdas.com      | Miguel#2024!         | barbero        |
--   | andres@barbercerdas.com      | Andres#2024!         | barbero        |
--   | luis@barbercerdas.com        | Luis#2024!           | barbero        |
--
--   Para cada usuario creado, Supabase genera un UUID en la columna "UID".
--   Copia ese UUID y reemplaza el placeholder correspondiente abajo.
--
-- PASO 2: Ejecutar este script en Supabase → SQL Editor
-- ============================================================


-- ------------------------------------------------------------
-- Verificación previa: ver los empleados sin vincular
-- Ejecutar primero para confirmar que los registros existen
-- ------------------------------------------------------------
SELECT id_empleado, nombre, apellidos, email, rol, auth_user_id
FROM empleado
ORDER BY rol, nombre;


-- ------------------------------------------------------------
-- Vincular auth_user_id — RELLENAR los UUIDs con los del Auth Dashboard
-- ------------------------------------------------------------

-- Admin general: Ricardo Hernández
UPDATE empleado
SET auth_user_id = 'ce2d1712-f5ed-4595-b7ee-19813e1bc23e'
WHERE email = 'admin@barbercerdas.com'
  AND auth_user_id IS NULL;

-- Admin sucursal: Sofía Martínez
UPDATE empleado
SET auth_user_id = '1dc71447-751d-4c3f-8127-9a1e35437f4d'
WHERE email = 'sucursal@barbercerdas.com'
  AND auth_user_id IS NULL;

-- Barbero: Carlos Reyes
UPDATE empleado
SET auth_user_id = '260e6895-42db-4653-b9c5-f4c2ee0226a5'
WHERE email = 'carlos@barbercerdas.com'
  AND auth_user_id IS NULL;

-- Barbero: Miguel Torres
UPDATE empleado
SET auth_user_id = '9e82998c-2762-427b-9e9b-b7893d3d6c85'
WHERE email = 'miguel@barbercerdas.com'
  AND auth_user_id IS NULL;

-- Barbero: Andrés Vega
UPDATE empleado
SET auth_user_id = '699782a0-5d57-466c-afe7-4155f1f94a19'
WHERE email = 'andres@barbercerdas.com'
  AND auth_user_id IS NULL;

-- Barbero: Luis Mendoza
UPDATE empleado
SET auth_user_id = 'b1624a48-2597-4267-ac02-852db08f6311'
WHERE email = 'luis@barbercerdas.com'
  AND auth_user_id IS NULL;


-- ------------------------------------------------------------
-- Verificación final: todos los empleados deben tener auth_user_id
-- Si alguno sigue en NULL, el email no coincide o el UUID está mal
-- ------------------------------------------------------------
SELECT
  e.nombre,
  e.apellidos,
  e.email,
  e.rol,
  CASE
    WHEN e.auth_user_id IS NULL THEN '❌ SIN VINCULAR'
    ELSE '✅ ' || e.auth_user_id::TEXT
  END AS estado_vinculacion
FROM empleado e
ORDER BY e.rol, e.nombre;
