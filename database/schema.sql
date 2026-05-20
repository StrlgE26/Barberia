-- ============================================================
-- BARBER CERDAS / KODDE SOLUTIONS
-- SCHEMA CONSOLIDADO — Setup completo de base de datos
-- ============================================================
-- Ejecutar de principio a fin en una instancia Supabase limpia.
-- Reproduce exactamente el estado de produccion (orden de
-- aplicacion historico). Los modulos posteriores corrigen y
-- amplian a los anteriores via DROP IF EXISTS / CREATE OR REPLACE.
--
-- Paso manual aparte: database/_archivo/vincular_empleados.sql
--   (vincula barberos con cuentas Auth — requiere UUIDs reales)
-- ============================================================



-- ############################################################
-- ## MODULO 01 — schema.sql
-- ############################################################

-- ============================================================
-- SISTEMA DE GESTIÓN DE CITAS — BARBERÍA THE HIPSTER
-- Supabase PostgreSQL | Versión 1.0
-- Orden: Extensions → Tablas → Índices → Funciones → Triggers → RLS
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================

-- uuid_generate_v4() para PKs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pg_cron para tareas programadas (cancelación automática, etc.)
-- Habilitar desde el dashboard de Supabase: Database → Extensions → pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ============================================================
-- 1. ENUMS
-- Definidos antes de las tablas que los usan
-- ============================================================

-- Roles del sistema (tabla única con discriminador — decisión del EER)
CREATE TYPE rol_empleado AS ENUM (
  'barbero',
  'admin_sucursal',
  'admin_general'
);

-- Estado operativo del barbero en tiempo real
CREATE TYPE estado_barbero AS ENUM (
  'libre',       -- verde: disponible para siguiente cliente
  'en_espera',   -- amarillo: tiene cliente asignado, aún no inicia
  'ocupado',     -- rojo: servicio en curso
  'ausente'      -- gris: no disponible (descanso, día libre, etc.)
);

-- Origen de la cita
CREATE TYPE origen_cita AS ENUM (
  'online',      -- reserva por la landing (cliente registrado)
  'telefonica',  -- registrada por admin de sucursal
  'walkin'       -- cliente sin cita que llega al local
);

-- Estado del ciclo de vida de la cita
CREATE TYPE estado_cita AS ENUM (
  'pendiente_confirmacion', -- reservada online, esperando confirmación por email del cliente
  'pendiente',   -- confirmada/agendada, esperando inicio de servicio
  'en_curso',    -- servicio iniciado (admin presionó "Iniciar")
  'completada',  -- servicio finalizado (admin presionó "Finalizar")
  'cancelada',   -- cancelada por admin o por el sistema
  'no_presentada'-- cliente no llegó
);

-- Tipo de cliente
CREATE TYPE tipo_cliente AS ENUM (
  'registrado',  -- tiene cuenta, puede reservar online
  'anonimo'      -- solo nombre y teléfono, walk-in o telefónica
);

-- Días de la semana para horarios
CREATE TYPE dia_semana AS ENUM (
  'lunes', 'martes', 'miercoles', 'jueves',
  'viernes', 'sabado', 'domingo'
);

-- Categoría de servicios
CREATE TYPE categoria_servicio AS ENUM (
  'corte',
  'barba',
  'combo',
  'tratamiento',
  'color',
  'diseno'
);


