/**
 * BARBER CERDAS — dashboard.js
 * Panel de administración de sucursal
 *
 * Módulos:
 *  1. Configuración Supabase
 *  2. Cliente HTTP (mismo db wrapper que script.js)
 *  3. Auth — login / logout / verificar sesión
 *  4. Navegación entre paneles
 *  5. Panel Barberos — tarjetas con estado en tiempo real
 *  6. Panel Citas — tabla del día con acciones
 *  7. Panel Walk-in — registro rápido
 *  8. Panel Cola — walk-ins activos
 *  9. Acciones de cita — iniciar / finalizar / cancelar
 * 10. Realtime — Supabase Realtime subscriptions
 * 11. Utilidades
 */

'use strict';

/* ============================================================
   1. CONFIGURACIÓN
   ============================================================ */
const SUPABASE_URL = 'https://cqsgilldrbbigkuxjgnj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_k6gNs3jVdHzQn_eBbMzqVg_ANwgYtuN';
const ID_SUCURSAL  = '5d024273-df32-4d71-85a8-0e8a2b0a0e0d';

/* Caché para evitar re-renders innecesarios */
const dataCache = {
  barberos: null,
  citas: null,
  cola: null,

  hash(data) {
    return JSON.stringify(data);
  },

  changed(key, newData) {
    const oldHash = this[key] ? this.hash(this[key]) : '';
    const newHash = this.hash(newData);
    if (oldHash !== newHash) {
      this[key] = newData;
      return true;
    }
    return false;
  }
};

/* ============================================================
   2. CLIENTE HTTP
   ============================================================ */
/* Fetch con refresco automático de JWT al recibir 401 */
async function apiFetch(url, { extraHeaders = {}, ...opts } = {}) {
  const hdrs = { ...headers(), ...extraHeaders };
  const res  = await fetch(url, { ...opts, headers: hdrs });

  if (res.status === 401) {
    await refreshSesion();
    return fetch(url, { ...opts, headers: { ...headers(), ...extraHeaders } });
  }
  return res;
}

