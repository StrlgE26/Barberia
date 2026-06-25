'use strict';

// ─── CONSTANTES DE SESIÓN ────────────────────────────────────────────────────
const SESSION_KEY  = 'sb_token';
const SESSION_USER = 'sb_user';

// ─── ESTADO LOCAL ─────────────────────────────────────────────────────────────
let currentPanel    = 'panel-barberos';
let refreshInterval = null;
let pendingCancelId = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const stored = sessionStorage.getItem(SESSION_USER);
  if (stored) {
    try { initDashboard(JSON.parse(stored)); } catch (_) { showLogin(); }
  } else {
    showLogin();
  }

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.querySelectorAll('.sidebar__nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('refreshBtn').addEventListener('click', () => loadPanel(currentPanel));
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('is-open');
  });
  document.getElementById('walkinForm').addEventListener('submit', handleWalkin);
  document.getElementById('wkServicio').addEventListener('change', tryLoadSlots);
  document.getElementById('wkBarbero').addEventListener('change', tryLoadSlots);
  document.getElementById('wkFecha').addEventListener('change', tryLoadSlots);
  document.getElementById('modalConfirmCancel').addEventListener('click', closeConfirmModal);
  document.getElementById('modalConfirmBackdrop').addEventListener('click', closeConfirmModal);
  document.getElementById('modalConfirmOk').addEventListener('click', ejecutarCancelacion);
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('dashboardApp').style.display = 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Verificando…';

  await delay(400);

  const user = DEMO.authenticate(email, password);

  if (!user || user.rol === 'cliente') {
    errEl.textContent = user ? 'Acceso no autorizado para clientes.' : 'Credenciales incorrectas.';
    btn.disabled = false;
    btn.textContent = 'Entrar al panel';
    return;
  }

  sessionStorage.setItem(SESSION_KEY, user.token);
  sessionStorage.setItem(SESSION_USER, JSON.stringify(user));
  initDashboard(user);
}

function initDashboard(user) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboardApp').style.display = '';

  // Sidebar user info
  document.getElementById('userName').textContent = `${user.nombre} ${user.apellido}`;
  document.getElementById('userRole').textContent = labelRol(user.rol);
  document.getElementById('userAvatar').textContent = user.nombre[0] + user.apellido[0];

  // Date
  document.getElementById('topbarDate').textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Populate walkin selects
  populateWalkinSelects();

  // Set today's date on walkin date picker
  document.getElementById('wkFecha').value = DEMO.getHoy();

  loadPanel('panel-barberos');
  startPolling();
}

function handleLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_USER);
  stopPolling();
  showLogin();
}

// ─── PANEL NAVIGATION ─────────────────────────────────────────────────────────
function switchPanel(panelId) {
  document.querySelectorAll('.sidebar__nav-item').forEach(b => b.classList.toggle('is-active', b.dataset.panel === panelId));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('is-active', p.id === panelId));
  document.getElementById('topbarTitle').textContent = PANEL_TITLES[panelId] || panelId;
  currentPanel = panelId;
  loadPanel(panelId);
  document.getElementById('sidebar').classList.remove('is-open');
}

const PANEL_TITLES = {
  'panel-barberos': 'Panel de Barberos',
  'panel-citas':    'Citas del Día',
  'panel-walkin':   'Reserva Telefónica',
  'panel-cola':     'Cola de Espera',
};

function loadPanel(panelId) {
  switch (panelId) {
    case 'panel-barberos': loadBarberos(); break;
    case 'panel-citas':    loadCitas(); break;
    case 'panel-walkin':   loadWalkinEstados(); break;
    case 'panel-cola':     loadCola(); break;
  }
}

// ─── PANEL BARBEROS ───────────────────────────────────────────────────────────
function loadBarberos() {
  const grid    = document.getElementById('barberosGrid');
  const loading = document.getElementById('barberosLoading');
  loading.style.display = '';
  grid.innerHTML = '';

  const barberos = DEMO.getPanelBarberos();
  loading.style.display = 'none';

  if (!barberos.length) { grid.innerHTML = '<p class="empty-state">Sin barberos registrados.</p>'; return; }

  grid.innerHTML = barberos.map(b => renderBarberoCard(b)).join('');
  grid.querySelectorAll('.btn-estado').forEach(btn => {
    btn.addEventListener('click', () => {
      const idCita   = btn.dataset.cita;
      const estado   = btn.dataset.estado;
      const nombre   = btn.dataset.nombre;
      cambiarEstado(idCita, estado, nombre);
    });
  });
}