-- ============================================================
-- 2. TABLAS BASE (sin dependencias externas)
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 SUCURSAL
-- Entidad raíz del sistema multi-sucursal
-- ------------------------------------------------------------
CREATE TABLE sucursal (
  id_sucursal       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre            VARCHAR(100) NOT NULL,
  direccion         VARCHAR(255) NOT NULL,
  telefono          VARCHAR(20),
  horario_apertura  TIME NOT NULL DEFAULT '09:00',
  horario_cierre    TIME NOT NULL DEFAULT '21:00',
  -- Minutos mínimos de anticipación para reservas online
  -- Evita que alguien reserve 1 minuto antes de que el barbero esté ocupado
  buffer_reserva_min INT NOT NULL DEFAULT 30,
  activa            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN sucursal.buffer_reserva_min IS
  'Minutos mínimos de anticipación requeridos para una reserva online. Configurable por sucursal.';


-- ------------------------------------------------------------
-- 2.2 SERVICIO
-- Catálogo de servicios. Independiente de sucursal para reuso.
-- ------------------------------------------------------------
CREATE TABLE servicio (
  id_servicio     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(100) NOT NULL,
  descripcion     TEXT,
  duracion_min    INT NOT NULL CHECK (duracion_min > 0),
  precio          DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  categoria       categoria_servicio NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN servicio.duracion_min IS
  'Duración en minutos. Usada para calcular fecha_hora_fin y detectar traslapes.';
COMMENT ON COLUMN servicio.precio IS
  'Precio base. El precio real cobrado se guarda en detalle_cita.precio_aplicado.';


-- ------------------------------------------------------------
-- 2.3 CLIENTE
-- Registrado (con cuenta Supabase Auth) o anónimo (walk-in/telefónico)
-- ------------------------------------------------------------
CREATE TABLE cliente (
  id_cliente      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- FK a auth.users de Supabase. NULL si es anónimo.
  auth_user_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  nombre          VARCHAR(100) NOT NULL,
  apellido        VARCHAR(100),
  telefono        VARCHAR(20) NOT NULL,
  email           VARCHAR(255),
  tipo            tipo_cliente NOT NULL DEFAULT 'anonimo',
  fecha_registro  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cliente_registrado_tiene_email
    CHECK (tipo = 'anonimo' OR email IS NOT NULL),
  CONSTRAINT cliente_registrado_tiene_auth
    CHECK (tipo = 'anonimo' OR auth_user_id IS NOT NULL)
);

COMMENT ON COLUMN cliente.auth_user_id IS
  'Vincula con Supabase Auth. NULL para clientes anónimos (walk-in, telefónica).';
COMMENT ON COLUMN cliente.telefono IS
  'Usado para bloqueo anti-spam: máximo 1 cita activa por teléfono por día.';


-- ============================================================
-- 3. TABLAS CON DEPENDENCIAS
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 EMPLEADO
-- Tabla única con discriminador rol (herencia EER tabla única)
-- Supabase Auth maneja la autenticación; aquí guardamos el perfil.
-- ------------------------------------------------------------
CREATE TABLE empleado (
  id_empleado     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- FK a auth.users. El login se maneja con Supabase Auth.
  auth_user_id    UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id_sucursal     UUID NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE RESTRICT,
  nombre          VARCHAR(100) NOT NULL,
  apellidos       VARCHAR(100) NOT NULL,
  email           VARCHAR(255) NOT NULL,
  rol             rol_empleado NOT NULL,
  -- Solo relevante si rol = 'barbero'
  especialidad    VARCHAR(100),
  foto_url        TEXT,
  estado_actual   estado_barbero NOT NULL DEFAULT 'libre',
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT barbero_tiene_especialidad
    CHECK (rol != 'barbero' OR especialidad IS NOT NULL)
);

COMMENT ON COLUMN empleado.estado_actual IS
  'Estado en tiempo real del barbero. Actualizado por triggers y acciones del admin.';
COMMENT ON COLUMN empleado.rol IS
  'Discriminador de herencia. barbero: atiende citas. admin_sucursal: gestiona su sucursal. admin_general: acceso total.';


-- ------------------------------------------------------------
-- 3.2 HORARIO_BARBERO
-- Entidad débil: depende de EMPLEADO (solo barberos tienen horario)
-- Define los turnos semanales recurrentes de cada barbero
-- ------------------------------------------------------------
CREATE TABLE horario_barbero (
  id_horario      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_empleado     UUID NOT NULL REFERENCES empleado(id_empleado) ON DELETE CASCADE,
  dia_semana      dia_semana NOT NULL,
  hora_inicio     TIME NOT NULL,
  hora_fin        TIME NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Un barbero no puede tener dos turnos el mismo día
  CONSTRAINT horario_unico_por_dia
    UNIQUE (id_empleado, dia_semana),

  CONSTRAINT horario_valido
    CHECK (hora_inicio < hora_fin)
);

COMMENT ON TABLE horario_barbero IS
  'Horarios semanales recurrentes. Se usa para calcular disponibilidad real del barbero.';


-- ------------------------------------------------------------
-- 3.3 CITA
-- Entidad central. Unifica online, telefónica y walk-in con campo origen.
-- La fecha_hora_fin se calcula y almacena para índices de traslape.
-- ------------------------------------------------------------
CREATE TABLE cita (
  id_cita           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_sucursal       UUID NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE RESTRICT,
  id_empleado       UUID NOT NULL REFERENCES empleado(id_empleado) ON DELETE RESTRICT,
  -- NULL para walk-ins sin cuenta (nombre_walkin cubre ese caso)
  id_cliente        UUID REFERENCES cliente(id_cliente) ON DELETE SET NULL,

  fecha_hora_inicio TIMESTAMPTZ NOT NULL,
  -- Calculado al crear/actualizar según duración total de servicios en detalle_cita
  fecha_hora_fin    TIMESTAMPTZ NOT NULL,

  origen            origen_cita NOT NULL,
  estado            estado_cita NOT NULL DEFAULT 'pendiente',

  -- Solo para walk-ins sin cuenta registrada
  nombre_walkin     VARCHAR(100),
  telefono_walkin   VARCHAR(20),

  -- Posición en cola (solo walk-ins). NULL para citas agendadas.
  posicion_cola     INT,

  notas             TEXT,
  -- Razón de cancelación (requerida al cancelar)
  motivo_cancelacion TEXT,
  fecha_creacion    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Validaciones de integridad de negocio
  CONSTRAINT cita_walkin_tiene_nombre
    CHECK (origen != 'walkin' OR nombre_walkin IS NOT NULL OR id_cliente IS NOT NULL),

  CONSTRAINT cita_tiempo_valido
    CHECK (fecha_hora_fin > fecha_hora_inicio),

  CONSTRAINT cita_no_en_pasado
    CHECK (origen = 'walkin' OR fecha_hora_inicio > fecha_creacion)
);

COMMENT ON COLUMN cita.fecha_hora_fin IS
  'Almacenada (no calculada en consulta) para usar índice EXCLUDE y detectar traslapes eficientemente.';
COMMENT ON COLUMN cita.posicion_cola IS
  'Asignada automáticamente por trigger al insertar un walk-in.';
COMMENT ON COLUMN cita.nombre_walkin IS
  'Nombre del cliente walk-in sin cuenta. Complementa a id_cliente cuando es NULL.';


-- ------------------------------------------------------------
-- 3.4 DETALLE_CITA
-- Tabla intermedia N:M entre CITA y SERVICIO
-- PK compuesta (id_cita, id_servicio) — corrección del modelo original
-- Guarda precio histórico para preservar cambios futuros de precios
-- ------------------------------------------------------------
CREATE TABLE detalle_cita (
  id_cita         UUID NOT NULL REFERENCES cita(id_cita) ON DELETE CASCADE,
  id_servicio     UUID NOT NULL REFERENCES servicio(id_servicio) ON DELETE RESTRICT,
  -- Precio real cobrado en el momento de la cita
  -- Independiente del precio actual en tabla servicio
  precio_aplicado DECIMAL(10,2) NOT NULL CHECK (precio_aplicado >= 0),
  -- Orden de ejecución si hay múltiples servicios en una cita
  orden           INT NOT NULL DEFAULT 1,

  PRIMARY KEY (id_cita, id_servicio),

  CONSTRAINT orden_positivo CHECK (orden > 0)
);

COMMENT ON TABLE detalle_cita IS
  'PK compuesta (id_cita, id_servicio). Permite múltiples servicios por cita.';
COMMENT ON COLUMN detalle_cita.precio_aplicado IS
  'Precio en el momento de la cita. Preserva historial aunque cambie servicio.precio.';


-- ------------------------------------------------------------
-- 3.5 BLOQUEO_TELEFONO
-- Control anti-spam: máximo 1 cita activa por teléfono por día
-- Se limpia automáticamente al día siguiente
-- ------------------------------------------------------------
CREATE TABLE bloqueo_telefono (
  id_bloqueo      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telefono        VARCHAR(20) NOT NULL,
  id_sucursal     UUID NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE CASCADE,
  fecha_bloqueo   DATE NOT NULL DEFAULT CURRENT_DATE,
  id_cita         UUID REFERENCES cita(id_cita) ON DELETE CASCADE,

  -- Un teléfono solo puede tener 1 reserva activa por día por sucursal
  CONSTRAINT bloqueo_unico_por_dia
    UNIQUE (telefono, id_sucursal, fecha_bloqueo)
);

COMMENT ON TABLE bloqueo_telefono IS
  'Previene reservas múltiples del mismo teléfono el mismo día. Se limpia diariamente.';


-- ============================================================
-- 4. ÍNDICES
-- ============================================================

-- Búsqueda de citas por barbero y rango de tiempo (operación más frecuente)
CREATE INDEX idx_cita_empleado_tiempo
  ON cita(id_empleado, fecha_hora_inicio, fecha_hora_fin);

-- Búsqueda de citas por sucursal y fecha (dashboard del admin)
CREATE INDEX idx_cita_sucursal_fecha
  ON cita(id_sucursal, fecha_hora_inicio);

-- Búsqueda de citas por cliente (historial)
CREATE INDEX idx_cita_cliente
  ON cita(id_cliente)
  WHERE id_cliente IS NOT NULL;

-- Búsqueda de citas por estado (cola pendiente, en curso)
CREATE INDEX idx_cita_estado
  ON cita(estado, fecha_hora_inicio);

-- Horarios de barbero por empleado
CREATE INDEX idx_horario_empleado
  ON horario_barbero(id_empleado, dia_semana);

-- Empleados activos por sucursal (carga del dashboard)
CREATE INDEX idx_empleado_sucursal
  ON empleado(id_sucursal, activo, rol);

-- Bloqueo de teléfono: búsqueda rápida
CREATE INDEX idx_bloqueo_telefono_fecha
  ON bloqueo_telefono(telefono, fecha_bloqueo);


-- ============================================================
-- 5. FUNCIONES DE NEGOCIO
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 Verificar disponibilidad del barbero
-- Retorna TRUE si el barbero está libre en el rango solicitado
-- Considera el buffer_reserva_min de la sucursal
-- Excluye citas canceladas y no_presentadas del cálculo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION barbero_disponible(
  p_id_empleado     UUID,
  p_inicio          TIMESTAMPTZ,
  p_fin             TIMESTAMPTZ,
  p_excluir_id_cita UUID DEFAULT NULL  -- Para edición de citas existentes
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_traslape INT;
  v_buffer   INT;
  v_ahora    TIMESTAMPTZ := NOW();
BEGIN
  -- Obtener buffer de la sucursal del empleado
  SELECT s.buffer_reserva_min INTO v_buffer
  FROM empleado e
  JOIN sucursal s ON s.id_sucursal = e.id_sucursal
  WHERE e.id_empleado = p_id_empleado;

  -- Verificar que la reserva no sea con menos anticipación que el buffer
  IF p_inicio < v_ahora + (v_buffer || ' minutes')::INTERVAL THEN
    RETURN FALSE;
  END IF;

  -- Buscar traslapes con citas activas del mismo barbero
  SELECT COUNT(*) INTO v_traslape
  FROM cita c
  WHERE c.id_empleado = p_id_empleado
    AND c.estado NOT IN ('cancelada', 'no_presentada', 'completada')
    AND (p_excluir_id_cita IS NULL OR c.id_cita != p_excluir_id_cita)
    -- Overlap: los rangos se traslapan si inicio1 < fin2 AND fin1 > inicio2
    AND c.fecha_hora_inicio < p_fin
    AND c.fecha_hora_fin    > p_inicio;

  RETURN v_traslape = 0;
END;
$$;

COMMENT ON FUNCTION barbero_disponible IS
  'Verifica disponibilidad real del barbero en un rango de tiempo, respetando el buffer de anticipación.';


-- ------------------------------------------------------------
-- 5.2 Calcular fecha_hora_fin de una cita
-- Suma las duraciones de todos los servicios en detalle_cita
-- Llamada al insertar/actualizar detalle_cita
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION calcular_fin_cita(p_id_cita UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
  v_inicio      TIMESTAMPTZ;
  v_duracion    INT;
BEGIN
  SELECT fecha_hora_inicio INTO v_inicio
  FROM cita WHERE id_cita = p_id_cita;

  SELECT COALESCE(SUM(s.duracion_min), 0) INTO v_duracion
  FROM detalle_cita dc
  JOIN servicio s ON s.id_servicio = dc.id_servicio
  WHERE dc.id_cita = p_id_cita;

  -- Si no hay servicios aún, fin = inicio (se corregirá al agregar servicios)
  RETURN v_inicio + (v_duracion || ' minutes')::INTERVAL;
END;
$$;


-- ------------------------------------------------------------
-- 5.3 Obtener siguiente posición en cola de walk-ins
-- Por barbero en el día actual
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION siguiente_posicion_cola(
  p_id_empleado UUID,
  p_fecha       DATE DEFAULT CURRENT_DATE
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_max INT;
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


-- ------------------------------------------------------------
-- 5.4 Verificar bloqueo de teléfono
-- Retorna TRUE si el teléfono puede reservar (no está bloqueado)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION telefono_puede_reservar(
  p_telefono    VARCHAR,
  p_id_sucursal UUID,
  p_fecha       DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_existe INT;
BEGIN
  SELECT COUNT(*) INTO v_existe
  FROM bloqueo_telefono
  WHERE telefono     = p_telefono
    AND id_sucursal  = p_id_sucursal
    AND fecha_bloqueo = p_fecha;

  RETURN v_existe = 0;
END;
$$;


-- ============================================================
-- 6. TRIGGERS
-- ============================================================

-- ------------------------------------------------------------
-- 6.1 Actualizar fecha_hora_fin cuando cambia detalle_cita
-- Se dispara al INSERT o DELETE en detalle_cita
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_actualizar_fin_cita()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_id_cita UUID;
BEGIN
  -- Obtener el id_cita del registro afectado
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


-- ------------------------------------------------------------
-- 6.2 Registrar bloqueo de teléfono al crear cita online
-- Solo aplica para citas de tipo 'online' con cliente registrado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_bloquear_telefono()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_telefono VARCHAR;
BEGIN
  -- Solo bloquear para reservas online (no walk-ins ni telefónicas)
  IF NEW.origen != 'online' THEN
    RETURN NEW;
  END IF;

  -- Obtener teléfono del cliente
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


-- ------------------------------------------------------------
-- 6.3 Liberar bloqueo de teléfono si la cita se cancela
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_liberar_bloqueo_telefono()
RETURNS TRIGGER
LANGUAGE plpgsql
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


-- ------------------------------------------------------------
-- 6.4 Actualizar estado del barbero según estado de su cita activa
-- libre → en_espera cuando se asigna una cita pendiente
-- en_espera → ocupado cuando el admin inicia el servicio
-- ocupado → libre cuando se completa o cancela
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_actualizar_estado_barbero()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cita creada o pasa a pendiente → barbero en_espera
  IF NEW.estado = 'pendiente' AND
     (TG_OP = 'INSERT' OR OLD.estado != 'pendiente') THEN

    UPDATE empleado
    SET estado_actual = 'en_espera'
    WHERE id_empleado = NEW.id_empleado
      AND estado_actual = 'libre';

  -- Admin inicia el servicio → barbero ocupado
  ELSIF NEW.estado = 'en_curso' AND OLD.estado = 'pendiente' THEN

    UPDATE empleado
    SET estado_actual = 'ocupado'
    WHERE id_empleado = NEW.id_empleado;

  -- Servicio finalizado o cancelado → revisar si tiene más citas pendientes
  ELSIF NEW.estado IN ('completada', 'cancelada', 'no_presentada')
        AND OLD.estado NOT IN ('completada', 'cancelada', 'no_presentada') THEN

    -- ¿Tiene otra cita pendiente hoy?
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


-- ------------------------------------------------------------
-- 6.5 Asignar posición en cola automáticamente a walk-ins
-- ------------------------------------------------------------
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


-- ============================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- Seguridad a nivel de base de datos por rol
-- ============================================================

-- Habilitar RLS en todas las tablas sensibles
ALTER TABLE sucursal         ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleado         ENABLE ROW LEVEL SECURITY;
ALTER TABLE horario_barbero  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente          ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicio         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cita             ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_cita     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueo_telefono ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- Función helper: obtener el rol del usuario autenticado
-- Lee de la tabla empleado usando el auth.uid() de Supabase
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION obtener_rol_usuario()
RETURNS rol_empleado
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rol rol_empleado;
BEGIN
  SELECT rol INTO v_rol
  FROM empleado
  WHERE auth_user_id = auth.uid();

  RETURN v_rol;
END;
$$;

-- Función helper: obtener la sucursal del usuario autenticado
CREATE OR REPLACE FUNCTION obtener_sucursal_usuario()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sucursal UUID;
BEGIN
  SELECT id_sucursal INTO v_sucursal
  FROM empleado
  WHERE auth_user_id = auth.uid();

  RETURN v_sucursal;
END;
$$;

-- Función helper: verificar si el usuario autenticado es cliente registrado
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


-- ------------------------------------------------------------
-- POLÍTICAS — SUCURSAL
-- ------------------------------------------------------------

-- Lectura pública (la landing muestra info de sucursales)
CREATE POLICY "sucursal_lectura_publica"
  ON sucursal FOR SELECT
  USING (activa = TRUE);

-- Solo admin_general puede crear/modificar sucursales
CREATE POLICY "sucursal_escritura_admin_general"
  ON sucursal FOR ALL
  USING (obtener_rol_usuario() = 'admin_general');


-- ------------------------------------------------------------
-- POLÍTICAS — SERVICIO
-- ------------------------------------------------------------

-- Lectura pública del catálogo activo
CREATE POLICY "servicio_lectura_publica"
  ON servicio FOR SELECT
  USING (activo = TRUE);

-- Solo admin_general modifica el catálogo
CREATE POLICY "servicio_escritura_admin_general"
  ON servicio FOR ALL
  USING (obtener_rol_usuario() = 'admin_general');


-- ------------------------------------------------------------
-- POLÍTICAS — EMPLEADO
-- ------------------------------------------------------------

-- Lectura pública de barberos activos (carrusel de la landing)
CREATE POLICY "empleado_lectura_publica_barberos"
  ON empleado FOR SELECT
  USING (activo = TRUE AND rol = 'barbero');

-- Admin de sucursal ve a sus empleados
CREATE POLICY "empleado_lectura_admin_sucursal"
  ON empleado FOR SELECT
  USING (
    obtener_rol_usuario() = 'admin_sucursal'
    AND id_sucursal = obtener_sucursal_usuario()
  );

-- Admin general ve todo
CREATE POLICY "empleado_lectura_admin_general"
  ON empleado FOR SELECT
  USING (obtener_rol_usuario() = 'admin_general');

-- Cada empleado ve y edita su propio perfil
CREATE POLICY "empleado_propio_perfil"
  ON empleado FOR ALL
  USING (auth_user_id = auth.uid());


-- ------------------------------------------------------------
-- POLÍTICAS — HORARIO_BARBERO
-- ------------------------------------------------------------

-- Lectura pública (para mostrar disponibilidad en la landing)
CREATE POLICY "horario_lectura_publica"
  ON horario_barbero FOR SELECT
  USING (activo = TRUE);

-- Admin de sucursal gestiona horarios de su sucursal
CREATE POLICY "horario_admin_sucursal"
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
-- POLÍTICAS — CLIENTE
-- ------------------------------------------------------------

-- Cliente registrado ve y edita su propio perfil
CREATE POLICY "cliente_propio_perfil"
  ON cliente FOR ALL
  USING (auth_user_id = auth.uid());

-- Admin de sucursal ve clientes (para búsqueda al registrar cita telefónica)
CREATE POLICY "cliente_lectura_admin"
  ON cliente FOR SELECT
  USING (obtener_rol_usuario() IN ('admin_sucursal', 'admin_general'));

-- Admin puede crear clientes anónimos (walk-in, telefónica)
CREATE POLICY "cliente_creacion_admin"
  ON cliente FOR INSERT
  WITH CHECK (obtener_rol_usuario() IN ('admin_sucursal', 'admin_general'));

-- Registro público (un nuevo cliente se registra solo)
CREATE POLICY "cliente_registro_publico"
  ON cliente FOR INSERT
  WITH CHECK (auth_user_id = auth.uid() AND tipo = 'registrado');


-- ------------------------------------------------------------
-- POLÍTICAS — CITA
-- ------------------------------------------------------------

-- Cliente registrado ve solo sus citas
CREATE POLICY "cita_cliente_sus_citas"
  ON cita FOR SELECT
  USING (
    id_cliente IN (
      SELECT id_cliente FROM cliente WHERE auth_user_id = auth.uid()
    )
  );

-- Cliente registrado crea citas online (validación extra en función)
CREATE POLICY "cita_cliente_crear_online"
  ON cita FOR INSERT
  WITH CHECK (
    origen = 'online'
    AND es_cliente_registrado()
    AND id_cliente IN (
      SELECT id_cliente FROM cliente WHERE auth_user_id = auth.uid()
    )
  );

-- Admin de sucursal gestiona citas de su sucursal
CREATE POLICY "cita_admin_sucursal"
  ON cita FOR ALL
  USING (
    obtener_rol_usuario() = 'admin_sucursal'
    AND id_sucursal = obtener_sucursal_usuario()
  );

-- Admin general ve todo
CREATE POLICY "cita_admin_general"
  ON cita FOR ALL
  USING (obtener_rol_usuario() = 'admin_general');


-- ------------------------------------------------------------
-- POLÍTICAS — DETALLE_CITA
-- ------------------------------------------------------------

-- Cliente ve el detalle de sus propias citas
CREATE POLICY "detalle_cliente"
  ON detalle_cita FOR SELECT
  USING (
    id_cita IN (
      SELECT c.id_cita FROM cita c
      JOIN cliente cl ON cl.id_cliente = c.id_cliente
      WHERE cl.auth_user_id = auth.uid()
    )
  );

-- Admin gestiona detalles de citas de su sucursal
CREATE POLICY "detalle_admin"
  ON detalle_cita FOR ALL
  USING (
    id_cita IN (
      SELECT id_cita FROM cita
      WHERE id_sucursal = obtener_sucursal_usuario()
         OR obtener_rol_usuario() = 'admin_general'
    )
  );


-- ------------------------------------------------------------
-- POLÍTICAS — BLOQUEO_TELEFONO
-- ------------------------------------------------------------

-- Solo admins gestionan bloqueos
CREATE POLICY "bloqueo_admin"
  ON bloqueo_telefono FOR ALL
  USING (obtener_rol_usuario() IN ('admin_sucursal', 'admin_general'));

-- El sistema (service_role) puede insertar/eliminar bloqueos via triggers
-- Los triggers usan SECURITY DEFINER y operan con privilegios elevados


-- ============================================================
-- 8. TAREA PROGRAMADA — Limpieza diaria de bloqueos vencidos
-- Requiere pg_cron habilitado en Supabase
-- ============================================================

SELECT cron.schedule(
  'limpiar_bloqueos_vencidos',   -- nombre del job
  '0 3 * * *',                    -- cada día a las 3:00 AM
  $$
    DELETE FROM bloqueo_telefono
    WHERE fecha_bloqueo < CURRENT_DATE;
  $$
);


-- ============================================================
-- 9. DATOS INICIALES — Semilla mínima para desarrollo
-- ============================================================

-- Sucursal real del cliente
INSERT INTO sucursal (nombre, direccion, telefono, horario_apertura, horario_cierre, buffer_reserva_min)
VALUES (
  'Academia De Barberia The Hipster',
  'Riobamba 690, Lindavista, CDMX, 07300',
  '5568410903',
  '09:00',
  '21:00',
  30
);

-- Catálogo de servicios inicial
INSERT INTO servicio (nombre, descripcion, duracion_min, precio, categoria) VALUES
  ('Corte Clásico',     'Degradado limpio, perfil definido.',                    30,  150.00, 'corte'),
  ('Arreglo de Barba',  'Perfilado, delineado y acabado con productos premium.', 20,  100.00, 'barba'),
  ('Corte + Barba',     'Corte degradado más arreglo completo de barba.',        50,  230.00, 'combo'),
  ('Diseño de Líneas',  'Grabados y fade artístico a máquina.',                  50,  200.00, 'diseno'),
  ('Tratamiento Facial','Limpieza profunda, vapor y mascarilla.',                45,  220.00, 'tratamiento'),
  ('Coloración',        'Mechas, tinte completo o decoloración.',                90,  350.00, 'color');


-- ############################################################
-- ## MODULO 02 — slots_y_vistas.sql
-- ############################################################

-- ============================================================
-- BARBER CERDAS — slots_y_vistas.sql
-- Semana 1 · Parte 2
-- Contenido:
--   1. Función: slots disponibles por barbero y fecha
--   2. Vista: estado del panel de barberos (dashboard admin)
--   3. Vista: cola del día por sucursal
--   4. Vista: citas del día con detalle completo
--   5. Vista: historial de cliente
-- ============================================================


-- ============================================================
-- 1. FUNCIÓN: obtener_slots_disponibles
-- Retorna los horarios libres de un barbero en una fecha dada.
-- Usada por la landing para mostrar horas disponibles al cliente.
--
-- Lógica:
--   a) Obtener turno del barbero ese día de la semana
--   b) Generar slots de N minutos (duración del servicio pedido)
--   c) Filtrar slots que:
--      - Caigan dentro del turno del barbero
--      - No traslapen con citas ya existentes
--      - Respeten el buffer_reserva_min de la sucursal
--      - No empiecen en el pasado
-- ============================================================
CREATE OR REPLACE FUNCTION obtener_slots_disponibles(
  p_id_empleado   UUID,
  p_fecha         DATE,
  p_duracion_min  INT       -- duración total del servicio solicitado
)
RETURNS TABLE (
  slot_inicio     TIMESTAMPTZ,
  slot_fin        TIMESTAMPTZ,
  disponible      BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_turno_inicio    TIME;
  v_turno_fin       TIME;
  v_dia_semana      dia_semana;
  v_buffer_min      INT;
  v_slot_actual     TIMESTAMPTZ;
  v_slot_fin        TIMESTAMPTZ;
  v_ahora           TIMESTAMPTZ := NOW();
  v_id_sucursal     UUID;
BEGIN
  -- Convertir fecha a día de semana en español
  v_dia_semana := LOWER(TO_CHAR(p_fecha, 'day'))::dia_semana;

  -- Obtener sucursal y buffer del empleado
  SELECT e.id_sucursal, s.buffer_reserva_min
  INTO v_id_sucursal, v_buffer_min
  FROM empleado e
  JOIN sucursal s ON s.id_sucursal = e.id_sucursal
  WHERE e.id_empleado = p_id_empleado;

  -- Obtener turno del barbero para ese día
  SELECT hora_inicio, hora_fin
  INTO v_turno_inicio, v_turno_fin
  FROM horario_barbero
  WHERE id_empleado = p_id_empleado
    AND dia_semana  = v_dia_semana
    AND activo      = TRUE;

  -- Si el barbero no trabaja ese día, no retorna nada
  IF v_turno_inicio IS NULL THEN
    RETURN;
  END IF;

  -- Generar slots cada p_duracion_min minutos dentro del turno
  v_slot_actual := (p_fecha + v_turno_inicio)::TIMESTAMPTZ AT TIME ZONE 'America/Mexico_City';

  LOOP
    v_slot_fin := v_slot_actual + (p_duracion_min || ' minutes')::INTERVAL;

    -- Parar si el slot se sale del turno
    EXIT WHEN v_slot_fin > (p_fecha + v_turno_fin)::TIMESTAMPTZ AT TIME ZONE 'America/Mexico_City';

    -- Verificar disponibilidad real
    slot_inicio := v_slot_actual;
    slot_fin    := v_slot_fin;
    disponible  := (
      -- El slot no está en el pasado ni dentro del buffer
      v_slot_actual > v_ahora + (v_buffer_min || ' minutes')::INTERVAL
      AND
      -- No existe ninguna cita activa que se traslape
      NOT EXISTS (
        SELECT 1 FROM cita c
        WHERE c.id_empleado = p_id_empleado
          AND c.estado NOT IN ('cancelada', 'no_presentada', 'completada')
          AND c.fecha_hora_inicio < v_slot_fin
          AND c.fecha_hora_fin    > v_slot_actual
      )
    );

    RETURN NEXT;

    -- Avanzar al siguiente slot
    v_slot_actual := v_slot_actual + (p_duracion_min || ' minutes')::INTERVAL;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION obtener_slots_disponibles IS
  'Retorna todos los slots del día para un barbero, marcando cuáles están disponibles.
   Respeta el turno del barbero, las citas existentes y el buffer de anticipación.
   Usada por la landing para el selector de horario.';


-- ============================================================
-- 2. VISTA: v_panel_barberos
-- Vista principal del dashboard del admin de sucursal.
-- Muestra cada barbero con su estado actual y su cita activa si tiene.
-- Actualizada en tiempo real via Supabase Realtime.
-- ============================================================
CREATE OR REPLACE VIEW v_panel_barberos AS
SELECT
  -- Datos del barbero
  e.id_empleado,
  e.id_sucursal,
  e.nombre                              AS barbero_nombre,
  e.apellidos                           AS barbero_apellidos,
  e.especialidad,
  e.foto_url,
  e.estado_actual,

  -- Cita activa actual (pendiente o en_curso hoy)
  c.id_cita,
  c.origen                              AS cita_origen,
  c.estado                              AS cita_estado,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.posicion_cola,
  c.nombre_walkin,
  c.telefono_walkin,
  c.notas,

  -- Datos del cliente si es registrado
  cl.nombre                             AS cliente_nombre,
  cl.apellido                           AS cliente_apellido,
  cl.telefono                           AS cliente_telefono,
  cl.email                              AS cliente_email,

  -- Servicios de la cita activa (concatenados para fácil lectura)
  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS servicios_nombres,

  -- Precio total de la cita activa
  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  )                                     AS precio_total,

  -- Minutos transcurridos desde que inició (útil para el timer del dashboard)
  CASE
    WHEN c.estado = 'en_curso' THEN
      EXTRACT(EPOCH FROM (NOW() - c.fecha_hora_inicio)) / 60
    ELSE NULL
  END                                   AS minutos_transcurridos,

  -- Minutos restantes estimados
  CASE
    WHEN c.estado = 'en_curso' THEN
      EXTRACT(EPOCH FROM (c.fecha_hora_fin - NOW())) / 60
    ELSE NULL
  END                                   AS minutos_restantes

FROM empleado e

-- LEFT JOIN para ver barberos aunque no tengan cita activa
LEFT JOIN cita c ON (
  c.id_empleado = e.id_empleado
  AND c.estado IN ('pendiente', 'en_curso')
  AND DATE(c.fecha_hora_inicio) = CURRENT_DATE
)
LEFT JOIN cliente cl ON cl.id_cliente = c.id_cliente

WHERE e.rol = 'barbero'
  AND e.activo = TRUE

ORDER BY
  -- Primero los que están en servicio, luego en espera, luego libres
  CASE e.estado_actual
    WHEN 'ocupado'   THEN 1
    WHEN 'en_espera' THEN 2
    WHEN 'libre'     THEN 3
    WHEN 'ausente'   THEN 4
  END,
  e.nombre;

COMMENT ON VIEW v_panel_barberos IS
  'Panel principal del dashboard. Muestra barberos de una sucursal con su estado
   y cita activa. Filtrar por id_sucursal en el frontend con RLS o WHERE explícito.';


-- ============================================================
-- 3. VISTA: v_cola_walkins
-- Vista de la cola de walk-ins del día para una sucursal.
-- Usada en la pantalla kiosko y en el dashboard del admin.
-- ============================================================
CREATE OR REPLACE VIEW v_cola_walkins AS
SELECT
  c.id_cita,
  c.id_sucursal,
  c.id_empleado,
  c.posicion_cola,
  c.estado,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.nombre_walkin,
  c.telefono_walkin,
  c.fecha_creacion,

  -- Nombre del barbero asignado
  e.nombre                              AS barbero_nombre,
  e.apellidos                           AS barbero_apellidos,
  e.estado_actual                       AS barbero_estado,

  -- Servicios solicitados
  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS servicios_nombres,

  -- Precio total
  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  )                                     AS precio_total,

  -- Tiempo estimado de espera en minutos
  -- (suma de duraciones de citas activas antes de esta en la cola)
  (
    SELECT COALESCE(
      SUM(
        EXTRACT(EPOCH FROM (c2.fecha_hora_fin - GREATEST(c2.fecha_hora_inicio, NOW()))) / 60
      ), 0
    )
    FROM cita c2
    WHERE c2.id_empleado = c.id_empleado
      AND c2.estado IN ('pendiente', 'en_curso')
      AND c2.posicion_cola < c.posicion_cola
      AND DATE(c2.fecha_hora_inicio) = CURRENT_DATE
  )                                     AS espera_estimada_min

FROM cita c
JOIN empleado e ON e.id_empleado = c.id_empleado

WHERE c.origen = 'walkin'
  AND DATE(c.fecha_hora_inicio) = CURRENT_DATE
  AND c.estado IN ('pendiente', 'en_curso')

ORDER BY c.id_empleado, c.posicion_cola;

COMMENT ON VIEW v_cola_walkins IS
  'Cola de walk-ins del día actual. Filtrar por id_sucursal en el frontend.
   Incluye tiempo estimado de espera por barbero.';


-- ============================================================
-- 4. VISTA: v_citas_del_dia
-- Vista completa de todas las citas del día para el admin.
-- Incluye online, telefónicas y walk-ins.
-- ============================================================
CREATE OR REPLACE VIEW v_citas_del_dia AS
SELECT
  c.id_cita,
  c.id_sucursal,
  c.id_empleado,
  c.origen,
  c.estado,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.posicion_cola,
  c.notas,
  c.motivo_cancelacion,
  c.fecha_creacion,

  -- Barbero
  e.nombre                              AS barbero_nombre,
  e.apellidos                           AS barbero_apellidos,

  -- Cliente (registrado o walk-in)
  COALESCE(cl.nombre,   c.nombre_walkin)   AS cliente_nombre,
  COALESCE(cl.apellido, '')                AS cliente_apellido,
  COALESCE(cl.telefono, c.telefono_walkin) AS cliente_telefono,
  cl.email                                 AS cliente_email,
  cl.tipo                                  AS cliente_tipo,

  -- Servicios
  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS servicios_nombres,

  -- Duración total en minutos
  (
    SELECT COALESCE(SUM(s.duracion_min), 0)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS duracion_total_min,

  -- Precio total
  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  )                                     AS precio_total

FROM cita c
JOIN empleado e ON e.id_empleado = c.id_empleado
LEFT JOIN cliente cl ON cl.id_cliente = c.id_cliente

WHERE DATE(c.fecha_hora_inicio) = CURRENT_DATE

ORDER BY c.fecha_hora_inicio, e.nombre;

COMMENT ON VIEW v_citas_del_dia IS
  'Todas las citas del día actual. Para el dashboard del admin de sucursal.
   Filtrar por id_sucursal en el frontend o agregar WHERE en consulta.';


-- ============================================================
-- 5. VISTA: v_historial_cliente
-- Historial completo de citas de un cliente registrado.
-- Usada en el perfil del cliente y para descarga de PDF.
-- ============================================================
CREATE OR REPLACE VIEW v_historial_cliente AS
SELECT
  c.id_cita,
  c.id_cliente,
  c.id_sucursal,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.estado,
  c.origen,
  c.notas,

  -- Sucursal
  su.nombre                             AS sucursal_nombre,
  su.direccion                          AS sucursal_direccion,

  -- Barbero que atendió
  e.nombre                              AS barbero_nombre,
  e.apellidos                           AS barbero_apellidos,

  -- Servicios recibidos
  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS servicios_nombres,

  -- Precio pagado (histórico, no el precio actual del servicio)
  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  )                                     AS total_pagado

FROM cita c
JOIN sucursal su ON su.id_sucursal = c.id_sucursal
JOIN empleado e  ON e.id_empleado  = c.id_empleado

WHERE c.estado IN ('completada', 'cancelada', 'no_presentada')

ORDER BY c.fecha_hora_inicio DESC;

COMMENT ON VIEW v_historial_cliente IS
  'Historial de citas terminadas por cliente. RLS garantiza que cada cliente
   solo vea sus propias citas. Usada también para generar PDFs de historial.';


-- ============================================================
-- 6. POLÍTICAS RLS PARA LAS VISTAS
-- Las vistas heredan RLS de las tablas base en PostgreSQL,
-- pero necesitamos asegurarnos que el acceso sea correcto.
-- ============================================================

-- Permitir que el admin de sucursal acceda a las vistas
-- (las vistas ya filtran por las tablas con RLS activo)

-- Dar acceso a las vistas al rol authenticated de Supabase
GRANT SELECT ON v_panel_barberos   TO authenticated;
GRANT SELECT ON v_cola_walkins     TO authenticated;
GRANT SELECT ON v_citas_del_dia    TO authenticated;
GRANT SELECT ON v_historial_cliente TO authenticated;

-- Lectura pública de barberos activos (carrusel de la landing)
-- La vista v_panel_barberos expone foto_url y estado_actual que la landing necesita
GRANT SELECT ON v_panel_barberos   TO anon;


-- ============================================================
-- 7. FUNCIÓN: registrar_walkin
-- Función de conveniencia para el admin de sucursal.
-- Crea el cliente anónimo y la cita walk-in en una sola operación.
-- Determina automáticamente al barbero con menos carga hoy.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_walkin(
  p_id_sucursal   UUID,
  p_nombre        VARCHAR,
  p_telefono      VARCHAR,
  p_id_servicio   UUID,
  p_id_empleado   UUID DEFAULT NULL  -- NULL = asignar automáticamente
)
RETURNS UUID  -- Retorna el id_cita creado
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_empleado     UUID;
  v_duracion        INT;
  v_precio          DECIMAL;
  v_inicio          TIMESTAMPTZ;
  v_fin             TIMESTAMPTZ;
  v_id_cita         UUID;
  v_posicion        INT;
BEGIN
  -- Obtener duración y precio del servicio
  SELECT duracion_min, precio INTO v_duracion, v_precio
  FROM servicio WHERE id_servicio = p_id_servicio;

  IF v_duracion IS NULL THEN
    RAISE EXCEPTION 'Servicio no encontrado: %', p_id_servicio;
  END IF;

  -- Si no se especificó barbero, asignar el que tenga menos carga hoy
  IF p_id_empleado IS NULL THEN
    SELECT e.id_empleado INTO v_id_empleado
    FROM empleado e
    WHERE e.id_sucursal = p_id_sucursal
      AND e.rol = 'barbero'
      AND e.activo = TRUE
      AND e.estado_actual != 'ausente'
    ORDER BY (
      -- Contar citas pendientes + en_curso hoy
      SELECT COUNT(*) FROM cita c
      WHERE c.id_empleado = e.id_empleado
        AND c.estado IN ('pendiente', 'en_curso')
        AND DATE(c.fecha_hora_inicio) = CURRENT_DATE
    ) ASC,
    -- Desempate: el que lleva más tiempo libre
    e.estado_actual ASC
    LIMIT 1;
  ELSE
    v_id_empleado := p_id_empleado;
  END IF;

  IF v_id_empleado IS NULL THEN
    RAISE EXCEPTION 'No hay barberos disponibles en esta sucursal';
  END IF;

  -- Calcular inicio: justo después de la última cita activa del barbero hoy
  SELECT COALESCE(MAX(fecha_hora_fin), NOW()) INTO v_inicio
  FROM cita
  WHERE id_empleado = v_id_empleado
    AND estado IN ('pendiente', 'en_curso')
    AND DATE(fecha_hora_inicio) = CURRENT_DATE;

  -- Si el inicio calculado es en el pasado, usar ahora
  IF v_inicio < NOW() THEN
    v_inicio := NOW();
  END IF;

  v_fin := v_inicio + (v_duracion || ' minutes')::INTERVAL;

  -- Calcular posición en cola
  v_posicion := siguiente_posicion_cola(v_id_empleado, CURRENT_DATE);

  -- Crear la cita walk-in
  INSERT INTO cita (
    id_sucursal,
    id_empleado,
    id_cliente,
    fecha_hora_inicio,
    fecha_hora_fin,
    origen,
    estado,
    nombre_walkin,
    telefono_walkin,
    posicion_cola
  ) VALUES (
    p_id_sucursal,
    v_id_empleado,
    NULL,               -- walk-in sin cuenta
    v_inicio,
    v_fin,
    'walkin',
    'pendiente',
    p_nombre,
    p_telefono,
    v_posicion
  )
  RETURNING id_cita INTO v_id_cita;

  -- Agregar el detalle del servicio
  INSERT INTO detalle_cita (id_cita, id_servicio, precio_aplicado, orden)
  VALUES (v_id_cita, p_id_servicio, v_precio, 1);

  RETURN v_id_cita;
END;
$$;

COMMENT ON FUNCTION registrar_walkin IS
  'Registra un walk-in en una sola llamada. Asigna automáticamente al barbero
   con menos carga si no se especifica. Crea la cita y el detalle del servicio.';


-- ============================================================
-- 8. FUNCIÓN: cambiar_estado_cita
-- Función central para el dashboard. Valida transiciones de estado.
-- Estados válidos: pendiente → en_curso → completada
--                  cualquiera → cancelada (con motivo obligatorio)
-- ============================================================
CREATE OR REPLACE FUNCTION cambiar_estado_cita(
  p_id_cita       UUID,
  p_nuevo_estado  estado_cita,
  p_motivo        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_estado_actual   estado_cita;
  v_id_sucursal     UUID;
  v_rol             rol_empleado;
BEGIN
  -- Obtener estado actual y sucursal de la cita
  SELECT estado, id_sucursal INTO v_estado_actual, v_id_sucursal
  FROM cita WHERE id_cita = p_id_cita;

  IF v_estado_actual IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cita no encontrada');
  END IF;

  -- Obtener rol del usuario que ejecuta la acción
  v_rol := obtener_rol_usuario();

  -- Verificar que el admin es de la misma sucursal
  IF v_rol = 'admin_sucursal' AND v_id_sucursal != obtener_sucursal_usuario() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin permisos para esta sucursal');
  END IF;

  -- Validar transiciones permitidas
  IF p_nuevo_estado = 'en_curso' AND v_estado_actual != 'pendiente' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Solo se puede iniciar una cita que esté pendiente'
    );
  END IF;

  IF p_nuevo_estado = 'completada' AND v_estado_actual != 'en_curso' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Solo se puede finalizar una cita que esté en curso'
    );
  END IF;

  IF p_nuevo_estado = 'cancelada' AND p_motivo IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Se requiere un motivo para cancelar una cita'
    );
  END IF;

  -- Ejecutar el cambio de estado
  UPDATE cita
  SET
    estado             = p_nuevo_estado,
    motivo_cancelacion = CASE WHEN p_nuevo_estado = 'cancelada' THEN p_motivo ELSE motivo_cancelacion END
  WHERE id_cita = p_id_cita;

  -- El trigger trg_actualizar_estado_barbero se dispara automáticamente aquí

  RETURN jsonb_build_object(
    'ok',           true,
    'id_cita',      p_id_cita,
    'estado_nuevo', p_nuevo_estado
  );
