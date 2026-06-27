# Barber Cerdas — Sistema de gestión de citas

Sistema web de reservas para **Academia De Barberia The Hipster** (Lindavista, CDMX). Permite a los clientes agendar citas online, a los barberos gestionar su día desde un dashboard y al admin orquestar walk-ins y reservas telefónicas. Pivoteó de práctica académica a MVP real con datos del cliente.

**Producción:** https://www.koddesolutions.com/
**DEMO ADMIN CHOCOLATE:** https://StrlgE26.github.io/Barber-Static/

---

## 1. Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | HTML5 + CSS3 + JavaScript Vanilla | Sin frameworks ni bundlers, cero dependencias en cliente |
| Backend | Supabase (PostgreSQL + Auth + REST API) | RLS, RPCs, triggers, vistas |
| Realtime | Supabase Realtime (WebSocket) | Polling fallback en el dashboard |
| Serverless | Vercel Functions (Node.js) | Endpoint del envío de emails |
| Email | Resend | Confirmación de citas |
| Deploy | Vercel | CI continuo desde GitHub |

**Una sola dependencia npm:** `resend` (lado servidor).

---

## 2. Descripción del proyecto

El sistema unifica tres canales de reserva (online, telefónica, walk-in) en una sola entidad `cita`. Las decisiones de diseño apuntan a tres objetivos:

- **Anti-spam controlado:** 1 reserva por teléfono por día por sucursal, sin lockout.
- **Identidad portable del cliente:** un anónimo que decide registrarse conserva su historial (el mismo `id_cliente` recibe `auth_user_id`).
- **Multi-sucursal listo:** todo el modelo soporta N sucursales aunque el cliente solo tenga una hoy.

Flujo del cliente (resumen):
1. Entra a la landing → selecciona sucursal → marca servicios → elige barbero/horario → ingresa datos.
2. Se crea la cita en estado **`pendiente_confirmacion`** y se le envía un email con un link único.
3. Click en el link → la cita pasa a **`pendiente`** (activa). Si no confirma en 10 min se autocancela.
4. Si tiene cuenta, ve sus próximas citas e historial en **`/mi-cuenta`** y puede cancelar desde ahí.

---

## 3. Estructura del repositorio

```
Barberia/
├── README.md                  # Este documento
├── CONTEXTO.md                # Notas técnicas adicionales
├── package.json               # Única dependencia: resend
├── vercel.json                # Rewrites de rutas limpias (/dashboard, /confirmar, /mi-cuenta...)
│
├── api/
│   └── enviar-confirmacion-cita.js   # Función serverless: arma el token y manda el email vía Resend
│
├── public/
│   ├── html/
│   │   ├── index.html         # Landing pública (multi-sucursal, wizard de reserva)
│   │   ├── dashboard.html     # Panel admin (login con Auth)
│   │   ├── kiosko.html        # Tablet en mostrador para walk-ins
│   │   ├── confirmar.html     # Confirma la cita desde el link del email
│   │   └── mi-cuenta.html     # Dashboard del cliente registrado
│   ├── css/                   # Estilos (paleta dorado/negro, Playfair + Barlow)
│   └── js/
│       ├── script.js          # Lógica de la landing (wizard, auth, agenda)
│       ├── dashboard.js       # Dashboard admin + Realtime
│       ├── kiosko.js          # Auto-registro walk-in
│       └── mi-cuenta.js       # Dashboard del cliente
│
└── database/
    ├── 00_README.md           # Guía de la BD (orden de ejecución detallado)
    ├── 01_ddl.sql             # Estructura: tablas, ENUMs, índices
    ├── 02_funciones_base.sql  # Helpers de auth + utilidades internas
    ├── 03_triggers.sql        # Triggers automáticos
    ├── 04_rls.sql             # Row Level Security + GRANTs
    ├── 05_vistas.sql          # Vistas para dashboard e historial
    ├── 06_rpc_publicas.sql    # RPCs públicas (anon)
    ├── 07_rpc_admin.sql       # RPCs admin
    ├── 08_rpc_cliente.sql     # RPCs cliente autenticado
    ├── 09_email_confirmacion.sql # Tokens + flujo de confirmación
    ├── 10_limpieza_automatica.sql # Jobs pg_cron
    ├── 11_seed.sql            # Datos iniciales
    ├── vincular_empleados.sql # Paso manual: vincular empleados a Auth
    └── limpiar_datos.sql      # Utilidad dev (vaciar datos de prueba)
```

---

## 4. ¿Por qué la API key de Supabase está visible en el frontend?

Es una pregunta razonable y la respuesta corta es: **porque esa key está diseñada para ser pública.**

Supabase ofrece dos llaves por proyecto:

| Llave | Visibilidad | Qué puede hacer |
|---|---|---|
| **Publishable / anon key** (`sb_publishable_...`) | **Pública** — va en el frontend | Solo lo que las policies RLS permitan al rol `anon` |
| **Secret / service_role key** | **Privada** — solo en el servidor | Saltarse RLS, permisos totales |