function renderBarberoCard(b) {
  const estadoClass = {
    libre: 'libre', en_espera: 'en-espera', ocupado: 'ocupado', ausente: 'ausente',
  }[b.estado_actual] || 'libre';

  const estadoLabel = {
    libre: 'Libre', en_espera: 'En espera', ocupado: 'Ocupado', ausente: 'Ausente',
  }[b.estado_actual] || b.estado_actual;

  const avatarHtml = b.foto_url
    ? `<img src="${b.foto_url}" alt="${b.barbero_nombre}" class="barbero-card__foto"/>`
    : `<div class="barbero-card__foto barbero-card__foto--inicial">${b.barbero_nombre.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>`;

  let citaHtml = '';
  if (b.estado_actual === 'ocupado' && b.cita_id_actual) {
    citaHtml = `
      <div class="barbero-card__cita">
        <p class="barbero-card__cita-cliente">${esc(b.cliente_actual || b.nombre_walkin || '—')}</p>
        <p class="barbero-card__cita-servicio">${esc(b.servicio_actual || '—')}</p>
        <p class="barbero-card__cita-hora">${b.hora_inicio_actual} – ${b.hora_fin_actual}</p>
      </div>
      <div class="barbero-card__acciones">
        <button class="btn-estado btn btn--sm btn--primary" data-cita="${b.cita_id_actual}" data-estado="completada" data-nombre="${esc(b.cliente_actual || '')}">✓ Completar</button>
        <button class="btn-estado btn btn--sm btn--ghost" data-cita="${b.cita_id_actual}" data-estado="no_presentada" data-nombre="${esc(b.cliente_actual || '')}">No vino</button>
      </div>`;
  } else if (b.estado_actual === 'en_espera' && b.cita_id_actual) {
    citaHtml = `
      <div class="barbero-card__cita">
        <p class="barbero-card__cita-cliente">${esc(b.cliente_actual || '—')}</p>
        <p class="barbero-card__cita-servicio">${esc(b.servicio_actual || '—')}</p>
      </div>
      <div class="barbero-card__acciones">
        <button class="btn-estado btn btn--sm btn--primary" data-cita="${b.cita_id_actual}" data-estado="en_curso" data-nombre="${esc(b.cliente_actual || '')}">▶ Iniciar</button>
      </div>`;
  } else if (b.proxima_cita_hora) {
    citaHtml = `<p class="barbero-card__proxima">Próxima: <strong>${b.proxima_cita_hora}</strong></p>`;
  }

  return `
    <div class="barbero-card barbero-card--${estadoClass}">
      <div class="barbero-card__header">
        ${avatarHtml}
        <div class="barbero-card__info">
          <h3 class="barbero-card__nombre">${esc(b.barbero_nombre)}</h3>
          <p class="barbero-card__especialidad">${esc(b.especialidad || '—')}</p>
        </div>
        <span class="barbero-card__estado barbero-card__estado--${estadoClass}">${estadoLabel}</span>
      </div>
      ${citaHtml}
    </div>`;
}

function cambiarEstado(idCita, nuevoEstado, nombreCliente) {
  if (!idCita) return;
  if (nuevoEstado === 'cancelada') {
    openConfirmModal(idCita, `¿Cancelar la cita de ${nombreCliente}?`);
    return;
  }
  DEMO.cambiarEstadoCita(idCita, nuevoEstado);
  loadPanel(currentPanel);
  toast(`Estado actualizado → ${nuevoEstado}`);
}

