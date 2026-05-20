-- ============================================================
-- 05_vistas.sql — VISTAS DE LECTURA
-- ============================================================
-- 4 vistas que consolidan JOINs comunes para que el frontend
-- no tenga que duplicar lógica de agregación:
--
--   · v_panel_barberos   — semáforo del dashboard (estado por barbero
--                          + su próxima cita). Incluye lógica de
--                          "libre falso": si el barbero está libre
--                          pero su próxima cita está tan cerca que
--                          ningún servicio cabe, se muestra en_espera.
--
--   · v_cola_walkins     — cola de walk-ins del día con tiempo
--                          estimado de espera por barbero.
--
--   · v_citas_del_dia    — todas las citas del día (admin).
--
--   · v_historial_cliente — citas terminadas. RLS de cita filtra
--                           para que cada cliente solo vea las suyas.
--
-- Permisos: ver 04_rls.sql (GRANT SELECT a anon/authenticated según
-- corresponda). Las vistas heredan RLS de las tablas base.
-- ============================================================


-- ============================================================
-- v_panel_barberos — semáforo del dashboard
-- ============================================================
-- Detecta dos casos "tramposos" del estado_actual del barbero:
--   1. Barbero 'libre' pero con cita pendiente en pocos minutos
--      cuyo gap no alcanza para un servicio del catálogo → mostrar
--      como en_espera (no es realmente libre para nuevos walk-ins).
--
-- Devuelve UNA fila por barbero (DISTINCT ON), eligiendo su cita
-- "más relevante hoy": en_curso prioritaria sobre pendiente más
-- próxima.
-- ============================================================
CREATE OR REPLACE VIEW v_panel_barberos AS
WITH

-- Duración mínima del catálogo activo (para detectar huecos inútiles)
min_servicio AS (
  SELECT MIN(duracion_min) AS minutos
  FROM servicio
  WHERE activo = TRUE
),

-- Una sola cita por barbero: en_curso primero, luego siguiente pendiente
proxima_cita AS (
  SELECT DISTINCT ON (id_empleado)
    id_cita, id_empleado, id_cliente, estado, origen,
    fecha_hora_inicio, fecha_hora_fin, posicion_cola,
    nombre_walkin, telefono_walkin, notas
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
  e.nombre        AS barbero_nombre,
  e.apellidos     AS barbero_apellidos,
  e.especialidad,
  e.foto_url,

  -- Estado efectivo (corrige "libre falso")
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
  END AS estado_actual,

  c.id_cita,
  c.origen            AS cita_origen,
  c.estado            AS cita_estado,
  c.fecha_hora_inicio,
  c.fecha_hora_fin,
  c.posicion_cola,
  c.nombre_walkin,
  c.telefono_walkin,
  c.notas,

  cl.nombre   AS cliente_nombre,
  cl.apellido AS cliente_apellido,
  cl.telefono AS cliente_telefono,
  cl.email    AS cliente_email,

  -- Servicios y precio agregados de detalle_cita
  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  ) AS servicios_nombres,
  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  ) AS precio_total,

  -- Cronómetro para citas en curso
  CASE WHEN c.estado = 'en_curso'
       THEN EXTRACT(EPOCH FROM (NOW() - c.fecha_hora_inicio)) / 60
       ELSE NULL
  END AS minutos_transcurridos,
  CASE WHEN c.estado = 'en_curso'
       THEN EXTRACT(EPOCH FROM (c.fecha_hora_fin - NOW())) / 60
       ELSE NULL
  END AS minutos_restantes

FROM empleado e
LEFT JOIN proxima_cita c  ON c.id_empleado  = e.id_empleado
LEFT JOIN cliente      cl ON cl.id_cliente  = c.id_cliente

WHERE e.rol = 'barbero' AND e.activo = TRUE

ORDER BY
  -- Mismo CASE que el estado efectivo, mapeado a prioridad de display
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

COMMENT ON VIEW v_panel_barberos IS
  'Semáforo del dashboard. Una fila por barbero activo + su cita
   más relevante hoy. Incluye corrección del "libre falso".';