En el código solo aparece la publishable. La seguridad real **no depende de ocultarla**: depende de:

1. **Row Level Security activa en todas las tablas sensibles.** Sin policy explícita, `anon` no puede leer/escribir.
2. **Policies que restringen `anon` a operaciones legítimas:** insertar `cita` solo si `origen='online'`, insertar `cliente` solo si `tipo='anonimo'`, sin `SELECT` sobre `token_confirmacion_cita`, etc.
3. **`SECURITY DEFINER` en funciones críticas** para que la lógica viva en el servidor donde puede validar (`auth.uid()`, ownership, etc.).

La llave **secreta** que sí podría hacer daño (la de Resend) vive en variables de entorno de Vercel y solo es accesible desde `api/enviar-confirmacion-cita.js`, nunca del lado del cliente.

> Esta es la arquitectura recomendada por Supabase y la usan empresas que corren producción real con ella. Es equivalente al pattern de Firebase / AWS Amplify.

---

## 5. Tablas, RLS y políticas

Todas las tablas tienen **RLS habilitada**. Cada fila se filtra según el rol del JWT actual.

| Tabla | RLS | Policies clave | Acceso |
|---|---|---|---|
| **`sucursal`** | ✅ | `sucursal_lectura_publica` (activa = TRUE) · `sucursal_escritura_admin_general` | Lectura pública de sucursales activas; solo admin general modifica |
| **`servicio`** | ✅ | `servicio_lectura_publica` · `servicio_escritura_admin_general` | Catálogo público; solo admin general edita |
| **`empleado`** | ✅ | `empleado_lectura_publica_barberos` (rol=barbero, activo) · `empleado_propio_perfil` (auth_user_id=auth.uid) · `empleado_lectura_admin_sucursal` · `empleado_lectura_admin_general` | Carrusel público muestra solo barberos activos; admins ven a sus colegas |
| **`horario_barbero`** | ✅ | `horario_lectura_publica` (activo=TRUE) · `horario_admin` | Disponibilidad pública; gestión por admin |
| **`cliente`** | ✅ | `cliente_anon_insert` (WITH CHECK tipo='anonimo') · `cliente_anon_select` · `cliente_auth_all` | Anon crea solo anónimos; authenticated tiene acceso completo a su row |
| **`cita`** | ✅ | `cita_anon_insert` (WITH CHECK origen='online') · `cita_anon_select` · `cita_auth_insert/select/update` | Anon solo puede crear citas online; el resto las gestiona admin |
| **`detalle_cita`** | ✅ | `detalle_anon_insert/select` · `detalle_auth_all` | Hereda la lógica de su cita padre |
| **`bloqueo_telefono`** | ✅ | `bloqueo_auth_all` | Solo manejada por triggers `SECURITY DEFINER` y por admin |
| **`token_confirmacion_cita`** | ✅ | `token_anon_insert` (solo INSERT) · `token_auth_all` | **Anon no tiene `SELECT`**: cualquiera con la publishable key podría confirmar citas ajenas. La confirmación pasa exclusivamente por la RPC `confirmar_cita_por_token` |

### ENUMs del dominio

- `rol_empleado`: barbero · admin_sucursal · admin_general
- `estado_barbero`: libre · en_espera · ocupado · ausente
- `origen_cita`: online · telefonica · walkin
- `estado_cita`: pendiente_confirmacion · pendiente · en_curso · completada · cancelada · no_presentada
- `tipo_cliente`: registrado · anonimo
- `dia_semana`: lunes...domingo
- `categoria_servicio`: corte · barba · combo · tratamiento · color · diseno

---

## 6. Funciones del proyecto

### Helpers de autenticación (`02_funciones_base.sql`)

| Función | Qué hace |
|---|---|
| `obtener_rol_usuario()` | Devuelve el rol del empleado logueado leyendo `empleado` por `auth.uid()`. Usado en policies RLS. |
| `obtener_sucursal_usuario()` | Devuelve la sucursal del admin logueado (para limitarlo a la suya). |
| `es_cliente_registrado()` | TRUE si el JWT actual corresponde a un cliente con `tipo='registrado'`. |

### Lógica de negocio interna (`02_funciones_base.sql`)

| Función | Qué hace |
|---|---|
| `calcular_fin_cita(p_id_cita)` | Suma duraciones de los servicios en `detalle_cita` y devuelve el fin de la cita. Llamada por trigger. |
| `siguiente_posicion_cola(p_empleado, p_fecha)` | Número siguiente en la cola de walk-ins del día para ese barbero. |
| `validar_telefono(p_telefono)` | Valida formato 10 dígitos, rechaza números test y secuencias obvias. |

### Triggers automáticos (`03_triggers.sql`)