END;
$$;

COMMENT ON FUNCTION cambiar_estado_cita IS
  'Punto central de control para cambios de estado de citas en el dashboard.
   Valida transiciones, permisos y dispara el trigger de estado del barbero.';


-- ############################################################
-- ## MODULO 03 — fix_empleados.sql
-- ############################################################

-- ============================================================
-- FIX: Hacer auth_user_id nullable en empleado
-- Razón: durante desarrollo los barberos no tienen cuenta Auth.
-- Se vincula el auth_user_id con UPDATE cuando se creen las cuentas.
-- ============================================================

-- 1. Quitar NOT NULL de auth_user_id
ALTER TABLE empleado
  ALTER COLUMN auth_user_id DROP NOT NULL;

-- 2. Verificar que el cambio aplicó
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'column_name' AND column_name = 'auth_user_id';

-- ============================================================
-- SEED: Insertar empleados sin auth_user_id
-- ============================================================
DO $$
DECLARE
  v_id_sucursal UUID;
BEGIN
  SELECT id_sucursal INTO v_id_sucursal
  FROM sucursal
  WHERE nombre ILIKE '%Hipster%'
  LIMIT 1;

  IF v_id_sucursal IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada.';
  END IF;

  -- Admin general
  INSERT INTO empleado (id_sucursal, nombre, apellidos, email, rol, estado_actual, activo)
  VALUES (v_id_sucursal, 'Ricardo', 'Hernández', 'admin@barbercerdas.com', 'admin_general', 'libre', TRUE)
  ON CONFLICT DO NOTHING;

  -- Admin sucursal
  INSERT INTO empleado (id_sucursal, nombre, apellidos, email, rol, estado_actual, activo)
  VALUES (v_id_sucursal, 'Sofía', 'Martínez', 'sucursal@barbercerdas.com', 'admin_sucursal', 'libre', TRUE)
  ON CONFLICT DO NOTHING;

  -- Barberos
  INSERT INTO empleado (id_sucursal, nombre, apellidos, email, rol, especialidad, foto_url, estado_actual, activo)
  VALUES
  (
    v_id_sucursal, 'Carlos', 'Reyes', 'carlos@barbercerdas.com',
    'barbero', 'Degradados y cortes clásicos',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
    'libre', TRUE
  ),
  (
    v_id_sucursal, 'Miguel', 'Torres', 'miguel@barbercerdas.com',
    'barbero', 'Diseño de barba y perfilado',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80',
    'libre', TRUE
  ),
  (
    v_id_sucursal, 'Andrés', 'Vega', 'andres@barbercerdas.com',
    'barbero', 'Grabados y diseño de líneas',
    'https://images.unsplash.com/photo-1552058544-f2b08422138a?w=400&auto=format&fit=crop&q=80',
    'libre', TRUE
  ),
  (
    v_id_sucursal, 'Luis', 'Mendoza', 'luis@barbercerdas.com',
    'barbero', 'Coloración y tratamientos',
    'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&auto=format&fit=crop&q=80',
    'libre', TRUE
  );

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

  RAISE NOTICE 'Listo. Empleados y horarios insertados.';
