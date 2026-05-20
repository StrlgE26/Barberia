-- ============================================================
-- 08_rpc_cliente.sql — RPCs PARA CLIENTE AUTENTICADO
-- ============================================================
-- Funciones que llama un cliente logueado (Auth) desde /mi-cuenta
-- o desde el flujo de registro. Necesitan el JWT del cliente para
-- validar ownership con auth.uid().
--
--   · vincular_o_crear_cliente_registrado
--       Cuando un nuevo Auth user entra al sistema (vía signup o
--       login), garantiza que exista UNA fila en `cliente` para él.
--       Si había un cliente anónimo con su mismo email o teléfono,
--       hace UPGRADE in-place preservando las citas históricas.
--
--   · cancelar_mi_cita
--       El cliente puede cancelar sus propias citas futuras desde
--       /mi-cuenta. Valida ownership comparando auth.uid() con
--       cliente.auth_user_id de la cita.
--
-- Ambas SECURITY DEFINER: tocan filas anónimas (sin auth_user_id)
-- que las policies normales de RLS no permitirían modificar al
-- cliente directamente. Defensivamente verifican `auth.uid()`
-- adentro de la función.
-- ============================================================


-- ============================================================
-- vincular_o_crear_cliente_registrado
-- ============================================================
-- Filosofía de identidad:
--   · El teléfono (o email) es la "identidad canónica" del cliente.
--   · Una persona = una fila en `cliente`, sin importar si empieza
--     siendo anónima y después se registra.
--   · `id_cliente` permanece constante a través del upgrade, así
--     que las citas pasadas siguen pertenenciendo al mismo cliente.
--
-- Flujo:
--   1) Si el JWT actual ya tiene cliente vinculado → devolverlo.
--   2) Buscar por email:
--      · Existe y es anónimo → UPDATE in-place (set auth_user_id,
--        tipo='registrado'). Devuelve id_cliente preservado.
--      · Existe y es de otra cuenta → conflict (error claro).
--   3) Buscar por teléfono → mismo flujo de upgrade.
--   4) Nada existe → INSERT nuevo con tipo='registrado'.
-- ============================================================
DROP FUNCTION IF EXISTS vincular_o_crear_cliente_registrado(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR);