| Trigger | Cuándo se dispara | Qué hace |
|---|---|---|
| `trg_actualizar_fin_cita` | INSERT/UPDATE/DELETE en `detalle_cita` | Recalcula `cita.fecha_hora_fin` sumando duraciones (multi-servicio) |
| `trg_bloquear_telefono` | INSERT en `cita` (origen='online') | Inserta el teléfono del cliente en `bloqueo_telefono` (anti-spam) |
| `trg_liberar_bloqueo_telefono` | UPDATE de `cita.estado` a cancelada/no_presentada | Elimina el bloqueo para permitir reagendar |
| `trg_actualizar_estado_barbero` | INSERT/UPDATE de `cita.estado` | Mueve el semáforo del barbero (libre → en_espera → ocupado → libre) |
| `trg_asignar_posicion_cola` | BEFORE INSERT en `cita` (walk-in) | Asigna posición automática en la cola del día |

### RPCs públicas — llamadas por `anon` (`06_rpc_publicas.sql`)

| RPC | Qué hace |
|---|---|
| `obtener_slots_disponibles(empleado, fecha, duracion)` | Genera los slots libres del barbero ese día respetando el buffer y traslapes |
| `telefono_puede_reservar(tel, sucursal, fecha)` | Verifica anti-spam: TRUE si el teléfono no tiene cita ese día |
| `barbero_disponible(empleado, inicio, fin)` | Doble-check de traslape justo antes del INSERT |
| `buscar_cliente_por_telefono(tel)` | Devuelve `id_cliente` si ya existe → evita duplicar al invitado recurrente |
| `buscar_cliente_por_email(email)` | Detecta si el email ya pertenece a un cliente con cuenta Auth (evita identidades duplicadas) |

### RPCs admin (`07_rpc_admin.sql`)

| RPC | Qué hace |
|---|---|
| `registrar_walkin(...)` | Crea cliente anónimo + cita walk-in + detalle en una sola transacción. Asigna automáticamente al barbero con menos carga |
| `cambiar_estado_cita(cita, nuevo_estado, motivo)` | Único punto autorizado para mover el estado de una cita. Valida transiciones, permisos y motivo de cancelación |

### RPCs cliente autenticado (`08_rpc_cliente.sql`)

| RPC | Qué hace |
|---|---|
| `vincular_o_crear_cliente_registrado(...)` | Si el usuario ya tiene perfil → lo devuelve. Si existe un cliente anónimo con su email/teléfono → **upgrade in-place** (mismo `id_cliente`, ahora con `auth_user_id`). Si no → crea uno nuevo |
| `cancelar_mi_cita(cita, motivo)` | El cliente cancela su propia cita futura. Valida ownership con `auth.uid()` |

### Sistema de confirmación por email (`09_email_confirmacion.sql`)

| RPC | Qué hace |
|---|---|
| `generar_token_confirmacion(cita)` | Crea token aleatorio (24 bytes hex) con TTL 10 min y devuelve todos los datos formateados para el email |
| `confirmar_cita_por_token(token)` | Valida el token (existe, no usado, no expirado) y mueve la cita de `pendiente_confirmacion` → `pendiente` |
| `cancelar_tokens_expirados()` | Job programado: cancela citas que el cliente nunca confirmó y limpia tokens viejos |

### Vistas (`05_vistas.sql`)

| Vista | Para qué se usa |
|---|---|
| `v_panel_barberos` | Semáforo del dashboard: una fila por barbero con su próxima cita relevante hoy. Incluye corrección del "libre falso" cuando el hueco al próximo servicio es demasiado corto |
| `v_cola_walkins` | Cola del día con tiempo estimado de espera por barbero |
| `v_citas_del_dia` | Todas las citas del día (admin) — JOIN consolidado de cita + empleado + cliente + servicios |
| `v_historial_cliente` | Citas terminadas (completada/cancelada/no_presentada) — usado en `/mi-cuenta` |

### Tareas programadas (`10_limpieza_automatica.sql`)

Dos jobs `pg_cron`:

- **`limpiar_bloqueos_vencidos`** — diario a las 3 AM. Borra entradas pasadas de `bloqueo_telefono` para que la tabla no crezca indefinidamente.
- **`cancelar_tokens_expirados`** — cada minuto. Autocancela citas no confirmadas y limpia tokens viejos.

---

## 7. Cómo correr el proyecto

```bash
# Local (requiere Vercel CLI para que las funciones serverless funcionen)
npm install
npx vercel dev

# Deploy
git push   # Vercel redespliega automáticamente
```

**Setup inicial de la BD** (ver `database/00_README.md` para detalle):
1. Crear proyecto en Supabase, habilitar `pg_cron`.
2. SQL Editor → ejecutar `01_ddl.sql` ... `11_seed.sql` en orden.
3. Authentication → crear cuentas para los empleados.
4. Ejecutar `vincular_empleados.sql` con los UUIDs reales.
5. Configurar variables de entorno en Vercel: `RESEND_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