END;
$$;

-- Verificación final
SELECT e.nombre, e.apellidos, e.rol, e.estado_actual,
       COUNT(h.id_horario) AS dias_laborales
FROM empleado e
LEFT JOIN horario_barbero h ON h.id_empleado = e.id_empleado
GROUP BY e.id_empleado, e.nombre, e.apellidos, e.rol, e.estado_actual
ORDER BY e.rol, e.nombre;


-- ############################################################
-- ## MODULO 04 — fix_rls_publica.sql
-- ############################################################

-- ============================================================
-- FIX RLS — Lectura pública para la landing
-- Problema: las políticas actuales bloquean requests anónimos
-- porque el frontend aún no tiene Supabase Auth implementado.
-- Solución: políticas explícitas para el rol 'anon' de Supabase.
-- ============================================================

-- ------------------------------------------------------------
-- SERVICIO — lectura pública del catálogo activo
-- ------------------------------------------------------------

-- Eliminar política anterior si existe
DROP POLICY IF EXISTS "servicio_lectura_publica" ON servicio;

-- Nueva política que acepta tanto anon como authenticated
CREATE POLICY "servicio_lectura_publica"
  ON servicio
  FOR SELECT
  TO anon, authenticated
  USING (activo = TRUE);


-- ------------------------------------------------------------
-- EMPLEADO — lectura pública de barberos activos
-- (para el carrusel de la landing y el select del modal)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "empleado_lectura_publica_barberos" ON empleado;

CREATE POLICY "empleado_lectura_publica_barberos"
  ON empleado
  FOR SELECT
  TO anon, authenticated
  USING (activo = TRUE AND rol = 'barbero');


