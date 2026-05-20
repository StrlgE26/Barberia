-- ============================================================
-- 10_limpieza_automatica.sql — TAREAS PROGRAMADAS (pg_cron)
-- ============================================================
-- 2 jobs recurrentes que mantienen la BD sana sin intervención
-- manual. Requieren la extensión pg_cron habilitada (ver 01_ddl.sql).
--
--   · limpiar_bloqueos_vencidos    — diario 3:00 AM
--       Borra entradas de `bloqueo_telefono` con fecha pasada.
--       Sin esto, la tabla crecería indefinidamente y los anti-spam
--       leyendo el COUNT serían más lentos.
--
--   · cancelar_tokens_expirados    — cada minuto
--       Recorre tokens expirados que el cliente NUNCA confirmó y
--       cancela las citas correspondientes. Sin esto, las reservas
--       no confirmadas se quedarían bloqueando slots para siempre.
--
-- Si necesitas listar/desprogramar jobs:
--   SELECT * FROM cron.job;
--   SELECT cron.unschedule('nombre_del_job');
-- ============================================================


-- ============================================================
-- Limpieza diaria de bloqueos de teléfono vencidos
-- ============================================================
-- El bloqueo es de "1 cita por día por sucursal por teléfono" — al
-- día siguiente ya no aplica para esa fecha. Borramos los pasados.
SELECT cron.schedule(
  'limpiar_bloqueos_vencidos',   -- nombre del job
  '0 3 * * *',                    -- diario a las 3:00 AM
  $$
    DELETE FROM bloqueo_telefono
    WHERE fecha_bloqueo < CURRENT_DATE;
  $$
);


-- ============================================================
-- Autocancelar reservas no confirmadas + limpiar tokens viejos
-- ============================================================
-- Corre cada minuto: si una cita 'pendiente_confirmacion' lleva
-- más de 10 min sin que el cliente abra el email, se cancela y
-- el slot vuelve a estar disponible.
SELECT cron.schedule(
  'cancelar_tokens_expirados',
  '* * * * *',                    -- cada minuto
  $$ SELECT cancelar_tokens_expirados(); $$
);
