-- ============================================================
-- 01_ddl.sql — DDL DE LA BASE DE DATOS
-- ============================================================
-- Crea la estructura del sistema: extensions, tipos ENUM, tablas
-- e índices. No incluye lógica (funciones, triggers, RLS): eso
-- vive en archivos separados (02..11) por mantenibilidad.
--
-- Decisiones de diseño importantes:
--   · `cita.fecha_hora_fin` se ALMACENA (no se calcula en consulta)
--     para que los índices de traslape sean eficientes. Un trigger
--     la recalcula al cambiar `detalle_cita`. (Ver 03_triggers.sql)
--   · `detalle_cita` tiene PK compuesta (id_cita, id_servicio) →
--     permite múltiples servicios por cita.
--   · `cliente.auth_user_id` es NULLABLE → un cliente anónimo (sin
--     cuenta Auth) puede tener citas. Al registrarse, ese mismo row
--     se actualiza (no se duplica). Ver 08_rpc_cliente.sql.
--   · ENUM `estado_cita` incluye 'pendiente_confirmacion': cita
--     online recién creada que espera click en el email. Si el
--     cliente no confirma en 10 min, se cancela (ver 10_limpieza).
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================
-- uuid_generate_v4() para PKs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pg_cron para tareas programadas (autocancelación, limpieza diaria)
-- ⚠ También se habilita desde el Dashboard de Supabase: Database → Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ============================================================
-- TIPOS ENUM — definidos antes de las tablas que los usan
-- ============================================================

-- Roles del sistema (herencia tabla-única con discriminador `rol`)
CREATE TYPE rol_empleado AS ENUM (
  'barbero',
  'admin_sucursal',
  'admin_general'
);

-- Estado operativo del barbero en tiempo real (semáforo del dashboard)
CREATE TYPE estado_barbero AS ENUM (
  'libre',       -- verde:    disponible para siguiente cliente
  'en_espera',   -- amarillo: tiene cliente asignado, aún no inicia
  'ocupado',     -- rojo:     servicio en curso
  'ausente'      -- gris:     no disponible (descanso, día libre)
);

-- Origen de la cita (la UI varía según este campo)
CREATE TYPE origen_cita AS ENUM (
  'online',      -- reserva desde la landing
  'telefonica',  -- registrada por admin de sucursal
  'walkin'       -- cliente que llega sin cita
);

-- Estado del ciclo de vida de la cita
CREATE TYPE estado_cita AS ENUM (
  'pendiente_confirmacion', -- online recién creada, esperando confirmar por email
  'pendiente',              -- confirmada/agendada, esperando inicio
  'en_curso',               -- servicio iniciado (admin presionó "Iniciar")
  'completada',             -- servicio finalizado
  'cancelada',              -- cancelada por admin/sistema/cliente
  'no_presentada'           -- cliente no llegó
);

-- Tipo de cliente
CREATE TYPE tipo_cliente AS ENUM (
  'registrado',  -- tiene cuenta Auth, puede ver historial / cancelar
  'anonimo'      -- solo nombre+telefono, walk-in/telefonica/invitado online
);

-- Días de la semana para horarios
CREATE TYPE dia_semana AS ENUM (
  'lunes', 'martes', 'miercoles', 'jueves',
  'viernes', 'sabado', 'domingo'
);

-- Categoría de servicios (decorativa, agrupación visual)
CREATE TYPE categoria_servicio AS ENUM (
  'corte', 'barba', 'combo', 'tratamiento', 'color', 'diseno'
);


-- ============================================================
-- TABLAS BASE
-- ============================================================