-- ------------------------------------------------------------
-- HORARIO_BARBERO — lectura pública
-- (necesario para calcular slots disponibles)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "horario_lectura_publica" ON horario_barbero;

CREATE POLICY "horario_lectura_publica"
  ON horario_barbero
  FOR SELECT
  TO anon, authenticated
  USING (activo = TRUE);


-- ------------------------------------------------------------
-- SUCURSAL — lectura pública de sucursales activas
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "sucursal_lectura_publica" ON sucursal;

CREATE POLICY "sucursal_lectura_publica"
  ON sucursal
  FOR SELECT
  TO anon, authenticated
  USING (activa = TRUE);


-- ------------------------------------------------------------
-- CITA — permitir INSERT anónimo para reservas online
-- (el cliente aún no está logueado en esta fase)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "cita_cliente_crear_online" ON cita;

CREATE POLICY "cita_cliente_crear_online"
  ON cita
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (origen = 'online');


-- ------------------------------------------------------------
-- DETALLE_CITA — permitir INSERT anónimo
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "detalle_cliente" ON detalle_cita;

-- Lectura propia
CREATE POLICY "detalle_lectura_publica"
  ON detalle_cita
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

-- Inserción para crear citas
CREATE POLICY "detalle_insercion_publica"
  ON detalle_cita
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);


-- ------------------------------------------------------------
-- CLIENTE — permitir INSERT y SELECT anónimo
-- (para crear/buscar clientes al agendar)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "cliente_registro_publico"    ON cliente;
DROP POLICY IF EXISTS "cliente_creacion_admin"      ON cliente;

CREATE POLICY "cliente_lectura_por_telefono"
  ON cliente
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "cliente_insercion_publica"
  ON cliente
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (tipo = 'anonimo');


-- ------------------------------------------------------------
-- BLOQUEO_TELEFONO — permitir lectura para verificación
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "bloqueo_admin" ON bloqueo_telefono;

CREATE POLICY "bloqueo_lectura_publica"
  ON bloqueo_telefono
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

CREATE POLICY "bloqueo_insercion_sistema"
  ON bloqueo_telefono
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (TRUE);

CREATE POLICY "bloqueo_admin_full"
  ON bloqueo_telefono
  FOR ALL
  TO authenticated
  USING (TRUE);


-- ------------------------------------------------------------
-- Verificar que las vistas también son accesibles
-- ------------------------------------------------------------

-- La vista v_panel_barberos necesita acceso anon
GRANT SELECT ON v_panel_barberos    TO anon;
GRANT SELECT ON v_cola_walkins      TO anon;
GRANT SELECT ON v_citas_del_dia     TO anon;
GRANT SELECT ON v_historial_cliente TO anon;

-- Las funciones RPC necesitan permiso de ejecución
GRANT EXECUTE ON FUNCTION obtener_slots_disponibles  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION telefono_puede_reservar    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION barbero_disponible         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION registrar_walkin           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cambiar_estado_cita        TO anon, authenticated;


-- ------------------------------------------------------------
-- Verificación: simular una consulta anónima
-- ------------------------------------------------------------
SELECT 'servicios'  AS tabla, COUNT(*) AS registros FROM servicio  WHERE activo = TRUE
UNION ALL
SELECT 'barberos'   AS tabla, COUNT(*) AS registros FROM empleado  WHERE rol = 'barbero' AND activo = TRUE
UNION ALL
SELECT 'horarios'   AS tabla, COUNT(*) AS registros FROM horario_barbero WHERE activo = TRUE
UNION ALL
SELECT 'sucursales' AS tabla, COUNT(*) AS registros FROM sucursal  WHERE activa = TRUE;


-- ############################################################
-- ## MODULO 05 — fix_cola_solo_pendientes.sql
-- ############################################################

-- ============================================================
-- FIX: v_cola_walkins — mostrar solo estado 'pendiente'
-- Problema: la cola mostraba clientes en_curso (ya en la silla).
-- Una cola encola y desencola: en_curso = ya salió de la fila.
-- Los en_curso se ven en el panel de Barberos, no en la cola.
-- La subquery de espera_estimada sigue considerando en_curso
-- para calcular correctamente el tiempo de espera restante.
-- ============================================================
CREATE OR REPLACE VIEW v_cola_walkins AS
SELECT
  c.id_cita,
  c.id_sucursal,
  c.id_empleado,
  c.posicion_cola,
  c.estado,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.nombre_walkin,
  c.telefono_walkin,
  c.fecha_creacion,

  e.nombre                              AS barbero_nombre,
  e.apellidos                           AS barbero_apellidos,
  e.estado_actual                       AS barbero_estado,

  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS servicios_nombres,

  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  )                                     AS precio_total,

  -- Tiempo de espera: suma lo que falta de citas activas (pendiente + en_curso)
  -- con posición menor a esta en la cola del mismo barbero
  (
    SELECT COALESCE(
      SUM(
        EXTRACT(EPOCH FROM (c2.fecha_hora_fin - GREATEST(c2.fecha_hora_inicio, NOW()))) / 60
      ), 0
    )
    FROM cita c2
    WHERE c2.id_empleado = c.id_empleado
      AND c2.estado IN ('pendiente', 'en_curso')
      AND c2.posicion_cola < c.posicion_cola
      AND DATE(c2.fecha_hora_inicio) = CURRENT_DATE
  )                                     AS espera_estimada_min

FROM cita c
JOIN empleado e ON e.id_empleado = c.id_empleado

WHERE c.origen = 'walkin'
  AND DATE(c.fecha_hora_inicio) = CURRENT_DATE
  AND c.estado = 'pendiente'   -- solo en cola, los en_curso ya salieron

ORDER BY c.id_empleado, c.posicion_cola;


-- ############################################################
-- ## MODULO 06 — fix_grants_auth.sql
-- ############################################################

-- ============================================================
-- FIX: GRANT de tablas base para el rol authenticated
-- Problema: "permission denied for table empleado" al hacer login.
-- Causa: las tablas creadas via SQL Editor no reciben los GRANTs
--        automáticos que aplica el Dashboard de Supabase.
-- La política RLS "empleado_propio_perfil" existe y es correcta,
-- pero PostgreSQL rechaza antes de evaluarla si no hay GRANT.
-- ============================================================

-- El dashboard necesita leer el perfil del empleado al hacer login
GRANT SELECT ON empleado TO authenticated;

-- Las vistas del dashboard heredan de estas tablas;
-- si alguna falla en cascada, estos GRANTs las cubren
GRANT SELECT ON cita            TO authenticated;
GRANT SELECT ON detalle_cita    TO authenticated;
GRANT SELECT ON cliente         TO authenticated;
GRANT SELECT ON sucursal        TO authenticated;
GRANT SELECT ON horario_barbero TO authenticated;
GRANT SELECT ON servicio        TO authenticated;
GRANT SELECT ON bloqueo_telefono TO authenticated;

-- INSERT/UPDATE que necesita el admin de sucursal
-- (las RPC usan SECURITY DEFINER, pero por si se hace PATCH directo)
GRANT INSERT, UPDATE ON cita         TO authenticated;
GRANT INSERT, UPDATE ON detalle_cita TO authenticated;
GRANT INSERT        ON cliente       TO authenticated;

-- Verificación: debe mostrar los GRANTs recién aplicados
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;


-- ############################################################
-- ## MODULO 07 — fix_panel_barberos_v2.sql
-- ############################################################

-- ============================================================
-- FIX: v_panel_barberos v2
-- Problemas resueltos:
--   1. Duplicados: el LEFT JOIN anterior daba 1 fila por cita.
--      Con DISTINCT ON (id_empleado) en la CTE proxima_cita
--      garantizamos exactamente 1 fila por barbero.
--      Prioridad: en_curso > pendiente más próximo.
--
--   2. "Libre" falso: si el hueco antes del siguiente servicio
--      es menor que el servicio más corto del catálogo, el
--      barbero no puede atender un walk-in — se muestra en_espera.
-- ============================================================

CREATE OR REPLACE VIEW v_panel_barberos AS

WITH

-- Duración mínima del catálogo activo (para detectar huecos inútiles)
min_servicio AS (
  SELECT MIN(duracion_min) AS minutos
  FROM servicio
  WHERE activo = TRUE
),

-- Una sola cita por barbero: en_curso primero, luego el siguiente pendiente
proxima_cita AS (
  SELECT DISTINCT ON (id_empleado)
    id_cita,
    id_empleado,
    id_cliente,
    estado,
    origen,
    fecha_hora_inicio,
    fecha_hora_fin,
    posicion_cola,
    nombre_walkin,
    telefono_walkin,
    notas
  FROM cita
  WHERE estado IN ('en_curso', 'pendiente')
    AND DATE(fecha_hora_inicio) = CURRENT_DATE
  ORDER BY
    id_empleado,
    CASE estado WHEN 'en_curso' THEN 1 ELSE 2 END,
    fecha_hora_inicio ASC
)

SELECT
  e.id_empleado,
  e.id_sucursal,
  e.nombre                              AS barbero_nombre,
  e.apellidos                           AS barbero_apellidos,
  e.especialidad,
  e.foto_url,

  -- Estado efectivo: libre → en_espera si el hueco al próximo servicio
  -- es menor que la duración mínima del catálogo
  CASE
    WHEN e.estado_actual = 'libre'
     AND EXISTS (
       SELECT 1 FROM cita c2
       WHERE c2.id_empleado = e.id_empleado
         AND c2.estado      = 'pendiente'
         AND DATE(c2.fecha_hora_inicio) = CURRENT_DATE
         AND EXTRACT(EPOCH FROM (c2.fecha_hora_inicio - NOW())) / 60
             < (SELECT minutos FROM min_servicio)
     )
    THEN 'en_espera'::estado_barbero
    ELSE e.estado_actual
  END                                   AS estado_actual,

  c.id_cita,
  c.origen                              AS cita_origen,
  c.estado                              AS cita_estado,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.posicion_cola,
  c.nombre_walkin,
  c.telefono_walkin,
  c.notas,

  cl.nombre                             AS cliente_nombre,
  cl.apellido                           AS cliente_apellido,
  cl.telefono                           AS cliente_telefono,
  cl.email                              AS cliente_email,

  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  )                                     AS servicios_nombres,

  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  )                                     AS precio_total,

  CASE
    WHEN c.estado = 'en_curso'
    THEN EXTRACT(EPOCH FROM (NOW() - c.fecha_hora_inicio)) / 60
    ELSE NULL
  END                                   AS minutos_transcurridos,

  CASE
    WHEN c.estado = 'en_curso'
    THEN EXTRACT(EPOCH FROM (c.fecha_hora_fin - NOW())) / 60
    ELSE NULL
  END                                   AS minutos_restantes

FROM empleado e
LEFT JOIN proxima_cita c  ON c.id_empleado  = e.id_empleado
LEFT JOIN cliente      cl ON cl.id_cliente  = c.id_cliente

WHERE e.rol    = 'barbero'
  AND e.activo = TRUE

ORDER BY
  -- Ordenar por estado efectivo (mismo criterio que el CASE de arriba)
  CASE
    WHEN e.estado_actual = 'libre'
     AND EXISTS (
       SELECT 1 FROM cita c2
       WHERE c2.id_empleado = e.id_empleado
         AND c2.estado      = 'pendiente'
         AND DATE(c2.fecha_hora_inicio) = CURRENT_DATE
         AND EXTRACT(EPOCH FROM (c2.fecha_hora_inicio - NOW())) / 60
             < (SELECT minutos FROM min_servicio)
     )
    THEN 2
    ELSE CASE e.estado_actual
           WHEN 'ocupado'   THEN 1
           WHEN 'en_espera' THEN 2
           WHEN 'libre'     THEN 3
           WHEN 'ausente'   THEN 4
         END
  END,
  e.nombre;

-- Re-aplicar permisos (CREATE OR REPLACE los borra)
GRANT SELECT ON v_panel_barberos TO anon, authenticated;


-- ############################################################
-- ## MODULO 08 — fix_empleado_auth_policy.sql
-- ############################################################

-- ============================================================
-- FIX: Política SELECT de empleado para authenticated
-- Problema: fix_rls_segura.sql definió una sola política
--   "empleado_lectura_publica_barberos" para anon Y authenticated,
--   restringiendo a rol='barbero'. Esto impide que un admin
--   (rol='admin') consulte su propio registro de empleado,
--   rompiendo cargarEmpleadoActual() en el dashboard y el
--   nuevo flujo de detección de admin en la landing.
-- Solución: separar en dos políticas — anon solo ve barberos,
--   authenticated ve todos los empleados activos.
-- ============================================================

-- Quitar políticas anteriores (cualquier versión)
DROP POLICY IF EXISTS "empleado_lectura_publica_barberos" ON empleado;
DROP POLICY IF EXISTS "empleado_anon_barberos"            ON empleado;
DROP POLICY IF EXISTS "empleado_auth_todos"               ON empleado;

-- anon: solo barberos activos (catálogo público, sin PII de admins)
CREATE POLICY "empleado_anon_barberos"
  ON empleado
  FOR SELECT
  TO anon
  USING (activo = TRUE AND rol = 'barbero');