const db = {
  async get(tabla, select = '*', filtros = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${tabla}?select=${encodeURIComponent(select)}`;
    Object.entries(filtros).forEach(([col, val]) => {
      url += `&${col}=eq.${encodeURIComponent(val)}`;
    });
    const res = await apiFetch(url);
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message || `Error ${res.status}`);
    return res.json();
  },

  async post(tabla, data, retornar = false) {
    const res = await apiFetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
      method: 'POST',
      extraHeaders: { 'Prefer': retornar ? 'return=representation' : 'return=minimal' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message || `Error ${res.status}`);
    return retornar ? res.json() : null;
  },

  async patch(tabla, data, filtros = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${tabla}?`;
    Object.entries(filtros).forEach(([col, val]) => {
      url += `${col}=eq.${encodeURIComponent(val)}&`;
    });
    const res = await apiFetch(url, {
      method: 'PATCH',
      extraHeaders: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message || `Error ${res.status}`);
  },

  async rpc(funcion, params = {}) {
    const res = await apiFetch(`${SUPABASE_URL}/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).message || `Error ${res.status}`);
    return res.json();
  },
};

/* Headers con token de sesión si existe */
function headers() {
  const token = sesion.token || SUPABASE_KEY;
  return {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  };
}

/* ============================================================
   3. SESIÓN — Auth con Supabase
   ============================================================ */
const sesion = {
  token:   null,
  usuario: null,
  empleado: null,
};

async function login(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey':       SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_description || data.msg || 'Credenciales incorrectas');
  }

  sesion.token   = data.access_token;
  sesion.usuario = data.user;

  // Guardar token en sessionStorage (se borra al cerrar el tab)
  sessionStorage.setItem('sb_token',   data.access_token);
  sessionStorage.setItem('sb_refresh', data.refresh_token);
  sessionStorage.setItem('sb_user',    JSON.stringify(data.user));
}

async function cargarEmpleadoActual() {
  if (!sesion.usuario) return;

  const empleados = await db.get(
    'empleado',
    'id_empleado,nombre,apellidos,rol,id_sucursal,especialidad',
    { auth_user_id: sesion.usuario.id }
  );

  if (empleados.length === 0) {
    throw new Error('Tu cuenta no está vinculada a ningún empleado. Contacta al administrador.');
  }

  sesion.empleado = empleados[0];
}

function restaurarSesion() {
  const token   = sessionStorage.getItem('sb_token');
  const userRaw = sessionStorage.getItem('sb_user');

  if (!token || !userRaw) return false;

  sesion.token   = token;
  sesion.usuario = JSON.parse(userRaw);
  return true;
}

async function logout() {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: headers(),
    });
  } catch (_) { /* ignorar errores de red al cerrar sesión */ }

  sessionStorage.clear();
  // Limpiar también la sesión de cliente en localStorage (si entró desde la landing)
  ['sb_cli_token','sb_cli_refresh','sb_cli_user','sb_cli_nombre'].forEach(k => localStorage.removeItem(k));
  sesion.token    = null;
  sesion.usuario  = null;
  sesion.empleado = null;

  mostrarLogin();
  showToast('Sesión cerrada. ¡Hasta luego!', 'success');
}

async function refreshSesion() {
  const rt = sessionStorage.getItem('sb_refresh');
  if (!rt) { await logout(); throw new Error('Sesión expirada.'); }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rt }),
  });

  if (!res.ok) { await logout(); throw new Error('Sesión expirada. Inicia sesión de nuevo.'); }

  const data = await res.json();
  sesion.token   = data.access_token;
  sesion.usuario = data.user;
  sessionStorage.setItem('sb_token',   data.access_token);
  sessionStorage.setItem('sb_refresh', data.refresh_token);
  sessionStorage.setItem('sb_user',    JSON.stringify(data.user));
}

function iniciarAutoRefresh() {
  // Refresca el token cada 55 min antes de que expire (Supabase expira en 1h)
  setInterval(async () => {
    if (sesion.token) {
      try { await refreshSesion(); } catch (_) { /* logout ya fue llamado */ }
    }
  }, 55 * 60 * 1000);
}

/* Devuelve la sucursal del empleado logueado, con fallback al hardcodeado */
function getSucursalId() {
  return sesion.empleado?.id_sucursal || ID_SUCURSAL;
}

/* ============================================================
   4. NAVEGACIÓN ENTRE PANELES
   ============================================================ */
function initNav() {
  const navItems = document.querySelectorAll('.sidebar__nav-item');
  const panels   = document.querySelectorAll('.panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.dataset.panel;

      navItems.forEach(n => n.classList.remove('is-active'));
      panels.forEach(p  => p.classList.remove('is-active'));

      item.classList.add('is-active');
      document.getElementById(targetId)?.classList.add('is-active');

      // Actualizar título del topbar
      document.getElementById('topbarTitle').textContent = item.textContent.trim();

      // Cerrar sidebar en mobile
      if (window.innerWidth <= 900) {
        document.getElementById('sidebar')?.classList.remove('is-open');
      }

      // Cargar datos del panel activado
      switch (targetId) {
        case 'panel-barberos': cargarBarberos(); break;
        case 'panel-citas':    cargarCitas();    break;
        case 'panel-cola':     cargarCola();     break;
        case 'panel-walkin':   cargarWalkin();   break;
      }
    });
  });

  // Toggle sidebar mobile
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('is-open');
  });

  // Botón refresh
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    await recargarPanelActivo();
    setTimeout(() => btn.classList.remove('spinning'), 600);
    showToast('Panel actualizado.', 'success');
  });

  // Fecha actual en topbar
  document.getElementById('topbarDate').textContent =
    new Date().toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
}

async function recargarPanelActivo() {
  const activo = document.querySelector('.panel.is-active')?.id;
  switch (activo) {
    case 'panel-barberos': await cargarBarberos(); break;
    case 'panel-citas':    await cargarCitas();    break;
    case 'panel-cola':     await cargarCola();     break;
    case 'panel-walkin':   await cargarWalkin();   break;
  }
}

/* ============================================================
   5. PANEL BARBEROS
   ============================================================ */
let timersBarberos = {}; // timers de cuenta regresiva por barbero

async function cargarBarberos() {
  const grid    = document.getElementById('barberosGrid');
  const loading = document.getElementById('barberosLoading');

  if (!grid) return;

  if (!dataCache.barberos) loading?.style.setProperty('display', 'flex');

  try {
    const barberos = await db.get(
      'v_panel_barberos',
      '*',
      { id_sucursal: getSucursalId() }
    );

    loading?.style.setProperty('display', 'none');

    // Solo actualizar DOM si los datos realmente cambiaron
    if (!dataCache.changed('barberos', barberos)) {
      return; // Sin cambios, no hacer re-render
    }

    if (barberos.length === 0) {
      grid.innerHTML = '<p class="empty-state">No hay barberos registrados en esta sucursal.</p>';
      return;
    }

    // Limpiar timers previos
    Object.values(timersBarberos).forEach(clearInterval);
    timersBarberos = {};

    grid.innerHTML = barberos.map(b => renderBarberoCard(b)).join('');

    // Iniciar timers de cuenta regresiva para los que están en curso
    barberos.forEach(b => {
      if (b.cita_estado === 'en_curso' && b.fecha_hora_fin) {
        iniciarTimer(b.id_empleado, b.fecha_hora_fin);
      }
    });

    // Registrar acciones de los botones
    registrarAccionesBarberos();

  } catch (err) {
    loading?.style.setProperty('display', 'none');
    grid.innerHTML = `<p class="empty-state">Error al cargar barberos. Intenta actualizar.</p>`;
    showToast('No se pudo cargar el panel de barberos.', 'error');
  }
}

function renderBarberoCard(b) {
  const estadoLabels = {
    libre:     'Disponible',
    en_espera: 'En espera',
    ocupado:   'Ocupado',
    ausente:   'Ausente',
  };

  const imgUrl = b.foto_url ||
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80';

  const clienteNombre = b.cliente_nombre || b.nombre_walkin || 'Cliente walk-in';
  const tieneServicio = b.cita_estado === 'pendiente' || b.cita_estado === 'en_curso';

  return `
    <div class="barbero-card estado-${b.estado_actual}"
         data-id="${b.id_empleado}"
         data-cita="${b.id_cita || ''}"
         data-estado-cita="${b.cita_estado || ''}">
      <div class="barbero-card__estado-bar"></div>
      <div class="barbero-card__header">
        <img src="${escapeHtml(imgUrl)}"
             alt="${escapeHtml(b.barbero_nombre)}"
             class="barbero-card__foto"
             loading="lazy"/>
        <div class="barbero-card__info">
          <p class="barbero-card__nombre">
            ${escapeHtml(b.barbero_nombre)} ${escapeHtml(b.barbero_apellidos || '')}
          </p>
          <p class="barbero-card__especialidad">${escapeHtml(b.especialidad || '—')}</p>
        </div>
        <span class="barbero-card__badge">
          <span class="barbero-card__badge-dot"></span>
          ${estadoLabels[b.estado_actual] || b.estado_actual}
        </span>
      </div>

      ${tieneServicio ? `
        <div class="barbero-card__cita">
          <p class="barbero-card__cita-cliente">${escapeHtml(clienteNombre)}</p>
          <p class="barbero-card__cita-servicio">${escapeHtml(b.servicios_nombres || '—')} · $${formatPrecio(b.precio_total || 0)}</p>
          <div class="barbero-card__cita-tiempo">
            <span class="barbero-card__cita-hora">
              ${formatHora(b.fecha_hora_inicio)} – ${formatHora(b.fecha_hora_fin)}
            </span>
            ${b.cita_estado === 'en_curso'
              ? `<span class="barbero-card__timer" id="timer-${b.id_empleado}">
                   ${formatCountdown(b.fecha_hora_fin)}
                 </span>`
              : ''
            }
          </div>
          <div class="barbero-card__acciones">
            ${b.cita_estado === 'pendiente' ? `
              <button class="btn btn--iniciar js-iniciar"
                      data-cita="${b.id_cita}">
                ▶ Iniciar
              </button>` : ''}
            ${b.cita_estado === 'en_curso' ? `
              <button class="btn btn--finalizar js-finalizar"
                      data-cita="${b.id_cita}">
                ✓ Finalizar
              </button>` : ''}
            ${tieneServicio ? `
              <button class="btn btn--cancelar js-cancelar"
                      data-cita="${b.id_cita}"
                      data-nombre="${escapeHtml(clienteNombre)}">
                ✕ Cancelar
              </button>` : ''}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function iniciarTimer(idEmpleado, fechaFin) {
  const el = document.getElementById(`timer-${idEmpleado}`);
  if (!el) return;

  timersBarberos[idEmpleado] = setInterval(() => {
    const texto = formatCountdown(fechaFin);
    el.textContent = texto;

    // Urgente: menos de 5 minutos
    const mins = (new Date(fechaFin) - new Date()) / 60000;
    el.classList.toggle('urgente', mins < 5);
  }, 1000);
}

/* ============================================================
   6. PANEL CITAS DEL DÍA
   ============================================================ */
async function cargarCitas() {
  const tbody   = document.getElementById('citasTablaBody');
  const loading = document.getElementById('citasLoading');
  const empty   = document.getElementById('citasEmpty');

  if (!tbody) return;

  if (!dataCache.citas) loading?.style.setProperty('display', 'flex');

  try {
    const todasCitas = await db.get(
      'v_citas_del_dia',
      '*',
      { id_sucursal: getSucursalId() }
    );

    // Filtrar por fecha en timezone Mexico City (la vista usa CURRENT_DATE en UTC)
    const hoyMexico = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const citas = todasCitas.filter(c =>
      new Date(c.fecha_hora_inicio).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }) === hoyMexico
    );

    loading?.style.setProperty('display', 'none');

    // Solo actualizar DOM si los datos realmente cambiaron
    if (!dataCache.changed('citas', citas)) {
      return; // Sin cambios, no hacer re-render
    }

    if (citas.length === 0) {
      empty.style.display = 'block';
      tbody.innerHTML = '';
      return;
    }
    empty.style.display = 'none';

    tbody.innerHTML = citas.map(c => {
      const nombre = c.cliente_nombre || 'Walk-in';
      return `
        <tr>
          <td>
            <strong>${formatHora(c.fecha_hora_inicio)}</strong><br>
            <span style="font-size:0.75rem;color:var(--clr-white-40)">
              ${formatHora(c.fecha_hora_fin)}
            </span>
          </td>
          <td>
            <strong>${escapeHtml(nombre)} ${escapeHtml(c.cliente_apellido || '')}</strong><br>
            <span style="font-size:0.75rem;color:var(--clr-white-40)">
              ${escapeHtml(c.cliente_telefono || '—')}
            </span>
          </td>
          <td>
            ${escapeHtml(c.servicios_nombres || '—')}<br>
            <span style="color:var(--clr-gold);font-size:0.8rem">
              $${formatPrecio(c.precio_total)}
            </span>
          </td>
          <td>${escapeHtml(c.barbero_nombre)} ${escapeHtml(c.barbero_apellidos || '')}</td>
          <td>
            <span class="cita-origen-badge">${c.origen}</span>
          </td>
          <td>
            <span class="cita-estado-badge ${c.estado}">${c.estado.replace('_',' ')}</span>
          </td>
          <td>
            <div class="cita-acciones">
              ${c.estado === 'pendiente' ? `
                <button class="btn btn--iniciar btn--sm js-iniciar"
                        data-cita="${c.id_cita}">▶</button>` : ''}
              ${c.estado === 'en_curso' ? `
                <button class="btn btn--finalizar btn--sm js-finalizar"
                        data-cita="${c.id_cita}">✓</button>` : ''}
              ${['pendiente','en_curso'].includes(c.estado) ? `
                <button class="btn btn--cancelar btn--sm js-cancelar"
                        data-cita="${c.id_cita}"
                        data-nombre="${escapeHtml(nombre)}">✕</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    registrarAccionesBarberos(); // mismos handlers

  } catch (err) {
    loading?.style.setProperty('display', 'none');
    empty.style.display = 'block';
    empty.textContent = 'Error al cargar citas. Intenta actualizar.';
    showToast('No se pudieron cargar las citas del día.', 'error');
  }
}

/* ============================================================
   7. PANEL RESERVA TELEFÓNICA
   ============================================================ */
async function cargarWalkin() {
  const selectServicio = document.getElementById('wkServicio');
  const selectBarbero  = document.getElementById('wkBarbero');
  const selectSlot     = document.getElementById('wkSlot');
  const inputFecha     = document.getElementById('wkFecha');
  const estadosDiv     = document.getElementById('walkinEstados');

  // Mínimo: hoy en Mexico City
  if (inputFecha && !inputFecha.min) {
    inputFecha.min = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  }

  try {
    // Servicios (solo primera vez)
    if (selectServicio && selectServicio.options.length <= 1) {
      const servicios = await db.get('servicio', 'id_servicio,nombre,precio,duracion_min', { activo: 'true' });
      selectServicio.innerHTML =
        '<option value="">Selecciona un servicio…</option>' +
        servicios.map(s =>
          `<option value="${s.id_servicio}"
                   data-precio="${s.precio}"
                   data-duracion="${s.duracion_min}">
             ${escapeHtml(s.nombre)} — $${formatPrecio(s.precio)}
           </option>`
        ).join('');
    }

    // Barberos activos
    const barberos = await db.get(
      'v_panel_barberos',
      'id_empleado,barbero_nombre,barbero_apellidos,estado_actual',
      { id_sucursal: getSucursalId() }
    );

    if (selectBarbero && selectBarbero.options.length <= 1) {
      selectBarbero.innerHTML =
        '<option value="">Selecciona un barbero…</option>' +
        barberos
          .filter(b => b.estado_actual !== 'ausente')
          .map(b =>
            `<option value="${b.id_empleado}">
               ${escapeHtml(b.barbero_nombre)} ${escapeHtml(b.barbero_apellidos || '')}
             </option>`
          ).join('');
    }

    // Mini panel de estados
    if (estadosDiv) {
      const etiquetas = { libre:'Disponible', en_espera:'En espera', ocupado:'Ocupado', ausente:'Ausente' };
      estadosDiv.innerHTML = barberos.map(b => `
        <div class="walkin-estado-item">
          <span class="walkin-estado-nombre">${escapeHtml(b.barbero_nombre)}</span>
          <span class="walkin-estado-badge ${b.estado_actual}">
            ${etiquetas[b.estado_actual] || b.estado_actual}
          </span>
        </div>
      `).join('');
    }

  } catch (err) {
    showToast('No se pudo cargar el formulario de reserva.', 'error');
    console.error('Error cargando Reserva Telefónica:', err);
  }

  // Cargador de slots
  async function cargarSlotsWalkin() {
    const barberoId = selectBarbero?.value;
    const fecha     = inputFecha?.value;
    const opt       = selectServicio?.options[selectServicio.selectedIndex];
    const duracion  = parseInt(opt?.dataset.duracion) || 30;
    const precio    = parseFloat(opt?.dataset.precio) || 0;

    if (!barberoId || !fecha || !selectServicio?.value) return;

    if (selectSlot) {
      selectSlot.innerHTML = '<option value="">Cargando horarios…</option>';
      selectSlot.disabled  = true;
    }

    try {
      const slots = await db.rpc('obtener_slots_disponibles', {
        p_id_empleado:  barberoId,
        p_fecha:        fecha,
        p_duracion_min: duracion,
      });

      const disponibles = slots.filter(s => s.disponible);

      if (!selectSlot) return;

      if (disponibles.length === 0) {
        selectSlot.innerHTML = '<option value="">Sin horarios disponibles ese día</option>';
        selectSlot.disabled  = true;
      } else {
        selectSlot.innerHTML =
          '<option value="">Selecciona un horario…</option>' +
          disponibles.map(s =>
            `<option value="${s.slot_inicio}" data-fin="${s.slot_fin}">
               ${formatHora(s.slot_inicio)} – ${formatHora(s.slot_fin)}
             </option>`
          ).join('');
        selectSlot.disabled = false;
      }
    } catch (err) {
      if (selectSlot) {
        selectSlot.innerHTML = `<option value="">Error cargando horarios</option>`;
        selectSlot.disabled  = true;
      }
      showToast('No se pudieron cargar los horarios disponibles.', 'error');
      console.error('Error slots walkin:', err);
    }
  }

  // Registrar listeners de slots (una sola vez)
  if (selectBarbero && !selectBarbero.dataset.slotWk) {
    selectBarbero.dataset.slotWk = '1';
    selectBarbero.addEventListener('change', cargarSlotsWalkin);
  }
  if (inputFecha && !inputFecha.dataset.slotWk) {
    inputFecha.dataset.slotWk = '1';
    inputFecha.addEventListener('change', cargarSlotsWalkin);
  }
  if (selectServicio && !selectServicio.dataset.slotWk) {
    selectServicio.dataset.slotWk = '1';
    selectServicio.addEventListener('change', () => {
      if (selectSlot) {
        selectSlot.innerHTML = '<option value="">Selecciona servicio, barbero y fecha</option>';
        selectSlot.disabled  = true;
      }
      cargarSlotsWalkin();
    });
  }

  // Submit del formulario
  const form = document.getElementById('walkinForm');
  if (form && !form.dataset.listenerRegistrado) {
    form.dataset.listenerRegistrado = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn  = document.getElementById('wkSubmitBtn');
      const nombre     = document.getElementById('wkNombre')?.value.trim();
      const telefono   = document.getElementById('wkTelefono')?.value.trim().replace(/\s/g, '');
      const servicioId = selectServicio?.value;
      const barberoId  = selectBarbero?.value;
      const slotInicio = selectSlot?.value;
      const slotFin    = selectSlot?.options[selectSlot.selectedIndex]?.dataset.fin;
      const notas      = document.getElementById('wkNotas')?.value.trim() || null;
      const opt        = selectServicio?.options[selectServicio.selectedIndex];
      const precio     = parseFloat(opt?.dataset.precio) || 0;

      if (!nombre || !telefono)  { showToast('Completa nombre y teléfono.', 'error'); return; }
      if (!servicioId)           { showToast('Selecciona un servicio.', 'error');     return; }
      if (!barberoId)            { showToast('Selecciona un barbero.', 'error');      return; }
      if (!slotInicio || !slotFin) { showToast('Selecciona un horario disponible.', 'error'); return; }

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Creando reservación…';

      try {
        // Buscar o crear cliente por teléfono
        const existentes = await db.rpc('buscar_cliente_por_telefono', { p_telefono: telefono });
        let clienteId;

        if (existentes.length > 0) {
          clienteId = existentes[0].id_cliente;
        } else {
          const [nuevo] = await db.post('cliente', {
            nombre,
            telefono,
            tipo: 'anonimo',
          }, true);
          clienteId = nuevo.id_cliente;
        }

        // Crear cita con origen 'telefonica'
        const [citaCreada] = await db.post('cita', {
          id_sucursal:       getSucursalId(),
          id_empleado:       barberoId,
          id_cliente:        clienteId,
          fecha_hora_inicio: slotInicio,
          fecha_hora_fin:    slotFin,
          origen:            'telefonica',
          estado:            'pendiente',
          notas,
        }, true);

        // Insertar detalle del servicio
        await db.post('detalle_cita', {
          id_cita:         citaCreada.id_cita,
          id_servicio:     servicioId,
          precio_aplicado: precio,
          orden:           1,
        });

        showToast(`✓ Reservación creada para ${nombre}.`, 'success');
        form.reset();
        if (selectSlot) {
          selectSlot.innerHTML = '<option value="">Selecciona servicio, barbero y fecha</option>';
          selectSlot.disabled  = true;
        }

        await cargarBarberos();

      } catch (err) {
        showToast(err.message || 'Error al crear reservación.', 'error');
      } finally {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Crear reservación';
      }
    });
  }
}

/* ============================================================
   8. PANEL COLA
   ============================================================ */
async function cargarCola() {
  const grid    = document.getElementById('colaGrid');
  const loading = document.getElementById('colaLoading');
  const empty   = document.getElementById('colaEmpty');

  if (!grid) return;

  if (!dataCache.cola) loading?.style.setProperty('display', 'flex');

  try {
    const cola = await db.get(
      'v_cola_walkins',
      '*',
      { id_sucursal: getSucursalId() }
    );

    loading?.style.setProperty('display', 'none');

    // Solo actualizar DOM si los datos realmente cambiaron
    if (!dataCache.changed('cola', cola)) {
      return; // Sin cambios, no hacer re-render
    }

    if (cola.length === 0) {
      empty.style.display = 'block';
      grid.innerHTML = '';
      return;
    }
    empty.style.display = 'none';

    grid.innerHTML = cola.map(c => `
      <div class="cola-card">
        <span class="cola-card__pos">${c.posicion_cola}</span>
        <p class="cola-card__nombre">${escapeHtml(c.nombre_walkin || 'Cliente')}</p>
        <p class="cola-card__servicio">${escapeHtml(c.servicios_nombres || '—')}</p>
        <p class="cola-card__barbero">
          → ${escapeHtml(c.barbero_nombre)} ${escapeHtml(c.barbero_apellidos || '')}
          · ${c.barbero_estado}
        </p>
        <p class="cola-card__espera">
          ⏱ Espera estimada: ${Math.max(0, Math.round(c.espera_estimada_min))} min
        </p>
        <div class="cita-acciones">
          <button class="btn btn--iniciar btn--sm js-iniciar"
                  data-cita="${c.id_cita}">▶ Iniciar</button>
          <button class="btn btn--cancelar btn--sm js-cancelar"
                  data-cita="${c.id_cita}"
                  data-nombre="${escapeHtml(c.nombre_walkin || 'Cliente')}">
            ✕ Cancelar
          </button>
        </div>
      </div>
    `).join('');

    registrarAccionesBarberos();

  } catch (err) {
    loading?.style.setProperty('display', 'none');
    grid.innerHTML = `<p class="empty-state">Error al cargar la cola. Intenta actualizar.</p>`;
    showToast('No se pudo cargar la cola de espera.', 'error');
  }
}

/* ============================================================
   9. ACCIONES DE CITA — iniciar / finalizar / cancelar
   ============================================================ */
function registrarAccionesBarberos() {
  // Limpiar handlers previos clonando
  document.querySelectorAll('.js-iniciar, .js-finalizar, .js-cancelar').forEach(btn => {
    const clon = btn.cloneNode(true);
    btn.replaceWith(clon);
  });

  document.querySelectorAll('.js-iniciar').forEach(btn => {
    btn.addEventListener('click', () => accionCita(btn.dataset.cita, 'en_curso'));
  });

  document.querySelectorAll('.js-finalizar').forEach(btn => {
    btn.addEventListener('click', () => accionCita(btn.dataset.cita, 'completada'));
  });

  document.querySelectorAll('.js-cancelar').forEach(btn => {
    btn.addEventListener('click', () => mostrarModalCancelar(btn.dataset.cita, btn.dataset.nombre));
  });
}

async function accionCita(idCita, nuevoEstado) {
  try {
    const resultado = await db.rpc('cambiar_estado_cita', {
      p_id_cita:      idCita,
      p_nuevo_estado: nuevoEstado,
    });

    if (!resultado.ok) {
      showToast(resultado.error || 'Error al cambiar estado.', 'error');
      return;
    }

    const labels = { en_curso: 'iniciada', completada: 'finalizada', cancelada: 'cancelada' };
    showToast(`✓ Cita ${labels[nuevoEstado] || nuevoEstado}.`, 'success');

    // Refrescar panel activo
    await recargarPanelActivo();

  } catch (err) {
    showToast(err.message || 'Error de conexión.', 'error');
  }
}

/* Modal de confirmación para cancelar */
let citaCancelarId = null;

function mostrarModalCancelar(idCita, nombreCliente) {
  citaCancelarId = idCita;
  const modal = document.getElementById('modalConfirm');
  document.getElementById('modalConfirmTitle').textContent = '¿Cancelar esta cita?';
  document.getElementById('modalConfirmText').textContent =
    `Se cancelará la cita de ${nombreCliente}. Esta acción no se puede deshacer.`;
  document.getElementById('motivoCancelacion').value = '';
  modal.style.display = 'flex';
}

function cerrarModalCancelar() {
  document.getElementById('modalConfirm').style.display = 'none';
  citaCancelarId = null;
}

/* ============================================================
   10. REALTIME — suscripción a cambios en cita y empleado
   ============================================================ */
let realtimeChannel = null;

function iniciarRealtime() {
  if (realtimeChannel) return; // ya suscrito

  // Supabase Realtime via WebSocket
  const wsUrl = SUPABASE_URL.replace('https://', 'wss://') + '/realtime/v1/websocket' +
    `?apikey=${SUPABASE_KEY}&vsn=1.0.0`;

  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // Suscribirse a cambios en tabla cita (todas las columnas)
    ws.send(JSON.stringify({
      topic:   'realtime:public:cita',
      event:   'phx_join',
      payload: { config: { broadcast: { self: true }, presence: { key: '' } } },
      ref:     '1',
    }));

    // Suscribirse a cambios en tabla empleado (estado_actual)
    ws.send(JSON.stringify({
      topic:   'realtime:public:empleado',
      event:   'phx_join',
      payload: { config: { broadcast: { self: true } } },
      ref:     '2',
    }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.event === 'postgres_changes') {
      // Recargar el panel activo cuando hay cambios en BD
      recargarPanelActivo();
    }
  };

  ws.onerror = () => {
    console.warn('[Realtime] WebSocket error, starting polling fallback');
    iniciarPollingConSync();
  };

  ws.onclose = () => {
    console.warn('[Realtime] WebSocket closed, starting polling fallback');
    iniciarPollingConSync();
  };

  realtimeChannel = ws;

  // Garantizar polling aunque Realtime se conecte (sin publication no hay eventos)
  if (!window._pollTimer) {
    console.info('[Realtime] Starting guaranteed polling every 5 seconds');
    iniciarPollingConSync();
  }
}

function iniciarPollingConSync() {
  if (window._pollTimer) return; // Ya hay polling

  // Sincronizar polling cada 5s en múltiplos del epoch (0, 5, 10, 15...)
  // Así dashboard y kiosko polleen al mismo tiempo
  const ahora = Date.now();
  const msCiclo = 5000;
  const msHastaSiguiente = msCiclo - (ahora % msCiclo);

  window._pollTimer = setTimeout(() => {
    recargarPanelActivo();
    window._pollTimer = setInterval(recargarPanelActivo, msCiclo);
  }, msHastaSiguiente);
}

/* ============================================================
   PANTALLAS — mostrar / ocultar login vs dashboard
   ============================================================ */
function mostrarLogin() {
  document.getElementById('loginScreen').style.display  = 'flex';
  document.getElementById('dashboardApp').style.display = 'none';
}

function mostrarDashboard() {
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('dashboardApp').style.display = 'block';

  // Rellenar datos del usuario en el sidebar
  if (sesion.empleado) {
    const e = sesion.empleado;
    const iniciales = `${e.nombre[0]}${e.apellidos?.[0] || ''}`.toUpperCase();
    const roles = { barbero: 'Barbero', admin_sucursal: 'Admin Sucursal', admin_general: 'Admin General' };

    document.getElementById('userAvatar').textContent  = iniciales;
    document.getElementById('userName').textContent    = `${e.nombre} ${e.apellidos || ''}`;
    document.getElementById('userRole').textContent    = roles[e.rol] || e.rol;
    document.getElementById('sidebarSucursal').textContent = 'Sucursal Lindavista';
  }
}

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {

  /* --- Login form --- */
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const loginBtn   = document.getElementById('loginBtn');
    const loginError = document.getElementById('loginError');
    const email      = document.getElementById('loginEmail').value.trim();
    const password   = document.getElementById('loginPassword').value;

    loginBtn.disabled    = true;
    loginBtn.textContent = 'Entrando…';
    loginError.textContent = '';

    try {
      await login(email, password);
      await cargarEmpleadoActual();
      mostrarDashboard();
      initNav();
      await cargarBarberos();
      iniciarRealtime();
      iniciarAutoRefresh();
      const nombre = sesion.empleado?.nombre || '';
      showToast(`¡Bienvenido${nombre ? ', ' + nombre : ''}!`, 'success');
    } catch (err) {
      loginError.textContent = err.message;
    } finally {
      loginBtn.disabled    = false;
      loginBtn.textContent = 'Entrar al panel';
    }
  });

  /* --- Logout --- */
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  /* --- Modal cancelar — botones --- */
  document.getElementById('modalConfirmCancel')?.addEventListener('click', cerrarModalCancelar);
  document.getElementById('modalConfirmBackdrop')?.addEventListener('click', cerrarModalCancelar);

  document.getElementById('modalConfirmOk')?.addEventListener('click', async () => {
    const motivo = document.getElementById('motivoCancelacion').value.trim();
    if (!motivo) {
      showToast('Escribe el motivo de cancelación.', 'error');
      return;
    }
    cerrarModalCancelar();
    try {
      const resultado = await db.rpc('cambiar_estado_cita', {
        p_id_cita:      citaCancelarId,
        p_nuevo_estado: 'cancelada',
        p_motivo:       motivo,
      });
      if (!resultado.ok) {
        showToast(resultado.error || 'Error al cancelar.', 'error');
        return;
      }
      showToast('Cita cancelada.', 'success');
      await recargarPanelActivo();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  /* --- Restaurar sesión si existe --- */
  if (restaurarSesion()) {
    try {
      await cargarEmpleadoActual();
      mostrarDashboard();
      initNav();
      await cargarBarberos();
      iniciarRealtime();
      iniciarAutoRefresh();
    } catch (_) {
      mostrarLogin();
    }
  } else {
    mostrarLogin();
  }
});

/* ============================================================
   UTILIDADES
   ============================================================ */
function formatHora(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatCountdown(isoFin) {
  const diff = new Date(isoFin) - new Date();
  if (diff <= 0) return '¡Tiempo!';
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')} min`;
}

function formatPrecio(num) {
  return Number(num).toLocaleString('es-MX', { minimumFractionDigits: 0 });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(message, type = 'success') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'fixed', bottom: '1.5rem', right: '1.5rem',
    background: type === 'success' ? '#b88e3c' : '#7f1d1d',
    color: type === 'success' ? '#0a0a0a' : '#fff',
    padding: '0.75rem 1.4rem', borderRadius: '6px',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: '700', fontSize: '0.88rem', letterSpacing: '0.06em',
    zIndex: '9999', opacity: '0',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    transform: 'translateY(8px)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    maxWidth: '320px',
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateY(0)';
  }));
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}