-- ------------------------------------------------------------
-- sucursal — entidad raíz del sistema multi-sucursal
-- ------------------------------------------------------------
CREATE TABLE sucursal (
  id_sucursal       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre            VARCHAR(100) NOT NULL,
  direccion         VARCHAR(255) NOT NULL,
  telefono          VARCHAR(20),
  horario_apertura  TIME NOT NULL DEFAULT '09:00',
  horario_cierre    TIME NOT NULL DEFAULT '21:00',
  -- Minutos mínimos de anticipación para reservas online (anti-impulsivas)
  buffer_reserva_min INT NOT NULL DEFAULT 30,
  activa            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN sucursal.buffer_reserva_min IS
  'Minutos mínimos de anticipación requeridos para reservas online. Configurable por sucursal.';


-- ------------------------------------------------------------
-- servicio — catálogo independiente de sucursal (reuso)
-- ------------------------------------------------------------
CREATE TABLE servicio (
  id_servicio   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre        VARCHAR(100) NOT NULL,
  descripcion   TEXT,
  duracion_min  INT NOT NULL CHECK (duracion_min > 0),
  precio        DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  categoria     categoria_servicio NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ------------------------------------------------------------
-- cliente — registrado (con Auth) o anónimo (solo nombre+teléfono)
-- ------------------------------------------------------------
CREATE TABLE cliente (
  id_cliente      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- FK a auth.users. NULL para invitados → al registrarse se setea (upgrade in-place)
  auth_user_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  nombre          VARCHAR(100) NOT NULL,
  apellido        VARCHAR(100),
  telefono        VARCHAR(20) NOT NULL,
  email           VARCHAR(255),
  tipo            tipo_cliente NOT NULL DEFAULT 'anonimo',
  fecha_registro  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Si es registrado debe tener email y auth_user_id
  CONSTRAINT cliente_registrado_tiene_email
    CHECK (tipo = 'anonimo' OR email IS NOT NULL),
  CONSTRAINT cliente_registrado_tiene_auth
    CHECK (tipo = 'anonimo' OR auth_user_id IS NOT NULL)
);

COMMENT ON COLUMN cliente.telefono IS
  'Identidad canónica del invitado. Usado para deduplicación y anti-spam (bloqueo_telefono).';


-- ------------------------------------------------------------
-- empleado — tabla única con discriminador `rol` (EER tabla única)
-- ------------------------------------------------------------
CREATE TABLE empleado (
  id_empleado     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- FK a auth.users (NULLABLE: durante setup los barberos se insertan
  -- sin Auth y se vinculan después con vincular_empleados.sql)
  auth_user_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
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
  'Estado en tiempo real del barbero. Actualizado por triggers (no manualmente).';


-- ------------------------------------------------------------
-- horario_barbero — turnos semanales recurrentes (entidad débil)
-- ------------------------------------------------------------
CREATE TABLE horario_barbero (
  id_horario  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_empleado UUID NOT NULL REFERENCES empleado(id_empleado) ON DELETE CASCADE,
  dia_semana  dia_semana NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin    TIME NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT horario_unico_por_dia UNIQUE (id_empleado, dia_semana),
  CONSTRAINT horario_valido         CHECK (hora_inicio < hora_fin)
);


-- ------------------------------------------------------------
-- cita — entidad central; unifica online/telefónica/walk-in
-- ------------------------------------------------------------
CREATE TABLE cita (
  id_cita           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  id_sucursal       UUID NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE RESTRICT,
  id_empleado       UUID NOT NULL REFERENCES empleado(id_empleado) ON DELETE RESTRICT,
  -- NULL solo para walk-ins sin cuenta (nombre_walkin cubre el caso)
  id_cliente        UUID REFERENCES cliente(id_cliente) ON DELETE SET NULL,

  fecha_hora_inicio TIMESTAMPTZ NOT NULL,
  -- Calculado por trigger al cambiar detalle_cita (suma duraciones)
  fecha_hora_fin    TIMESTAMPTZ NOT NULL,

  origen            origen_cita NOT NULL,
  estado            estado_cita NOT NULL DEFAULT 'pendiente',
  confirmado        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Solo para walk-ins sin cuenta registrada
  nombre_walkin     VARCHAR(100),
  telefono_walkin   VARCHAR(20),
  -- Posición en cola (solo walk-ins). Asignada por trigger.
  posicion_cola     INT,

  notas             TEXT,
  motivo_cancelacion TEXT,
  fecha_creacion    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cita_walkin_tiene_nombre
    CHECK (origen != 'walkin' OR nombre_walkin IS NOT NULL OR id_cliente IS NOT NULL),
  CONSTRAINT cita_tiempo_valido
    CHECK (fecha_hora_fin > fecha_hora_inicio),
  CONSTRAINT cita_no_en_pasado
    CHECK (origen = 'walkin' OR fecha_hora_inicio > fecha_creacion)
);


-- ------------------------------------------------------------
-- detalle_cita — N:M cita↔servicio. PK compuesta permite multi-servicio.
-- ------------------------------------------------------------
CREATE TABLE detalle_cita (
  id_cita         UUID NOT NULL REFERENCES cita(id_cita) ON DELETE CASCADE,
  id_servicio     UUID NOT NULL REFERENCES servicio(id_servicio) ON DELETE RESTRICT,
  -- Precio histórico (preserva el cobro real aunque servicio.precio cambie)
  precio_aplicado DECIMAL(10,2) NOT NULL CHECK (precio_aplicado >= 0),
  orden           INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id_cita, id_servicio),
  CONSTRAINT orden_positivo CHECK (orden > 0)
);


-- ------------------------------------------------------------
-- bloqueo_telefono — anti-spam: 1 reserva activa por tel/día/sucursal
-- ------------------------------------------------------------
CREATE TABLE bloqueo_telefono (
  id_bloqueo    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telefono      VARCHAR(20) NOT NULL,
  id_sucursal   UUID NOT NULL REFERENCES sucursal(id_sucursal) ON DELETE CASCADE,
  fecha_bloqueo DATE NOT NULL DEFAULT CURRENT_DATE,
  id_cita       UUID REFERENCES cita(id_cita) ON DELETE CASCADE,
  CONSTRAINT bloqueo_unico_por_dia UNIQUE (telefono, id_sucursal, fecha_bloqueo)
);


-- ============================================================
-- ÍNDICES — optimizados para las queries más frecuentes
-- ============================================================

-- Búsqueda de citas por barbero y rango (detección de traslapes)
CREATE INDEX idx_cita_empleado_tiempo
  ON cita(id_empleado, fecha_hora_inicio, fecha_hora_fin);

-- Dashboard del admin: citas por sucursal/fecha
CREATE INDEX idx_cita_sucursal_fecha
  ON cita(id_sucursal, fecha_hora_inicio);

-- Historial del cliente (parcial: solo filas con id_cliente)
CREATE INDEX idx_cita_cliente
  ON cita(id_cliente)
  WHERE id_cliente IS NOT NULL;

-- Cola pendiente / en curso
CREATE INDEX idx_cita_estado
  ON cita(estado, fecha_hora_inicio);

-- Horarios por barbero
CREATE INDEX idx_horario_empleado
  ON horario_barbero(id_empleado, dia_semana);

-- Carga del dashboard: barberos activos por sucursal
CREATE INDEX idx_empleado_sucursal
  ON empleado(id_sucursal, activo, rol);

-- Anti-spam
CREATE INDEX idx_bloqueo_telefono_fecha
  ON bloqueo_telefono(telefono, fecha_bloqueo);