-- authenticated: todos los empleados activos (dashboard necesita ver admins también)
CREATE POLICY "empleado_auth_todos"
  ON empleado
  FOR SELECT
  TO authenticated
  USING (activo = TRUE);


-- ############################################################
-- ## MODULO 09 — fix_rls_segura.sql
-- ############################################################

-- ============================================================
-- RLS SEGURA — Máxima seguridad + funcionalidad completa
-- ============================================================
-- Regla de oro:
--   anon  → solo lee datos PÚBLICOS (catálogo, barberos)
--           + puede crear citas online + buscar su propio cliente
--   authenticated → acceso completo al dashboard
--
-- Problemas corregidos respecto a fix_rls_publica.sql:
--   1. v_citas_del_dia y v_cola_walkins ya no son accesibles a anon
--   2. cliente SELECT no usa USING(TRUE) — se usa función SECURITY DEFINER
--   3. cita INSERT para authenticated permite cualquier origen
--   4. cita e historial solo para authenticated
-- ============================================================


-- ============================================================
-- 0. LIMPIAR POLÍTICAS ANTERIORES
-- ============================================================

-- Servicios
DROP POLICY IF EXISTS "servicio_lectura_publica"            ON servicio;

-- Empleados
DROP POLICY IF EXISTS "empleado_lectura_publica_barberos"   ON empleado;

-- Horarios
DROP POLICY IF EXISTS "horario_lectura_publica"             ON horario_barbero;

-- Sucursal
DROP POLICY IF EXISTS "sucursal_lectura_publica"            ON sucursal;

-- Cita
DROP POLICY IF EXISTS "cita_cliente_crear_online"           ON cita;
DROP POLICY IF EXISTS "cita_dashboard_total"                ON cita;

-- Detalle cita
DROP POLICY IF EXISTS "detalle_lectura_publica"             ON detalle_cita;
DROP POLICY IF EXISTS "detalle_insercion_publica"           ON detalle_cita;
DROP POLICY IF EXISTS "detalle_cliente"                     ON detalle_cita;

-- Cliente
DROP POLICY IF EXISTS "cliente_registro_publico"            ON cliente;
DROP POLICY IF EXISTS "cliente_creacion_admin"              ON cliente;
DROP POLICY IF EXISTS "cliente_lectura_por_telefono"        ON cliente;
DROP POLICY IF EXISTS "cliente_insercion_publica"           ON cliente;

-- Bloqueo
DROP POLICY IF EXISTS "bloqueo_admin"                       ON bloqueo_telefono;
DROP POLICY IF EXISTS "bloqueo_lectura_publica"             ON bloqueo_telefono;
DROP POLICY IF EXISTS "bloqueo_insercion_sistema"           ON bloqueo_telefono;
DROP POLICY IF EXISTS "bloqueo_admin_full"                  ON bloqueo_telefono;


-- ============================================================
-- 1. DATOS PÚBLICOS — lectura anónima segura
--    (sin PII, solo catálogo y disponibilidad)
-- ============================================================

-- Catálogo de servicios activos (ningún dato personal)
CREATE POLICY "servicio_lectura_publica"
  ON servicio
  FOR SELECT
  TO anon, authenticated
  USING (activo = TRUE);

-- Barberos activos (solo rol 'barbero', nunca admins)
CREATE POLICY "empleado_lectura_publica_barberos"
  ON empleado
  FOR SELECT
  TO anon, authenticated
  USING (activo = TRUE AND rol = 'barbero');

-- Horarios de barberos (necesario para calcular slots)
CREATE POLICY "horario_lectura_publica"
  ON horario_barbero
  FOR SELECT
  TO anon, authenticated
  USING (activo = TRUE);

-- Datos de sucursal (nombre, dirección, buffer)
CREATE POLICY "sucursal_lectura_publica"
  ON sucursal
  FOR SELECT
  TO anon, authenticated
  USING (activa = TRUE);


-- ============================================================
-- 2. CITAS — segmentado por rol
-- ============================================================

-- anon: solo puede crear reservas online
CREATE POLICY "cita_crear_online_anonimo"
  ON cita
  FOR INSERT
  TO anon
  WITH CHECK (origen = 'online');

-- authenticated: acceso total (todas las operaciones)
CREATE POLICY "cita_dashboard_admin"
  ON cita
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ============================================================
-- 3. DETALLE_CITA
-- ============================================================

-- anon: solo insertar (para crear citas online)
CREATE POLICY "detalle_insercion_anonimo"
  ON detalle_cita
  FOR INSERT
  TO anon
  WITH CHECK (TRUE);

-- authenticated: acceso total
CREATE POLICY "detalle_dashboard_admin"
  ON detalle_cita
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ============================================================
-- 4. CLIENTE — protegido, nunca SELECT libre para anon
--    La lectura anónima se hace SOLO via función SECURITY DEFINER
-- ============================================================

-- anon: NO puede hacer SELECT directo en cliente
--       (se usa buscar_cliente_por_telefono en su lugar)

-- anon: puede crear clientes anónimos al agendar
CREATE POLICY "cliente_insercion_anonimo"
  ON cliente
  FOR INSERT
  TO anon
  WITH CHECK (tipo = 'anonimo');

-- authenticated: acceso total
CREATE POLICY "cliente_admin_total"
  ON cliente
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ============================================================
-- 5. BLOQUEO DE TELÉFONO — solo via funciones RPC
-- ============================================================

CREATE POLICY "bloqueo_admin_total"
  ON bloqueo_telefono
  FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ============================================================
-- 6. FUNCIÓN SEGURA — buscar cliente por teléfono
--    Evita que anon enumere toda la tabla.
--    Devuelve solo el cliente con ese teléfono exacto.
-- ============================================================

