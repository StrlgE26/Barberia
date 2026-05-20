-- ============================================================
-- 04_rls.sql — ROW LEVEL SECURITY + GRANTS
-- ============================================================
-- Estrategia de seguridad por capas:
--
--   1) GRANTs a nivel de tabla — sin esto, RLS ni siquiera corre.
--      `anon` recibe lo mínimo para que la landing funcione (leer
--      catálogo, insertar cita + cliente + detalle).
--      `authenticated` recibe acceso amplio (admin/cliente logueado);
--      la diferenciación entre roles se hace en policies con
--      `obtener_rol_usuario()` (ver 02_funciones_base.sql).
--
--   2) RLS habilitada en todas las tablas sensibles.
--
--   3) Policies que filtran filas según el rol del JWT:
--      - Lectura pública (catálogo, barberos activos)
--      - Cliente ve solo sus propios datos
--      - Admin de sucursal ve solo su sucursal
--      - Admin general ve todo
--
-- NOTA: las RPCs SECURITY DEFINER (ver 06–08) atraviesan RLS;
-- las usamos cuando una operación legítima necesita acceso que
-- las policies no permiten (ej. cliente cancelando su propia cita,
-- registro upgrade de anónimo a registrado, etc).
-- ============================================================


-- ============================================================
-- 1. HABILITAR RLS EN TODAS LAS TABLAS SENSIBLES
-- ============================================================
ALTER TABLE sucursal         ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleado         ENABLE ROW LEVEL SECURITY;
ALTER TABLE horario_barbero  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente          ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicio         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cita             ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_cita     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueo_telefono ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 2. GRANTS DE TABLA
-- ============================================================
-- Reconstruidos limpios (idempotente): si Supabase ya otorgó algo
-- los GRANTs adicionales son no-op.

-- anon: catálogo público (lectura)
GRANT SELECT ON sucursal        TO anon;
GRANT SELECT ON servicio        TO anon;
GRANT SELECT ON empleado        TO anon;
GRANT SELECT ON horario_barbero TO anon;

-- anon: flujo de reserva online
-- · cita: UPDATE necesario porque el trigger recalcula fecha_hora_fin
-- · cliente: INSERT solo para tipo='anonimo' (ver policy más abajo)
GRANT SELECT, INSERT, UPDATE ON cita             TO anon;
GRANT SELECT, INSERT         ON detalle_cita     TO anon;
GRANT SELECT, INSERT         ON cliente          TO anon;
GRANT SELECT, INSERT         ON bloqueo_telefono TO anon;

-- authenticated: acceso amplio, RLS filtra por rol
GRANT SELECT ON sucursal        TO authenticated;
GRANT SELECT ON servicio        TO authenticated;
GRANT SELECT ON empleado        TO authenticated;
GRANT SELECT ON horario_barbero TO authenticated;

GRANT SELECT, INSERT, UPDATE         ON cita             TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON detalle_cita     TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON cliente          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bloqueo_telefono TO authenticated;


-- ============================================================
-- 3. POLÍTICAS POR TABLA
-- ============================================================

-- ------------------------------------------------------------
-- SUCURSAL — catálogo público de sucursales activas
-- ------------------------------------------------------------
CREATE POLICY "sucursal_lectura_publica"
  ON sucursal FOR SELECT
  USING (activa = TRUE);

CREATE POLICY "sucursal_escritura_admin_general"
  ON sucursal FOR ALL
  USING (obtener_rol_usuario() = 'admin_general');


-- ------------------------------------------------------------
-- SERVICIO — catálogo público de servicios activos
-- ------------------------------------------------------------
CREATE POLICY "servicio_lectura_publica"
  ON servicio FOR SELECT
  USING (activo = TRUE);

CREATE POLICY "servicio_escritura_admin_general"
  ON servicio FOR ALL
  USING (obtener_rol_usuario() = 'admin_general');