CREATE FUNCTION vincular_o_crear_cliente_registrado(
  p_user_id  UUID,
  p_email    VARCHAR,
  p_nombre   VARCHAR,
  p_apellido VARCHAR,
  p_telefono VARCHAR
)
RETURNS TABLE (
  id_cliente UUID,
  accion     TEXT,
  ok         BOOLEAN,
  mensaje    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
  v_existing_auth UUID;
BEGIN
  -- Defensa: solo el dueño del JWT puede operar sobre sí mismo
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RETURN QUERY SELECT NULL::UUID, 'denied'::TEXT, FALSE, 'No autorizado'::TEXT;
    RETURN;
  END IF;

  -- 1) Ya hay un cliente vinculado a este auth.uid()
  SELECT cl.id_cliente INTO v_id
  FROM cliente cl
  WHERE cl.auth_user_id = p_user_id
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'existing'::TEXT, TRUE, 'Cliente ya estaba vinculado'::TEXT;
    RETURN;
  END IF;

  -- 2) Buscar por email (case-insensitive)
  SELECT cl.id_cliente, cl.auth_user_id INTO v_id, v_existing_auth
  FROM cliente cl
  WHERE LOWER(cl.email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    IF v_existing_auth IS NULL THEN
      -- Anónimo → upgrade preservando id_cliente
      UPDATE cliente cl
      SET auth_user_id   = p_user_id,
          tipo           = 'registrado',
          nombre         = COALESCE(NULLIF(TRIM(p_nombre),''),  cl.nombre),
          apellido       = COALESCE(NULLIF(TRIM(p_apellido),''),cl.apellido),
          telefono       = COALESCE(NULLIF(TRIM(p_telefono),''),cl.telefono),
          fecha_registro = NOW()
      WHERE cl.id_cliente = v_id;
      RETURN QUERY SELECT v_id, 'upgraded_by_email'::TEXT, TRUE, 'Cliente vinculado por email'::TEXT;
      RETURN;
    ELSE
      -- Email asociado a otra cuenta registrada → no robar identidad
      RETURN QUERY SELECT NULL::UUID, 'conflict_email'::TEXT, FALSE,
                          'Este email ya pertenece a otra cuenta'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- 3) Buscar por teléfono
  IF NULLIF(TRIM(p_telefono),'') IS NOT NULL THEN
    SELECT cl.id_cliente, cl.auth_user_id INTO v_id, v_existing_auth
    FROM cliente cl
    WHERE cl.telefono = TRIM(p_telefono)
    LIMIT 1;

    IF v_id IS NOT NULL AND v_existing_auth IS NULL THEN
      UPDATE cliente cl
      SET auth_user_id   = p_user_id,
          tipo           = 'registrado',
          email          = COALESCE(cl.email, p_email),
          nombre         = COALESCE(NULLIF(TRIM(p_nombre),''),  cl.nombre),
          apellido       = COALESCE(NULLIF(TRIM(p_apellido),''),cl.apellido),
          fecha_registro = NOW()
      WHERE cl.id_cliente = v_id;
      RETURN QUERY SELECT v_id, 'upgraded_by_phone'::TEXT, TRUE, 'Cliente vinculado por teléfono'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- 4) Nada existía → crear nuevo
  IF NULLIF(TRIM(p_nombre),'') IS NULL OR NULLIF(TRIM(p_telefono),'') IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, 'missing'::TEXT, FALSE, 'Faltan nombre o teléfono'::TEXT;
    RETURN;
  END IF;

  INSERT INTO cliente (auth_user_id, nombre, apellido, telefono, email, tipo)
  VALUES (p_user_id, TRIM(p_nombre), NULLIF(TRIM(p_apellido),''), TRIM(p_telefono), p_email, 'registrado')
  RETURNING cliente.id_cliente INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::TEXT, TRUE, 'Cliente creado'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION vincular_o_crear_cliente_registrado(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;


-- ============================================================
-- cancelar_mi_cita — el cliente cancela su propia cita
-- ============================================================
-- Las policies de `cita` solo permiten al cliente SELECT, no UPDATE
-- (UPDATE está reservado al admin vía cambiar_estado_cita). Esta
-- RPC es la excepción controlada: SECURITY DEFINER, valida que la
-- cita pertenezca al cliente del JWT y solo permite ir a 'cancelada'.
-- ============================================================
CREATE OR REPLACE FUNCTION cancelar_mi_cita(
  p_id_cita UUID,
  p_motivo  TEXT DEFAULT NULL
)
RETURNS TABLE (
  ok       BOOLEAN,
  mensaje  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id_cliente UUID;
  v_estado     estado_cita;
BEGIN
  -- Resolver dueño + estado de la cita
  SELECT c.id_cliente, c.estado INTO v_id_cliente, v_estado
  FROM cita c
  WHERE c.id_cita = p_id_cita;

  IF v_id_cliente IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Cita no encontrada'::TEXT;
    RETURN;
  END IF;

  -- Ownership: la cita debe pertenecer al cliente del JWT actual
  IF NOT EXISTS (
    SELECT 1 FROM cliente
    WHERE id_cliente   = v_id_cliente
      AND auth_user_id = auth.uid()
  ) THEN
    RETURN QUERY SELECT FALSE, 'No tienes permiso para cancelar esta cita'::TEXT;
    RETURN;
  END IF;

  -- Solo se pueden cancelar citas activas
  IF v_estado IN ('completada', 'cancelada', 'no_presentada') THEN
    RETURN QUERY SELECT FALSE, 'Esta cita ya no se puede cancelar'::TEXT;
    RETURN;
  END IF;

  UPDATE cita
  SET estado             = 'cancelada',
      motivo_cancelacion = COALESCE(NULLIF(TRIM(p_motivo), ''), 'Cancelada por el cliente')
  WHERE id_cita = p_id_cita;

  RETURN QUERY SELECT TRUE, 'Cita cancelada exitosamente'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION cancelar_mi_cita(UUID, TEXT) TO authenticated;
