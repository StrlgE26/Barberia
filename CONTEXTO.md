# BARBER CERDAS — Contexto del Proyecto
> Documento de referencia para Claude Code. Leer antes de tocar cualquier archivo.

---

## ¿Qué es este proyecto?

Sistema de gestión de citas para **Academia De Barberia The Hipster CDMX**.
Inició como práctica académica y pivotó a MVP real con datos del cliente.
El cliente es dueño de una barbería en Lindavista, CDMX, que sufre estrés
operativo por gestionar citas manualmente vía teléfono.

---

## Stack tecnológico

| Capa       | Tecnología                          |
|------------|-------------------------------------|
| Frontend   | HTML5 + CSS3 + JavaScript Vanilla   |
| Backend    | Supabase (PostgreSQL + Auth + REST) |
| Realtime   | Supabase Realtime (WebSocket)       |
| Email      | Resend (vía función serverless en `api/`) |
| Deploy     | Vercel — https://barber-kodde.vercel.app |
| Frontend sin frameworks ni bundlers. Única dependencia: `resend` (backend) |

---

## Estructura del proyecto

```
BARBERIA/
├── database/
│   ├── schema.sql              # Setup completo consolidado (tablas, ENUMs,
│   │                           #   índices, funciones, triggers, RLS, vistas,
│   │                           #   slots, validaciones, sistema de email).
│   │                           #   Ejecutar de principio a fin en Supabase limpio.
│   ├── fix_criticos.sql        # Parche para BD de PRODUCCIÓN ya existente
│   │                           #   (ENUM pendiente_confirmacion, URL email, seguridad token)
│   └── vincular_empleados.sql  # Paso MANUAL: vincular barberos a cuentas Auth
├── api/
│   └── enviar-confirmacion-cita.js  # Función serverless: genera token + envía email (Resend)
└── public/
    ├── css/
    │   ├── styles.css       # Estilos landing
    │   ├── dashboard.css    # Estilos panel admin
    │   └── kiosko.css       # Estilos kiosko tablet
    ├── html/
    │   ├── index.html       # Landing pública
    │   ├── dashboard.html   # Panel admin (requiere login)
    │   ├── kiosko.html      # Kiosko walk-in para tablet (acceso público)
    │   └── confirmar.html   # Página de confirmación de cita vía token de email
    └── js/
        ├── script.js        # Lógica landing + conexión Supabase + flujo de reserva
        ├── dashboard.js     # Lógica dashboard + Auth + Realtime
        └── kiosko.js        # Lógica kiosko auto-registro walk-in
```

> Historial: los 18 scripts SQL originales de migración están preservados
> en el historial de git; `schema.sql` es su consolidación ordenada.

---

## Credenciales Supabase

```javascript
SUPABASE_URL = 'https://cqsgilldrbbigkuxjgnj.supabase.co'
SUPABASE_KEY = 'sb_publishable_k6gNs3jVdHzQn_eBbMzqVg_ANwgYtuN'  // publishable key
ID_SUCURSAL  = '5d024273-df32-4d71-85a8-0e8a2b0a0e0d'
```

> ⚠️ La `SUPABASE_KEY` es la publishable key (antes llamada anon key).
> La secret key NUNCA va en el frontend.

---

## Modelo de datos (7 tablas)

```
sucursal        → datos de cada local físico
empleado        → barberos + admins (rol ENUM: barbero | admin_sucursal | admin_general)
horario_barbero → turnos semanales por barbero (entidad débil de empleado)
cliente         → registrado (con Auth) o anónimo (solo nombre+teléfono)
servicio        → catálogo de servicios con duración y precio
cita            → central del sistema, unifica online+telefónica+walkin
detalle_cita    → N:M entre cita y servicio, PK compuesta (id_cita, id_servicio)
bloqueo_telefono → anti-spam: 1 reserva por teléfono por día
```

### ENUMs importantes
- `rol_empleado`: barbero | admin_sucursal | admin_general
- `estado_barbero`: libre | en_espera | ocupado | ausente
- `origen_cita`: online | telefonica | walkin
- `estado_cita`: pendiente_confirmacion | pendiente | en_curso | completada | cancelada | no_presentada
  - `pendiente_confirmacion`: reserva online recién creada, esperando que el cliente confirme por email (expira en 10 min)

### Funciones RPC clave (llamar via `/rest/v1/rpc/`)
- `obtener_slots_disponibles(p_id_empleado, p_fecha, p_duracion_min)` → slots libres del día
- `barbero_disponible(p_id_empleado, p_inicio, p_fin)` → bool, verifica traslapes
- `telefono_puede_reservar(p_telefono, p_id_sucursal, p_fecha)` → bool, anti-spam
- `registrar_walkin(p_id_sucursal, p_nombre, p_telefono, p_id_servicio, p_id_empleado?)` → UUID cita
- `cambiar_estado_cita(p_id_cita, p_nuevo_estado, p_motivo?)` → {ok, error?}

### Vistas disponibles
- `v_panel_barberos` → estado en tiempo real de barberos + cita activa
- `v_cola_walkins` → cola del día con espera estimada
- `v_citas_del_dia` → todas las citas del día con detalle completo
- `v_historial_cliente` → historial por cliente (filtrado por RLS)

### Triggers automáticos
- Al cambiar `detalle_cita` → recalcula `fecha_hora_fin` de la cita
- Al crear cita online → registra bloqueo de teléfono
- Al cancelar cita → libera bloqueo de teléfono
- Al cambiar estado de cita → actualiza `estado_actual` del barbero