// ─── PANEL CITAS ──────────────────────────────────────────────────────────────
function loadCitas() {
  const tbody   = document.getElementById('citasTablaBody');
  const empty   = document.getElementById('citasEmpty');
  const loading = document.getElementById('citasLoading');
  loading.style.display = '';

  const citas = DEMO.getCitasDelDia();
  loading.style.display = 'none';

  if (!citas.length) {
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = citas.map(c => `
    <tr>
      <td>${c.hora_inicio}<span class="hora-sep">–</span>${c.hora_fin}</td>
      <td>${esc(c.cliente_nombre)}</td>
      <td>${esc(c.servicio_nombre)}</td>
      <td>${esc(c.barbero_nombre)}</td>
      <td><span class="origen-badge origen-badge--${c.origen}">${c.origen}</span></td>
      <td><span class="estado-badge estado-badge--${c.estado}">${labelEstado(c.estado)}</span></td>
      <td class="citas-acciones">${renderAcciones(c)}</td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, cita, nombre } = btn.dataset;
      if (action === 'cancelar') {
        openConfirmModal(cita, `¿Cancelar la cita de ${nombre}?`);
      } else {
        DEMO.cambiarEstadoCita(cita, action);
        loadCitas();
        toast('Estado actualizado');
      }
    });
  });
}

function renderAcciones(c) {
  const map = {
    pendiente:             [['en_curso','▶ Iniciar','btn--primary'],['cancelar','✕ Cancelar','btn--danger']],
    en_espera:             [['en_curso','▶ Iniciar','btn--primary'],['cancelar','✕ Cancelar','btn--danger']],
    en_curso:              [['completada','✓ Completar','btn--primary'],['no_presentada','No vino','btn--ghost']],
    pendiente_confirmacion:[['pendiente','Confirmar','btn--primary'],['cancelar','✕ Cancelar','btn--danger']],
  };
  const acciones = map[c.estado];
  if (!acciones) return '—';
  return acciones.map(([action, label, cls]) =>
    `<button class="btn btn--sm ${cls}" data-action="${action}" data-cita="${c.id_cita}" data-nombre="${esc(c.cliente_nombre)}">${label}</button>`
  ).join(' ');
}

// ─── PANEL WALKIN ─────────────────────────────────────────────────────────────
function populateWalkinSelects() {
  const srvSel = document.getElementById('wkServicio');
  DEMO.SERVICIOS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id_servicio;
    opt.textContent = `${s.nombre} · $${s.precio} · ${s.duracion_min} min`;
    srvSel.appendChild(opt);
  });

  const barSel = document.getElementById('wkBarbero');
  DEMO.EMPLEADOS_BASE.filter(e => e.rol === 'barbero').forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id_empleado;
    opt.textContent = `${b.nombre} ${b.apellido}`;
    barSel.appendChild(opt);
  });
}

function tryLoadSlots() {
  const idSrv = document.getElementById('wkServicio').value;
  const idEmp = document.getElementById('wkBarbero').value;
  const fecha = document.getElementById('wkFecha').value;
  const slotSel = document.getElementById('wkSlot');

  slotSel.innerHTML = '<option value="">Cargando…</option>';
  slotSel.disabled = true;

  if (!idSrv || !idEmp || !fecha) {
    slotSel.innerHTML = '<option value="">Selecciona servicio, barbero y fecha</option>';
    return;
  }

  const srv = DEMO.getSrv(idSrv);
  const slots = DEMO.generarSlots(idEmp, fecha, srv?.duracion_min || 30);

  slotSel.innerHTML = '';
  if (!slots.length) {
    slotSel.innerHTML = '<option value="">Sin horarios disponibles</option>';
    return;
  }

  slotSel.disabled = false;
  slotSel.innerHTML = '<option value="">Selecciona horario…</option>';
  slots.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.iso;
    opt.textContent = s.hora;
    slotSel.appendChild(opt);
  });
}

function loadWalkinEstados() {
  const container = document.getElementById('walkinEstados');
  const barberos = DEMO.getPanelBarberos();
  container.innerHTML = barberos.map(b => {
    const estadoClass = { libre:'libre', en_espera:'en-espera', ocupado:'ocupado', ausente:'ausente' }[b.estado_actual] || 'libre';
    const label = { libre:'Libre', en_espera:'En espera', ocupado:'Ocupado', ausente:'Ausente' }[b.estado_actual];
    return `<div class="walkin-barbero-row">
      <span class="walkin-barbero-nombre">${esc(b.barbero_nombre)}</span>
      <span class="barbero-card__estado barbero-card__estado--${estadoClass}">${label}</span>
    </div>`;
  }).join('');
}

async function handleWalkin(e) {
  e.preventDefault();
  const nombre = document.getElementById('wkNombre').value.trim();
  const tel    = document.getElementById('wkTelefono').value.trim();
  const idSrv  = document.getElementById('wkServicio').value;
  const idEmp  = document.getElementById('wkBarbero').value;
  const slotIso = document.getElementById('wkSlot').value;

  if (!nombre || !tel || !idSrv || !idEmp || !slotIso) {
    toast('Completa todos los campos requeridos.', 'error'); return;
  }

  const btn = document.getElementById('wkSubmitBtn');
  btn.disabled = true; btn.textContent = 'Creando…';

  await delay(300);

  // Use agendarCita to support date/slot selection (not just now)
  DEMO.agendarCita({
    idCliente: null, nombre, apellido: '', telefono: tel, email: '',
    idServicio: idSrv, idEmpleado: idEmp, idSucursal: 'suc-001',
    fechaHoraInicio: slotIso, notas: document.getElementById('wkNotas').value.trim(),
  });

  toast(`Reserva creada para ${nombre}`);
  document.getElementById('walkinForm').reset();
  document.getElementById('wkFecha').value = DEMO.getHoy();
  document.getElementById('wkSlot').innerHTML = '<option value="">Selecciona servicio, barbero y fecha</option>';
  document.getElementById('wkSlot').disabled = true;
  btn.disabled = false; btn.textContent = 'Crear reservación';
  loadWalkinEstados();
}

// ─── PANEL COLA ───────────────────────────────────────────────────────────────
function loadCola() {
  const grid    = document.getElementById('colaGrid');
  const empty   = document.getElementById('colaEmpty');
  const loading = document.getElementById('colaLoading');
  loading.style.display = '';

  const cola = DEMO.getColaWalkins();
  loading.style.display = 'none';

  if (!cola.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = cola.map(c => `
    <div class="cola-card">
      <div class="cola-card__pos">#${c.posicion_cola}</div>
      <div class="cola-card__info">
        <p class="cola-card__nombre">${esc(c.nombre_walkin)}</p>
        <p class="cola-card__servicio">${esc(c.servicio_nombre)} · ${esc(c.barbero_nombre)}</p>
        ${c.espera_estimada_min > 0 ? `<p class="cola-card__espera">~${c.espera_estimada_min} min de espera</p>` : '<p class="cola-card__espera">Próximo en turno</p>'}
      </div>
    </div>`).join('');
}

// ─── MODAL CANCELACIÓN ────────────────────────────────────────────────────────
function openConfirmModal(idCita, titulo) {
  pendingCancelId = idCita;
  document.getElementById('modalConfirmTitle').textContent = titulo || '¿Cancelar esta cita?';
  document.getElementById('motivoCancelacion').value = '';
  document.getElementById('modalConfirm').style.display = '';
}

function closeConfirmModal() {
  document.getElementById('modalConfirm').style.display = 'none';
  pendingCancelId = null;
}

function ejecutarCancelacion() {
  if (!pendingCancelId) return;
  const motivo = document.getElementById('motivoCancelacion').value.trim();
  DEMO.cambiarEstadoCita(pendingCancelId, 'cancelada', motivo);
  closeConfirmModal();
  loadPanel(currentPanel);
  toast('Cita cancelada');
}

// ─── POLLING ──────────────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  refreshInterval = setInterval(() => loadPanel(currentPanel), 5000);
}
function stopPolling() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function labelRol(rol) {
  return { admin_general:'Admin General', admin_sucursal:'Admin Sucursal', barbero:'Barbero', cliente:'Cliente' }[rol] || rol;
}

function labelEstado(estado) {
  return { pendiente_confirmacion:'Por confirmar', pendiente:'Pendiente', en_espera:'En espera',
           en_curso:'En curso', completada:'Completada', cancelada:'Cancelada', no_presentada:'No vino' }[estado] || estado;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function toast(msg, type = 'success') {
  let el = document.getElementById('demoToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demoToast';
    el.style.cssText = 'position:fixed;bottom:3rem;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #b88e3c;color:#fff;padding:.7rem 1.4rem;border-radius:6px;font-size:.85rem;z-index:9999;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  if (type === 'error') el.style.borderColor = '#ef4444';
  else el.style.borderColor = '#b88e3c';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}