CREATE OR REPLACE FUNCTION buscar_cliente_por_telefono(p_telefono TEXT)
RETURNS TABLE(id_cliente UUID, nombre VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id_cliente, c.nombre
  FROM cliente c
  WHERE c.telefono = p_telefono
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION buscar_cliente_por_telefono IS
  'Busca un cliente por teléfono exacto. SECURITY DEFINER para evitar
   que el rol anon enumere toda la tabla cliente. Devuelve solo id y nombre.';

GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono TO anon, authenticated;


-- ============================================================
-- 7. GRANTS DE TABLAS BASE
-- ============================================================

-- Lectura pública (catálogo)
GRANT SELECT ON servicio        TO anon;
GRANT SELECT ON empleado        TO anon;
GRANT SELECT ON horario_barbero TO anon;
GRANT SELECT ON sucursal        TO anon;

-- Escritura anónima (booking online)
GRANT INSERT ON cita         TO anon;
GRANT INSERT ON detalle_cita TO anon;
GRANT INSERT ON cliente      TO anon;

-- Authenticated: acceso completo al dashboard
GRANT SELECT, INSERT, UPDATE, DELETE ON cita            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_cita    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cliente         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bloqueo_telefono TO authenticated;
GRANT SELECT ON empleado        TO authenticated;
GRANT SELECT ON horario_barbero TO authenticated;
GRANT SELECT ON sucursal        TO authenticated;
GRANT SELECT ON servicio        TO authenticated;


-- ============================================================
-- 8. VISTAS — acceso restrictivo
-- ============================================================

-- v_panel_barberos: pública (solo datos de disponibilidad, sin PII)
GRANT SELECT ON v_panel_barberos TO anon, authenticated;

-- SENSIBLES: solo authenticated (contienen nombres y teléfonos de clientes)
REVOKE SELECT ON v_citas_del_dia     FROM anon;
REVOKE SELECT ON v_cola_walkins      FROM anon;
REVOKE SELECT ON v_historial_cliente FROM anon;

GRANT SELECT ON v_citas_del_dia     TO authenticated;
GRANT SELECT ON v_cola_walkins      TO authenticated;
GRANT SELECT ON v_historial_cliente TO authenticated;


-- ============================================================
-- 9. FUNCIONES RPC — permisos de ejecución
-- ============================================================

GRANT EXECUTE ON FUNCTION obtener_slots_disponibles TO anon, authenticated;
GRANT EXECUTE ON FUNCTION telefono_puede_reservar   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION barbero_disponible        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION registrar_walkin          TO authenticated;  -- solo admin
GRANT EXECUTE ON FUNCTION cambiar_estado_cita       TO authenticated;  -- solo admin


-- ============================================================
-- 10. VERIFICACIÓN FINAL
-- ============================================================

-- Debe mostrar 0 para anon en tablas sensibles
SELECT
  'cliente anon'       AS prueba,
  count(*)             AS filas_visibles
FROM cliente;  -- ejecutar como anon para verificar (debe dar 0 o error)

-- Debe funcionar para anon
SELECT count(*) AS servicios_publicos FROM servicio  WHERE activo = TRUE;
SELECT count(*) AS barberos_publicos  FROM empleado  WHERE activo = TRUE AND rol = 'barbero';


-- ############################################################
-- ## MODULO 10 — fix_slots_dia_semana.sql
-- ############################################################

-- ============================================================
-- FIX: obtener_slots_disponibles — 3 bugs corregidos
--
-- Bug 1 (locale): TO_CHAR(date, 'day') devuelve nombres en inglés
--   ("tuesday   ") que no matchean el ENUM en español ('martes').
--   Solución: EXTRACT(DOW) con CASE, locale-independent.
--
-- Bug 2 (timezone): (fecha + hora)::TIMESTAMPTZ AT TIME ZONE 'México'
--   interpreta la hora como UTC y luego la convierte → desplaza los
--   slots 5-6 h hacia atrás, haciendo que todos parezcan pasados.
--   Solución: construir el timestamp como texto y usar AT TIME ZONE
--   sobre TIMESTAMP (sin tz) para interpretarlo como hora local MX.
--
-- Bug 3 (permisos anon): función con SECURITY INVOKER requiere que
--   el rol llamador (anon) tenga GRANT directo en empleado y sucursal.
--   Solución: SECURITY DEFINER — corre como postgres, sin restricciones.
-- ============================================================

CREATE OR REPLACE FUNCTION obtener_slots_disponibles(
  p_id_empleado   UUID,
  p_fecha         DATE,
  p_duracion_min  INT
)
RETURNS TABLE (
  slot_inicio     TIMESTAMPTZ,
  slot_fin        TIMESTAMPTZ,
  disponible      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_turno_inicio    TIME;
  v_turno_fin       TIME;
  v_dia_semana      dia_semana;
  v_buffer_min      INT;
  v_slot_actual     TIMESTAMPTZ;
  v_slot_fin_ts     TIMESTAMPTZ;
  v_turno_fin_ts    TIMESTAMPTZ;
  v_ahora           TIMESTAMPTZ := NOW();
BEGIN
  -- Bug 1 fix: día de semana en español, locale-independent
  v_dia_semana := CASE EXTRACT(DOW FROM p_fecha)
    WHEN 1 THEN 'lunes'
    WHEN 2 THEN 'martes'
    WHEN 3 THEN 'miercoles'
    WHEN 4 THEN 'jueves'
    WHEN 5 THEN 'viernes'
    WHEN 6 THEN 'sabado'
    WHEN 0 THEN 'domingo'
  END::dia_semana;

  -- Obtener buffer de anticipación de la sucursal del barbero
  SELECT COALESCE(s.buffer_reserva_min, 0)
  INTO   v_buffer_min
  FROM   empleado e
  JOIN   sucursal s ON s.id_sucursal = e.id_sucursal
  WHERE  e.id_empleado = p_id_empleado;

  -- Fallback si el JOIN no devuelve nada
  v_buffer_min := COALESCE(v_buffer_min, 0);

  -- Obtener turno del barbero para ese día de semana
  SELECT hora_inicio, hora_fin
  INTO   v_turno_inicio, v_turno_fin
  FROM   horario_barbero
  WHERE  id_empleado = p_id_empleado
    AND  dia_semana  = v_dia_semana
    AND  activo      = TRUE;

  -- Si el barbero no trabaja ese día, no retorna filas
  IF v_turno_inicio IS NULL THEN
    RETURN;
  END IF;

  -- Bug 2 fix: construir timestamps interpretando la hora como México City.
  -- TIMESTAMP (sin tz) AT TIME ZONE 'timezone' → TIMESTAMPTZ (convierte a UTC).
  -- Esto es correcto: '09:00' en México City = '14:00 UTC' (CDT, UTC-5).
  v_slot_actual  := (p_fecha::TEXT || ' ' || v_turno_inicio::TEXT)::TIMESTAMP
                    AT TIME ZONE 'America/Mexico_City';
  v_turno_fin_ts := (p_fecha::TEXT || ' ' || v_turno_fin::TEXT)::TIMESTAMP
                    AT TIME ZONE 'America/Mexico_City';

  LOOP
    v_slot_fin_ts := v_slot_actual + (p_duracion_min || ' minutes')::INTERVAL;

    -- Salir si el slot se sale del turno del barbero
    EXIT WHEN v_slot_fin_ts > v_turno_fin_ts;

    slot_inicio := v_slot_actual;
    slot_fin    := v_slot_fin_ts;
    disponible  := (
      -- El slot empieza después del "ahora + buffer"
      v_slot_actual > v_ahora + (v_buffer_min || ' minutes')::INTERVAL
      AND
      -- No traslapa con ninguna cita activa del barbero
      NOT EXISTS (
        SELECT 1 FROM cita c
        WHERE  c.id_empleado = p_id_empleado
          AND  c.estado NOT IN ('cancelada', 'no_presentada', 'completada')
          AND  c.fecha_hora_inicio < v_slot_fin_ts
          AND  c.fecha_hora_fin    > v_slot_actual
      )
    );

    RETURN NEXT;

    v_slot_actual := v_slot_actual + (p_duracion_min || ' minutes')::INTERVAL;
  END LOOP;
END;
$$;

-- Re-aplicar GRANTs (SECURITY DEFINER los necesita explícitos)
GRANT EXECUTE ON FUNCTION obtener_slots_disponibles TO anon, authenticated;


-- ############################################################
-- ## MODULO 11 — create_buscar_cliente.sql
-- ############################################################

-- ============================================================
-- NUEVA FUNCIÓN: buscar_cliente_por_telefono
--
-- Usada por:
--   - dashboard.js (Reserva Telefónica): busca si el cliente
--     ya existe antes de crear la cita telefónica.
--   - script.js (landing): busca cliente al agendar online.
--
-- SECURITY DEFINER para evitar problemas de RLS en tabla cliente.
-- ============================================================

-- Eliminar todas las versiones previas (puede haber firma distinta)
DROP FUNCTION IF EXISTS buscar_cliente_por_telefono(TEXT);
DROP FUNCTION IF EXISTS buscar_cliente_por_telefono(VARCHAR);
DROP FUNCTION IF EXISTS buscar_cliente_por_telefono(CHARACTER VARYING);

CREATE OR REPLACE FUNCTION buscar_cliente_por_telefono(p_telefono VARCHAR)
RETURNS TABLE (
  id_cliente  UUID,
  nombre      VARCHAR,
  apellido    VARCHAR,
  email       VARCHAR,
  tipo        tipo_cliente
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id_cliente, nombre, apellido, email, tipo
  FROM   cliente
  WHERE  telefono = p_telefono
  LIMIT  1;
$$;

GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono TO anon, authenticated;


-- ############################################################
-- ## MODULO 12 — fix_rls_cita_telefonica.sql
-- ############################################################

-- ============================================================
-- FIX: Políticas RLS para cita y detalle_cita
--
-- Problema: el schema original bloqueaba anon con:
--   cita_cliente_crear_online → requiere es_cliente_registrado()
--   que siempre devuelve FALSE para anon (auth.uid() IS NULL).
--   Además, detalle_cita no tenía política para anon INSERT.
--
-- Este archivo es idempotente: elimina todas las versiones
-- previas antes de recrear. Correr una sola vez resuelve
-- "new row violates row-level security policy for table cita/detalle_cita".
-- ============================================================


-- ============================================================
-- TABLA: cita
-- ============================================================

DROP POLICY IF EXISTS "cita_cliente_sus_citas"        ON cita;
DROP POLICY IF EXISTS "cita_cliente_crear_online"     ON cita;
DROP POLICY IF EXISTS "cita_admin_sucursal"           ON cita;
DROP POLICY IF EXISTS "cita_admin_general"            ON cita;
DROP POLICY IF EXISTS "cita_anon_online"              ON cita;
DROP POLICY IF EXISTS "cita_anon_select"              ON cita;
DROP POLICY IF EXISTS "cita_admin_cualquier_origen"   ON cita;
DROP POLICY IF EXISTS "cita_admin_select"             ON cita;
DROP POLICY IF EXISTS "cita_auth_select"              ON cita;
DROP POLICY IF EXISTS "cita_auth_insert"              ON cita;
DROP POLICY IF EXISTS "cita_auth_update"              ON cita;

CREATE POLICY "cita_anon_online"
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


-- ============================================================
-- TABLA: cliente
-- ============================================================

DROP POLICY IF EXISTS "cliente_propio_perfil"      ON cliente;
DROP POLICY IF EXISTS "cliente_lectura_admin"       ON cliente;
DROP POLICY IF EXISTS "cliente_creacion_admin"      ON cliente;
DROP POLICY IF EXISTS "cliente_registro_publico"    ON cliente;
DROP POLICY IF EXISTS "cliente_anon_insert"         ON cliente;
DROP POLICY IF EXISTS "cliente_anon_select"         ON cliente;
DROP POLICY IF EXISTS "cliente_auth_all"            ON cliente;

CREATE POLICY "cliente_anon_select"
  ON cliente FOR SELECT
  TO anon
  USING (TRUE);

CREATE POLICY "cliente_anon_insert"
  ON cliente FOR INSERT
  TO anon
  WITH CHECK (tipo = 'anonimo');

CREATE POLICY "cliente_auth_all"
  ON cliente FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ============================================================
-- TABLA: detalle_cita
-- ============================================================

DROP POLICY IF EXISTS "detalle_cliente"              ON detalle_cita;
DROP POLICY IF EXISTS "detalle_admin"                ON detalle_cita;
DROP POLICY IF EXISTS "detalle_anon_insert"          ON detalle_cita;
DROP POLICY IF EXISTS "detalle_anon_select"          ON detalle_cita;
DROP POLICY IF EXISTS "detalle_auth_all"             ON detalle_cita;

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


-- ============================================================
-- Verificación
-- ============================================================
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('cita', 'detalle_cita', 'cliente')
ORDER BY tablename, policyname;


-- ############################################################
-- ## MODULO 13 — fix_triggers_security_definer.sql
-- ############################################################

-- ============================================================
-- FIX: Funciones de trigger con SECURITY DEFINER
--
-- Problema: los triggers que se ejecutan al insertar/actualizar
--   una cita corren con los permisos del usuario que llama
--   (anon o authenticated), no del dueño de la tabla (postgres).
--   Esto causa "permission denied for table bloqueo_telefono"
--   al reservar desde la landing (anon), y
--   "permission denied for table empleado" al crear citas desde
--   el dashboard (authenticated necesita UPDATE en empleado).
--
-- Solución: SECURITY DEFINER en las tres funciones de trigger.
--   Corren como postgres → sin restricciones de RLS/GRANT.
-- ============================================================


-- ------------------------------------------------------------
-- Trigger 1: registrar bloqueo de teléfono al crear cita online
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_bloquear_telefono()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_telefono VARCHAR;
BEGIN
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


-- ------------------------------------------------------------
-- Trigger 2: liberar bloqueo si la cita se cancela
-- ------------------------------------------------------------
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


-- ------------------------------------------------------------
-- Trigger 3: actualizar estado del barbero según sus citas
-- ------------------------------------------------------------
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


-- ############################################################
-- ## MODULO 14 — fix_funciones_security_definer.sql
-- ############################################################

-- ============================================================
-- FIX: Funciones RPC con SECURITY DEFINER
--
-- Problema: las funciones que consultan bloqueo_telefono, cita y
--   empleado corren como el usuario llamador (anon/authenticated).
--   anon no tiene GRANT directo en bloqueo_telefono → error al
--   verificar el anti-spam antes de crear una cita online.
--
-- Solución: SECURITY DEFINER en todas las funciones RPC que
--   acceden a tablas restringidas. Corren como postgres.
-- ============================================================

-- Verificación anti-spam: ¿puede este teléfono reservar hoy?
CREATE OR REPLACE FUNCTION telefono_puede_reservar(
  p_telefono    VARCHAR,
  p_id_sucursal UUID,
  p_fecha       DATE DEFAULT CURRENT_DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existe INT;
BEGIN
  SELECT COUNT(*) INTO v_existe
  FROM bloqueo_telefono
  WHERE telefono     = p_telefono
    AND id_sucursal  = p_id_sucursal
    AND fecha_bloqueo = p_fecha;

  RETURN v_existe = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION telefono_puede_reservar TO anon, authenticated;


-- Verificación de traslape: ¿está libre el barbero en ese rango?
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


-- ############################################################
-- ## MODULO 15 — fix_grants_completo.sql
-- ############################################################

-- ============================================================
-- FIX: GRANTs completos para anon y authenticated
--
-- Problema raíz: las tablas creadas via SQL Editor NO reciben
--   los GRANTs automáticos que aplica el Dashboard de Supabase.
--   Las políticas RLS existen pero PostgreSQL rechaza el acceso
--   antes de evaluarlas si no hay GRANT de base.
--
-- Este archivo es idempotente: GRANT no falla si ya existe.
-- Correr una sola vez cubre todos los errores "permission denied".
-- ============================================================

-- ============================================================
-- ROL anon — usuario no autenticado (landing, kiosko)
-- ============================================================

-- Lectura de catálogo público
GRANT SELECT ON servicio        TO anon;
GRANT SELECT ON empleado        TO anon;
GRANT SELECT ON horario_barbero TO anon;
GRANT SELECT ON sucursal        TO anon;

-- Crear citas online (flujo de reserva en la landing)
GRANT SELECT, INSERT ON cita         TO anon;
GRANT SELECT, INSERT ON detalle_cita TO anon;

-- Crear/buscar cliente anónimo al reservar
GRANT SELECT, INSERT ON cliente TO anon;

-- El trigger trg_bloquear_telefono necesita leer/escribir bloqueos
-- (aunque es SECURITY DEFINER, el GRANT en la tabla garantiza consistencia)
GRANT SELECT, INSERT ON bloqueo_telefono TO anon;

-- Vistas del dashboard (carrusel de barberos en la landing)
GRANT SELECT ON v_panel_barberos    TO anon;
GRANT SELECT ON v_cola_walkins      TO anon;
GRANT SELECT ON v_citas_del_dia     TO anon;
GRANT SELECT ON v_historial_cliente TO anon;

-- Funciones RPC públicas
GRANT EXECUTE ON FUNCTION obtener_slots_disponibles  TO anon;
GRANT EXECUTE ON FUNCTION telefono_puede_reservar    TO anon;
GRANT EXECUTE ON FUNCTION barbero_disponible         TO anon;
GRANT EXECUTE ON FUNCTION registrar_walkin           TO anon;
GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono TO anon;


-- ============================================================
-- ROL authenticated — admin de sucursal (dashboard)
-- ============================================================

-- Lectura de todas las tablas base
GRANT SELECT ON empleado        TO authenticated;
GRANT SELECT ON horario_barbero TO authenticated;
GRANT SELECT ON sucursal        TO authenticated;
GRANT SELECT ON servicio        TO authenticated;

-- Gestión de citas (crear, leer, actualizar)
GRANT SELECT, INSERT, UPDATE ON cita         TO authenticated;
GRANT SELECT, INSERT, UPDATE ON detalle_cita TO authenticated;

-- Gestión de clientes
GRANT SELECT, INSERT, UPDATE ON cliente TO authenticated;

-- Gestión de bloqueos (cancelaciones liberan bloqueos)
GRANT SELECT, INSERT, UPDATE, DELETE ON bloqueo_telefono TO authenticated;

-- Vistas del dashboard
GRANT SELECT ON v_panel_barberos    TO authenticated;
GRANT SELECT ON v_cola_walkins      TO authenticated;
GRANT SELECT ON v_citas_del_dia     TO authenticated;
GRANT SELECT ON v_historial_cliente TO authenticated;

-- Funciones RPC del dashboard
GRANT EXECUTE ON FUNCTION obtener_slots_disponibles   TO authenticated;
GRANT EXECUTE ON FUNCTION telefono_puede_reservar     TO authenticated;
GRANT EXECUTE ON FUNCTION barbero_disponible          TO authenticated;
GRANT EXECUTE ON FUNCTION registrar_walkin            TO authenticated;
GRANT EXECUTE ON FUNCTION cambiar_estado_cita         TO authenticated;
GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono TO authenticated;


-- ============================================================
-- Verificación rápida
-- ============================================================
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('cita','cliente','detalle_cita','empleado',
                     'bloqueo_telefono','servicio','sucursal','horario_barbero')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;


-- ############################################################
-- ## MODULO 16 — fix_permisos_definitivo.sql
-- ############################################################

-- ============================================================
-- FIX DEFINITIVO — Permisos y RLS para landing (anon)
--
-- Ejecutar una sola vez en Supabase SQL Editor.
-- Es idempotente: elimina todo y reconstruye desde cero.
--
-- Resuelve: "permission denied for table cita"
-- ============================================================


-- ============================================================
-- 1. LIMPIAR TODAS LAS POLÍTICAS EXISTENTES
-- Usamos DO para borrar dinámicamente CUALQUIER política
-- en estas tablas, sin importar el nombre que tenga.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('cita', 'detalle_cita', 'cliente', 'bloqueo_telefono')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END;
$$;


-- ============================================================
-- 2. GRANTS — primero los permisos de tabla (sin esto, RLS ni corre)
-- ============================================================

-- anon: catálogo público
GRANT SELECT ON servicio        TO anon;
GRANT SELECT ON empleado        TO anon;
GRANT SELECT ON horario_barbero TO anon;
GRANT SELECT ON sucursal        TO anon;

-- anon: flujo de reserva online
GRANT SELECT, INSERT, UPDATE ON cita            TO anon;  -- UPDATE: trigger recalcula fecha_hora_fin
GRANT SELECT, INSERT ON detalle_cita           TO anon;
GRANT SELECT, INSERT ON cliente                TO anon;
GRANT SELECT, INSERT ON bloqueo_telefono       TO anon;

-- anon: vistas
GRANT SELECT ON v_panel_barberos TO anon;

-- anon: funciones RPC
GRANT EXECUTE ON FUNCTION obtener_slots_disponibles    TO anon;
GRANT EXECUTE ON FUNCTION telefono_puede_reservar      TO anon;
GRANT EXECUTE ON FUNCTION barbero_disponible           TO anon;
GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono  TO anon;

-- authenticated: todas las tablas
GRANT SELECT ON servicio        TO authenticated;
GRANT SELECT ON empleado        TO authenticated;
GRANT SELECT ON horario_barbero TO authenticated;
GRANT SELECT ON sucursal        TO authenticated;

GRANT SELECT, INSERT, UPDATE        ON cita             TO authenticated;
GRANT SELECT, INSERT, UPDATE        ON detalle_cita     TO authenticated;
GRANT SELECT, INSERT, UPDATE        ON cliente          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bloqueo_telefono TO authenticated;

-- authenticated: vistas
GRANT SELECT ON v_panel_barberos    TO authenticated;
GRANT SELECT ON v_cola_walkins      TO authenticated;
GRANT SELECT ON v_citas_del_dia     TO authenticated;
GRANT SELECT ON v_historial_cliente TO authenticated;

-- authenticated: funciones RPC
GRANT EXECUTE ON FUNCTION obtener_slots_disponibles    TO authenticated;
GRANT EXECUTE ON FUNCTION telefono_puede_reservar      TO authenticated;
GRANT EXECUTE ON FUNCTION barbero_disponible           TO authenticated;
GRANT EXECUTE ON FUNCTION registrar_walkin             TO authenticated;
GRANT EXECUTE ON FUNCTION cambiar_estado_cita          TO authenticated;
GRANT EXECUTE ON FUNCTION buscar_cliente_por_telefono  TO authenticated;


-- ============================================================
-- 3. POLÍTICAS RLS — reconstruir limpias
-- ============================================================

-- CITA
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


-- DETALLE_CITA
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


-- CLIENTE
CREATE POLICY "cliente_anon_insert"
  ON cliente FOR INSERT
  TO anon
  WITH CHECK (tipo = 'anonimo');

CREATE POLICY "cliente_anon_select"
  ON cliente FOR SELECT
  TO anon
  USING (TRUE);

CREATE POLICY "cliente_auth_all"
  ON cliente FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- BLOQUEO_TELEFONO (solo autenticados — triggers son SECURITY DEFINER)
CREATE POLICY "bloqueo_auth_all"
  ON bloqueo_telefono FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);


-- ============================================================
-- 4. VERIFICACIÓN — debe mostrar políticas y grants
-- ============================================================

SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('cita', 'detalle_cita', 'cliente', 'bloqueo_telefono')
ORDER BY tablename, policyname;

SELECT grantee, table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN ('cita','cliente','detalle_cita','bloqueo_telefono')
GROUP BY grantee, table_name
ORDER BY table_name, grantee;


-- ============================================================
-- LIMPIEZA DE DATOS DE PRUEBA (opcional)
-- Ejecutar solo en desarrollo para limpiar bloqueos vencidos
-- o de teléfonos usados en pruebas anteriores.
--
-- Si ves "Este número ya tiene una cita en esa fecha" en pruebas,
-- corre esto para limpiar el bloqueo de ese número:
-- ============================================================

-- Borrar bloqueos de fechas futuras de un teléfono específico:
-- DELETE FROM bloqueo_telefono WHERE telefono = '1122334455';

-- Borrar TODOS los bloqueos de prueba (solo en desarrollo):
-- DELETE FROM bloqueo_telefono WHERE fecha_bloqueo >= CURRENT_DATE;

-- Ver bloqueos activos:
-- SELECT * FROM bloqueo_telefono ORDER BY fecha_bloqueo DESC LIMIT 20;


-- ############################################################
-- ## MODULO 17 — validar_telefono.sql
-- ############################################################

-- ============================================================
-- FUNCIÓN: validar_telefono
-- Valida formato de teléfono y rechaza números test/ficticios
-- Retorna: { valido: boolean, error: string }
-- ============================================================

CREATE OR REPLACE FUNCTION validar_telefono(p_telefono VARCHAR)
RETURNS TABLE (
  valido BOOLEAN,
  error TEXT
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

  -- Validación 1: Largo válido (10 dígitos)
  IF v_length < 10 OR v_length > 10  THEN
    RETURN QUERY SELECT FALSE, 'El teléfono debe tener 10 dígitos'::TEXT;
    RETURN;
  END IF;

  -- Validación 2: NO puede ser número test/fake (todos los dígitos iguales)
  -- Ejemplos: 1111111111, 0000000000, 2222222222, etc.
  IF v_limpio ~ '^([0-9])\1{9,}$' THEN
    RETURN QUERY SELECT FALSE, 'Este número de teléfono no es válido'::TEXT;
    RETURN;
  END IF;

  -- Validación 3: NO puede ser secuencia secuencial (1234567890, 9876543210)
  IF v_limpio ~ '^(0123456789|1234567890|9876543210|0987654321)' THEN
    RETURN QUERY SELECT FALSE, 'Este número de teléfono no es válido'::TEXT;
    RETURN;
  END IF;

  -- Validación 4: NO puede ser patrón conocido de números test
  -- (números ficticios comunes)
  IF v_limpio IN (
    '5555555555',  -- Número test común
    '4111111111',  -- Test card Visa
    '5105105105',  -- Test card Mastercard
    '9999999999',  -- Número test
    '3333333333'   -- Número test
  ) THEN
    RETURN QUERY SELECT FALSE, 'Este número de teléfono no es válido'::TEXT;
    RETURN;
  END IF;

  -- Si pasó todas las validaciones
  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

-- Otorgar permiso a anon para usar la función
GRANT EXECUTE ON FUNCTION validar_telefono(VARCHAR) TO anon, authenticated;

COMMENT ON FUNCTION validar_telefono IS
  'Valida que un número de teléfono tenga formato válido y no sea un número test/ficticio.
   Retorna: {valido: true/false, error: descripción del error si no es válido}';


-- ############################################################
-- ## MODULO 18 — confirmacion_email_cita.sql
-- ############################################################

-- ============================================================
-- SISTEMA DE CONFIRMACIÓN POR EMAIL
-- Tabla token_confirmacion_cita + columna confirmado en cita
-- ============================================================

-- 1. Nueva columna en cita: confirmado
ALTER TABLE cita ADD COLUMN IF NOT EXISTS confirmado BOOLEAN DEFAULT FALSE;

-- 2. Nueva tabla: token_confirmacion_cita
CREATE TABLE IF NOT EXISTS token_confirmacion_cita (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_cita UUID NOT NULL REFERENCES cita(id_cita) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
  fecha_expiracion TIMESTAMPTZ NOT NULL,
  usado BOOLEAN DEFAULT FALSE,
  fecha_confirmacion TIMESTAMPTZ,

  CONSTRAINT token_no_vacio CHECK (LENGTH(TRIM(token)) > 0),
  CONSTRAINT fechas_validas CHECK (fecha_expiracion > fecha_creacion)
);

CREATE INDEX IF NOT EXISTS idx_token_confirmacion_token ON token_confirmacion_cita(token);
CREATE INDEX IF NOT EXISTS idx_token_confirmacion_id_cita ON token_confirmacion_cita(id_cita);
CREATE INDEX IF NOT EXISTS idx_token_confirmacion_expiracion ON token_confirmacion_cita(fecha_expiracion);

-- Enable RLS
ALTER TABLE token_confirmacion_cita ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "token_anon_insert" ON token_confirmacion_cita;
DROP POLICY IF EXISTS "token_anon_select" ON token_confirmacion_cita;
DROP POLICY IF EXISTS "token_auth_all" ON token_confirmacion_cita;

CREATE POLICY "token_anon_insert"
  ON token_confirmacion_cita FOR INSERT
  TO anon
  WITH CHECK (TRUE);

-- NOTA DE SEGURIDAD: anon NO tiene SELECT sobre esta tabla a propósito.
-- Si anon pudiera leer la tabla, cualquiera con la publishable key podría
-- listar todos los tokens y confirmar citas ajenas. La confirmación se hace
-- exclusivamente vía la RPC confirmar_cita_por_token (SECURITY DEFINER),
-- que valida el token sin exponer la tabla.

CREATE POLICY "token_auth_all"
  ON token_confirmacion_cita FOR ALL
  TO authenticated
  USING (TRUE)
  WITH CHECK (TRUE);

-- Grants (sin SELECT para anon — ver nota de seguridad arriba)
GRANT INSERT ON token_confirmacion_cita TO anon;
GRANT SELECT, INSERT ON token_confirmacion_cita TO authenticated;

-- ============================================================
-- 3. FUNCIÓN: generar_token_confirmacion
-- Crea un token único y retorna la información para el email
-- ============================================================

CREATE OR REPLACE FUNCTION generar_token_confirmacion(p_id_cita UUID)
RETURNS TABLE (
  token VARCHAR,
  url_confirmacion TEXT,
  fecha_expiracion TIMESTAMPTZ,
  nombre_cliente VARCHAR,
  fecha_cita TIMESTAMPTZ,
  hora_cita TIME,
  barbero_nombre VARCHAR,
  servicio_nombre VARCHAR
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

GRANT EXECUTE ON FUNCTION generar_token_confirmacion(UUID) TO anon, authenticated;

-- ============================================================
-- 4. FUNCIÓN: confirmar_cita_por_token
-- Confirma la cita si el token es válido y no expiró
-- ============================================================

CREATE OR REPLACE FUNCTION confirmar_cita_por_token(p_token VARCHAR)
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
  -- Buscar token
  SELECT id_cita, usado, fecha_expiracion < NOW()
  INTO v_id_cita, v_ya_usado, v_expirado
  FROM token_confirmacion_cita
  WHERE token = p_token
  LIMIT 1;

  -- Token no encontrado
  IF v_id_cita IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Enlace inválido o expirado'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Token ya usado
  IF v_ya_usado THEN
    RETURN QUERY SELECT FALSE, 'Este enlace ya fue utilizado'::TEXT, v_id_cita;
    RETURN;
  END IF;

  -- Token expirado
  IF v_expirado THEN
    RETURN QUERY SELECT FALSE, 'El enlace expiró. Por favor, reserva nuevamente'::TEXT, v_id_cita;
    RETURN;
  END IF;

  -- Validación exitosa - confirmar cita
  UPDATE cita SET confirmado = TRUE WHERE id_cita = v_id_cita;
  UPDATE token_confirmacion_cita
  SET usado = TRUE, fecha_confirmacion = NOW()
  WHERE token = p_token;

  RETURN QUERY SELECT TRUE, 'Cita confirmada exitosamente'::TEXT, v_id_cita;
END;
$$;

GRANT EXECUTE ON FUNCTION confirmar_cita_por_token(VARCHAR) TO anon, authenticated;

-- ============================================================
-- 5. FUNCIÓN: cancelar_tokens_expirados
-- Cancela citas pendientes después de 10 minutos
-- Ejecutar con pg_cron (cada 1 minuto)
-- ============================================================

CREATE OR REPLACE FUNCTION cancelar_tokens_expirados()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Cancelar citas cuyo token expiró y aún no fueron confirmadas
  UPDATE cita
  SET estado = 'cancelada',
      motivo_cancelacion = 'Reserva no confirmada en tiempo límite'
  WHERE confirmado = FALSE
    AND estado = 'pendiente_confirmacion'
    AND id_cita IN (
      SELECT id_cita
      FROM token_confirmacion_cita
      WHERE fecha_expiracion < NOW()
        AND usado = FALSE
    );

  -- Limpiar tokens expirados (dejar en BD 1 día para auditoría)
  DELETE FROM token_confirmacion_cita
  WHERE fecha_expiracion < NOW() - INTERVAL '1 day';
END;
$$;

-- Programar para ejecutar cada 1 minuto (requiere pg_cron habilitado en Supabase)
-- SELECT cron.schedule('cancelar_tokens_expirados', '* * * * *', 'SELECT cancelar_tokens_expirados()');

-- ============================================================
-- 6. VERIFICACIÓN
-- ============================================================

SELECT 'Tabla token_confirmacion_cita creada' AS resultado;
SELECT 'Columna confirmado agregada a cita' AS resultado;
SELECT 'Función generar_token_confirmacion creada' AS resultado;
SELECT 'Función confirmar_cita_por_token creada' AS resultado;
SELECT 'Función cancelar_tokens_expirados creada' AS resultado;


-- ############################################################
-- ## MODULO 19 — RPC buscar_cliente_por_email (wizard multi-servicio)
-- ############################################################
-- El wizard de agendado anonimo necesita verificar si un email ya
-- pertenece a un cliente registrado (con Auth) antes de crear un
-- duplicado. Anon no tiene SELECT sobre cliente (RLS), asi que va
-- como SECURITY DEFINER y solo devuelve los campos minimos.

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