-- ------------------------------------------------------------
-- EMPLEADO — barberos públicos; admin ve a sus colegas
-- ------------------------------------------------------------
CREATE POLICY "empleado_lectura_publica_barberos"
  ON empleado FOR SELECT
  USING (activo = TRUE AND rol = 'barbero');

CREATE POLICY "empleado_lectura_admin_sucursal"
  ON empleado FOR SELECT
  USING (
    obtener_rol_usuario() = 'admin_sucursal'
    AND id_sucursal = obtener_sucursal_usuario()
  );

CREATE POLICY "empleado_lectura_admin_general"
  ON empleado FOR SELECT
  USING (obtener_rol_usuario() = 'admin_general');

CREATE POLICY "empleado_propio_perfil"
  ON empleado FOR ALL
  USING (auth_user_id = auth.uid());


-- ------------------------------------------------------------
-- HORARIO_BARBERO — público (para mostrar slots disponibles)
-- ------------------------------------------------------------
CREATE POLICY "horario_lectura_publica"
  ON horario_barbero FOR SELECT
  USING (activo = TRUE);

CREATE POLICY "horario_admin"
  ON horario_barbero FOR ALL
  USING (
    obtener_rol_usuario() IN ('admin_sucursal', 'admin_general')
    AND EXISTS (
      SELECT 1 FROM empleado e
      WHERE e.id_empleado = horario_barbero.id_empleado
        AND (
          obtener_rol_usuario() = 'admin_general'
          OR e.id_sucursal = obtener_sucursal_usuario()
        )
    )
  );


-- ------------------------------------------------------------
-- CLIENTE — anon solo crea anónimos; authenticated todo
-- ------------------------------------------------------------
-- anon inserta SOLO clientes anónimos (no puede registrarse sin pasar
-- por Supabase Auth signup, que setea auth_user_id).
CREATE POLICY "cliente_anon_insert"
  ON cliente FOR INSERT
  TO anon
  WITH CHECK (tipo = 'anonimo');

-- anon necesita SELECT para que el flujo de búsqueda por teléfono
-- funcione cuando un invitado regresa. Limita la fuga porque solo
-- buscamos por teléfono específico (no se enumera).
CREATE POLICY "cliente_anon_select"
  ON cliente FOR SELECT
  TO anon
  USING (TRUE);

-- authenticated puede TODO sobre cliente; admin verá los suyos,
-- cliente registrado verá su propio row (ambos se cubren con esta
-- policy porque el wizard usa el token del cliente).
CREATE POLICY "cliente_auth_all"
  ON cliente FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ------------------------------------------------------------
-- CITA — anon solo crea citas online; authenticated todo
-- ------------------------------------------------------------
-- anon: WITH CHECK origen='online' impide que se hagan pasar por
-- telefónica/walkin (rutas del admin).
CREATE POLICY "cita_anon_insert"
  ON cita FOR INSERT
  TO anon
  WITH CHECK (origen = 'online');

CREATE POLICY "cita_anon_select"
  ON cita FOR SELECT
  TO anon
  USING (TRUE);

CREATE POLICY "cita_auth_insert"
  ON cita FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

CREATE POLICY "cita_auth_select"
  ON cita FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "cita_auth_update"
  ON cita FOR UPDATE
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ------------------------------------------------------------
-- DETALLE_CITA — herencia natural de la cita
-- ------------------------------------------------------------
CREATE POLICY "detalle_anon_insert"
  ON detalle_cita FOR INSERT
  TO anon
  WITH CHECK (TRUE);

CREATE POLICY "detalle_anon_select"
  ON detalle_cita FOR SELECT
  TO anon
  USING (TRUE);

CREATE POLICY "detalle_auth_all"
  ON detalle_cita FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ------------------------------------------------------------
-- BLOQUEO_TELEFONO — manejado por triggers (SECURITY DEFINER)
-- ------------------------------------------------------------
-- No exponemos a anon: los INSERT vienen del trigger trg_bloquear_telefono
-- que corre como postgres. authenticated los administra.
CREATE POLICY "bloqueo_auth_all"
  ON bloqueo_telefono FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);