---

## Cómo funciona el cliente HTTP (sin SDK)

Toda la comunicación con Supabase es via fetch directo:

```javascript
// GET
GET  /rest/v1/{tabla}?select=*&columna=eq.valor

// POST
POST /rest/v1/{tabla}
Header: Prefer: return=representation  // para obtener el registro creado

// RPC
POST /rest/v1/rpc/{funcion}
Body: { param1: value1, param2: value2 }

// Auth login
POST /auth/v1/token?grant_type=password
Body: { email, password }
```

---

## Estado actual por semana

### ✅ Semana 1 — Base de datos
- Schema completo en Supabase (ejecutado y verificado)
- 8 tablas, 7 ENUMs, triggers, RLS, vistas y funciones
- Empleados de prueba insertados con horarios Lun-Sáb 9-21h

### ✅ Semana 2 — Landing conectada a Supabase
- Servicios y barberos cargan dinámicamente desde BD
- Modal de agendado con flujo de 5 pasos:
  nombre → teléfono → servicio → barbero → slot disponible
- Verificación de bloqueo de teléfono antes de insertar
- Doble verificación de disponibilidad del barbero
- Carrusel de barberos con estado en tiempo real
- Skeleton loaders mientras carga

### ✅ Semana 2.5 — Dashboard base
- Login con Supabase Auth
- Sidebar con 4 paneles: Barberos | Citas | Walk-in | Cola
- Tarjetas de barbero con estado semántico (verde/amarillo/rojo)
- Cuenta regresiva en tiempo real para servicios en curso
- Botones Iniciar / Finalizar / Cancelar con validación de transiciones
- Modal de confirmación para cancelaciones con motivo obligatorio
- Registro de walk-in con asignación automática de barbero
- Supabase Realtime via WebSocket + polling fallback

### ✅ Semana 3 — Auth real + vincular empleados
- `getSucursalId()` en dashboard.js usa `sesion.empleado.id_sucursal` dinámico
- Dashboard protegido: sin sesión muestra pantalla de login
- RLS de admin_sucursal implementado
- Paso manual pendiente por despliegue: crear cuentas Auth y correr
  `database/vincular_empleados.sql` con los UUIDs reales

### ✅ Semana 4 — Kiosko walk-in + reserva telefónica
- `kiosko.html` / `kiosko.js`: auto-registro para tablet (nombre + teléfono
  + servicio), sin login, muestra espera estimada en cola
- Reserva telefónica desde el dashboard (admin) con búsqueda de cliente

### ✅ Semana 5 — Email de confirmación
- Función serverless `api/enviar-confirmacion-cita.js` (Resend)
- Cita online entra como `pendiente_confirmacion`; el cliente confirma
  vía link de email (`confirmar.html` + RPC `confirmar_cita_por_token`)
- Token con expiración de 10 min; `cancelar_tokens_expirados()` (pg_cron)
  cancela las no confirmadas
- Pendiente: historial de cliente + descarga PDF

### ✅ Semana 6 — Deploy + limpieza
- Desplegado en https://barber-kodde.vercel.app
- `RESEND_API_KEY` y config Supabase como variables de entorno en Vercel
- `vercel.json` con rewrites para rutas limpias
- Base de datos consolidada en `schema.sql` único

---

## Pendiente antes de entrega final

- **Ejecutar `database/fix_criticos.sql` en la BD de producción** (Supabase
  SQL Editor): agrega `pendiente_confirmacion` al ENUM, corrige la URL del
  email al dominio real, y cierra la fuga de seguridad de tokens.
- Crear cuentas Auth de los barberos y correr `vincular_empleados.sql`.
- (Opcional) Historial de cliente registrado + descarga de PDF.

---

## Decisiones de diseño importantes (no cambiar sin razón)

**`fecha_hora_fin` almacenada** — no calculada en consulta. Necesario para
índices de traslape eficientes. El trigger la recalcula automáticamente.

**`detalle_cita` con PK compuesta** `(id_cita, id_servicio)` — permite múltiples
servicios por cita. El modelo original del PDF tenía un error (PK solo id_cita).

**`auth_user_id` nullable en empleado** — durante desarrollo los barberos no
tienen cuenta Auth. Se vincula después con UPDATE.

**Sin SDK de Supabase** — fetch directo a la REST API. Decisión deliberada para
mantener cero dependencias en un proyecto Vanilla JS.

**Bloqueo de teléfono por día** — previene reservas múltiples del mismo número.
Se libera automáticamente si la cita se cancela (trigger).

**`registrar_walkin` es una función RPC atómica** — crea cliente + cita +
detalle en una sola transacción. No hacer esto en múltiples llamadas desde el
frontend.

---

## Paleta de colores (CSS variables)

```css
--clr-gold:       #b88e3c   /* acento principal */
--clr-gold-light: #d4a853   /* hover */
--clr-bg:         #0d0d0d   /* fondo principal */
--clr-surface:    #1e1e1e   /* tarjetas */

/* Estados semánticos del dashboard */
--clr-libre:      #22c55e   /* verde */
--clr-espera:     #eab308   /* amarillo */
--clr-ocupado:    #ef4444   /* rojo */
--clr-ausente:    #6b7280   /* gris */
```

---

## Tipografía

- `Playfair Display` — títulos hero y modal (serif, elegante)
- `Barlow Condensed` — UI: labels, botones, nav (condensed, uppercase)
- `Barlow` — cuerpo de texto (sans-serif, ligero)

---