-- ============================================================
-- v_cola_walkins — cola del día por barbero con espera estimada
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

  e.nombre       AS barbero_nombre,
  e.apellidos    AS barbero_apellidos,
  e.estado_actual AS barbero_estado,

  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  ) AS servicios_nombres,

  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  ) AS precio_total,

  -- Tiempo estimado de espera = suma de duraciones de citas con
  -- menor posicion_cola que aún están activas hoy
  (
    SELECT COALESCE(SUM(
      EXTRACT(EPOCH FROM (c2.fecha_hora_fin - GREATEST(c2.fecha_hora_inicio, NOW()))) / 60
    ), 0)
    FROM cita c2
    WHERE c2.id_empleado = c.id_empleado
      AND c2.estado IN ('pendiente', 'en_curso')
      AND c2.posicion_cola < c.posicion_cola
      AND DATE(c2.fecha_hora_inicio) = CURRENT_DATE
  ) AS espera_estimada_min

FROM cita c
JOIN empleado e ON e.id_empleado = c.id_empleado
WHERE c.origen = 'walkin'
  AND DATE(c.fecha_hora_inicio) = CURRENT_DATE
  AND c.estado IN ('pendiente', 'en_curso')
ORDER BY c.id_empleado, c.posicion_cola;

COMMENT ON VIEW v_cola_walkins IS
  'Cola de walk-ins del día actual con espera estimada por barbero.';


-- ============================================================
-- v_citas_del_dia — todas las citas del día (admin)
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

  e.nombre    AS barbero_nombre,
  e.apellidos AS barbero_apellidos,

  -- Cliente: registrado o walk-in (COALESCE)
  COALESCE(cl.nombre,   c.nombre_walkin)   AS cliente_nombre,
  COALESCE(cl.apellido, '')                AS cliente_apellido,
  COALESCE(cl.telefono, c.telefono_walkin) AS cliente_telefono,
  cl.email                                 AS cliente_email,
  cl.tipo                                  AS cliente_tipo,

  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  ) AS servicios_nombres,

  (
    SELECT COALESCE(SUM(s.duracion_min), 0)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  ) AS duracion_total_min,

  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  ) AS precio_total

FROM cita c
JOIN empleado e   ON e.id_empleado = c.id_empleado
LEFT JOIN cliente cl ON cl.id_cliente = c.id_cliente
WHERE DATE(c.fecha_hora_inicio) = CURRENT_DATE
ORDER BY c.fecha_hora_inicio, e.nombre;

COMMENT ON VIEW v_citas_del_dia IS
  'Todas las citas del día actual. Filtrar por id_sucursal desde el frontend.';


-- ============================================================
-- v_historial_cliente — citas terminadas del cliente
-- ============================================================
-- RLS de la tabla cita filtra automáticamente para que un cliente
-- solo vea las suyas. Admin puede ver todas.
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

  su.nombre    AS sucursal_nombre,
  su.direccion AS sucursal_direccion,

  e.nombre     AS barbero_nombre,
  e.apellidos  AS barbero_apellidos,

  (
    SELECT STRING_AGG(s.nombre, ', ' ORDER BY dc.orden)
    FROM detalle_cita dc
    JOIN servicio s ON s.id_servicio = dc.id_servicio
    WHERE dc.id_cita = c.id_cita
  ) AS servicios_nombres,

  -- Precio histórico (lo que se cobró, no el precio actual del servicio)
  (
    SELECT COALESCE(SUM(dc.precio_aplicado), 0)
    FROM detalle_cita dc
    WHERE dc.id_cita = c.id_cita
  ) AS total_pagado

FROM cita c
JOIN sucursal su ON su.id_sucursal = c.id_sucursal
JOIN empleado e  ON e.id_empleado  = c.id_empleado
WHERE c.estado IN ('completada', 'cancelada', 'no_presentada')
ORDER BY c.fecha_hora_inicio DESC;

COMMENT ON VIEW v_historial_cliente IS
  'Historial de citas terminadas. Usado en /mi-cuenta. RLS de cita
   garantiza que cada cliente solo vea las suyas.';


-- Permisos sobre las vistas
GRANT SELECT ON v_panel_barberos    TO anon, authenticated;
GRANT SELECT ON v_cola_walkins      TO authenticated;
GRANT SELECT ON v_citas_del_dia     TO authenticated;
GRANT SELECT ON v_historial_cliente TO authenticated;
