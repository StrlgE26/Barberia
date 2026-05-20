# Base de datos — Barber Cerdas / The Hipster

Schema organizado por capas para facilitar lectura y mantenimiento. Está pensado para correr sobre **Supabase** (PostgreSQL 15+).

## Orden de ejecución

Los archivos están numerados en el orden exacto en que deben ejecutarse en una BD nueva:

| # | Archivo | Qué contiene |
|---|---|---|
| **00** | `00_README.md` | Esta guía |
| **01** | `01_ddl.sql` | Estructura: extensions, ENUMs, tablas, índices |
| **02** | `02_funciones_base.sql` | Helpers de auth + lógica de negocio interna + validación de teléfono |
| **03** | `03_triggers.sql` | 5 triggers que mantienen consistencia automática |
| **04** | `04_rls.sql` | Row Level Security + GRANTs por rol |
| **05** | `05_vistas.sql` | 4 vistas para el dashboard y el historial del cliente |
| **06** | `06_rpc_publicas.sql` | RPCs que llama `anon` (landing, kiosko, /confirmar) |
| **07** | `07_rpc_admin.sql` | RPCs solo admin (`registrar_walkin`, `cambiar_estado_cita`) |
| **08** | `08_rpc_cliente.sql` | RPCs cliente Auth (`cancelar_mi_cita`, `vincular_o_crear_cliente_registrado`) |
| **09** | `09_email_confirmacion.sql` | Tabla de tokens + RPCs generar/confirmar/cancelar |
| **10** | `10_limpieza_automatica.sql` | Jobs `pg_cron` (autocancelación + limpieza diaria) |
| **11** | `11_seed.sql` | Datos iniciales (sucursal, servicios, empleados) |

Y dos archivos sueltos que **no** son parte del setup automático:

| Archivo | Cuándo se usa |
|---|---|
| `vincular_empleados.sql` | **Paso MANUAL** post-deploy. Vincula cada empleado a su cuenta Supabase Auth después de crearlas en el Dashboard. |
| `limpiar_datos.sql` | Utilidad de desarrollo. Vacía datos transaccionales sin perder el catálogo / empleados. |

`_archivo/` contiene el schema consolidado anterior y `fix_criticos.sql`, conservados como referencia histórica.

---

## Cómo levantar la BD desde cero

```text
1. En el Dashboard de Supabase → SQL Editor
2. Ejecuta cada archivo del 01 al 11 en orden.
3. Habilita pg_cron en Database → Extensions (si no está).
4. Ve a Authentication → Users y crea las cuentas Auth.
5. Ejecuta vincular_empleados.sql con los UUIDs reales.
```

> El orden importa: 02 usa funciones de 01, 04 (policies) referencia helpers de 02, 03 (triggers) usa funciones de 02, 09 referencia `cita` y `cliente` de 01, etc.

## Setup adicional fuera de SQL

Algunas piezas no están en SQL porque viven en el Dashboard de Supabase:

- **Authentication → URL Configuration**:
  - Site URL: `https://barber-kodde.vercel.app`
  - Redirect URLs: `https://barber-kodde.vercel.app/**`
- **Authentication → Email Templates**: opcional, personalizar el correo de verificación.
- **Realtime** (Database → Replication): habilitar las tablas que el dashboard escucha (`cita`, `empleado` recomendado).
- **Variables de entorno en Vercel**:
  - `RESEND_API_KEY` (envío de emails de confirmación)
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Arquitectura de seguridad (resumen)

- **RLS habilitada** en todas las tablas sensibles.
- **`anon`** (sin login) puede:
  - Leer catálogo (servicios, barberos, sucursales).
  - Insertar `cita` solo si `origen='online'`, `cliente` solo si `tipo='anonimo'`, `detalle_cita`, `bloqueo_telefono`.
  - Ejecutar las RPCs públicas (`06_rpc_publicas.sql`).
- **`authenticated`** (logueado) tiene acceso amplio; la diferenciación cliente/admin se hace dentro de las RPCs y policies con `obtener_rol_usuario()`.
- **RPCs `SECURITY DEFINER`** se usan cuando una operación legítima (ej. cancelar tu propia cita) requiere acceso que las policies regulares no permitirían. Cada una valida `auth.uid()` por dentro.

## Identidad del cliente (regla de oro)

Una persona = una fila en `cliente`. Si un cliente anónimo (`auth_user_id IS NULL`) decide registrarse después, **se hace upgrade in-place**: la misma fila gana `auth_user_id` y `tipo='registrado'`. El `id_cliente` UUID nunca cambia, así que sus citas históricas siguen siendo suyas.

La lógica de upgrade vive en `vincular_o_crear_cliente_registrado` (ver `08_rpc_cliente.sql`).
