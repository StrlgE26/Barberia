'use strict';

// ─── SESIÓN DE CLIENTE ────────────────────────────────────────────────────────
const CLI_TOKEN_KEY = 'sb_cli_token';
const CLI_USER_KEY  = 'sb_user';

let currentUser   = null;
let cancelTarget  = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tab navigation
  document.querySelectorAll('.account-tab').forEach(tab => {
    tab.addEventListener('click', () => switchSection(tab.dataset.section));
  });

  // Gate buttons
  document.getElementById('gateLoginBtn').addEventListener('click', () => openAuthModal('login'));
  document.getElementById('gateRegisterBtn').addEventListener('click', () => openAuthModal('register'));

  // Auth modal close
  document.getElementById('authModalClose').addEventListener('click', closeAuthModal);
  document.getElementById('authModalBackdrop').addEventListener('click', closeAuthModal);
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.addEventListener('click', () => switchAuthTab(t.dataset.tab));
  });

  // Auth forms
  document.getElementById('authLoginForm').addEventListener('submit', handleLogin);
  document.getElementById('authRegisterForm').addEventListener('submit', handleRegister);

  // Logout
  document.getElementById('topbarLogout').addEventListener('click', handleLogout);

  // Cancel modal
  document.getElementById('cancelModalClose').addEventListener('click', closeCancelModal);
  document.getElementById('cancelModalBackdrop').addEventListener('click', closeCancelModal);
  document.getElementById('cancelModalNo').addEventListener('click', closeCancelModal);
  document.getElementById('cancelModalOk').addEventListener('click', ejecutarCancelacion);

  // Perfil form
  document.getElementById('perfilForm').addEventListener('submit', handlePerfilSave);

  // Check existing session
  checkSession();
});

// ─── SESIÓN ───────────────────────────────────────────────────────────────────
function checkSession() {
  const token = localStorage.getItem(CLI_TOKEN_KEY);
  const raw   = localStorage.getItem(CLI_USER_KEY);
  if (token && raw) {
    try {
      const user = JSON.parse(raw);
      if (user.rol === 'cliente') { enterAccount(user); return; }
    } catch (_) { /* ignore */ }
  }
  showGate();
}

function showGate() {
  document.getElementById('accountGate').classList.remove('is-hidden');
  document.getElementById('accountMain').classList.add('is-hidden');
  document.getElementById('topbarLogout').hidden = true;
  document.getElementById('topbarHello').textContent = '';
}

function enterAccount(user) {
  currentUser = user;
  document.getElementById('accountGate').classList.add('is-hidden');
  document.getElementById('accountMain').classList.remove('is-hidden');
  document.getElementById('topbarLogout').hidden = false;
  document.getElementById('topbarHello').textContent = `Hola, ${user.nombre}`;
  document.getElementById('mainNombre').textContent = user.nombre;

  const cli = DEMO.CLIENTE_DEMO;
  const desde = new Date(cli.fecha_registro).toLocaleDateString('es-MX', { year:'numeric', month:'long' });
  document.getElementById('mainSub').textContent = `Miembro desde ${desde}`;

  loadProximas();
  loadHistorial();
  loadStats();
  loadPerfil();
  closeAuthModal();
}

function handleLogout() {
  localStorage.removeItem(CLI_TOKEN_KEY);
  localStorage.removeItem(CLI_USER_KEY);
  currentUser = null;
  showGate();
}

// ─── AUTH MODAL ───────────────────────────────────────────────────────────────
function openAuthModal(tab) {
  const modal = document.getElementById('authModal');
  modal.removeAttribute('aria-hidden');
  switchAuthTab(tab);
}

function closeAuthModal() {
  document.getElementById('authModal').setAttribute('aria-hidden', 'true');
  document.getElementById('authLoginError').textContent = '';
  document.getElementById('authRegisterError').textContent = '';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', t.dataset.tab === tab);
  });
  document.getElementById('authPanelLogin').classList.toggle('is-active', tab === 'login');
  document.getElementById('authPanelRegister').classList.toggle('is-active', tab === 'register');
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl    = document.getElementById('authLoginError');
  const btn      = document.getElementById('authLoginBtn');

  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Verificando…';

  await delay(400);

  const user = DEMO.authenticate(email, password);

  if (!user) { errEl.textContent = 'Correo o contraseña incorrectos.'; btn.disabled = false; btn.textContent = 'Iniciar Sesión'; return; }
  if (user.rol !== 'cliente') { errEl.textContent = 'Este panel es solo para clientes.'; btn.disabled = false; btn.textContent = 'Iniciar Sesión'; return; }

  localStorage.setItem(CLI_TOKEN_KEY, user.token);
  localStorage.setItem(CLI_USER_KEY, JSON.stringify(user));
  btn.disabled = false; btn.textContent = 'Iniciar Sesión';
  enterAccount(user);
}

async function handleRegister(e) {
  e.preventDefault();
  const nombre   = document.getElementById('regNombre').value.trim();
  const apellido = document.getElementById('regApellido').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errEl    = document.getElementById('authRegisterError');
  const btn      = document.getElementById('authRegisterBtn');

  errEl.textContent = '';
  if (!nombre || !apellido || !email || !password) { errEl.textContent = 'Completa todos los campos.'; return; }
  if (password.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }

  btn.disabled = true; btn.textContent = 'Creando cuenta…';
  await delay(500);

  // In demo, just simulate a successful registration with the demo client
  const user = { id:'cli-001', email, nombre, apellido, rol:'cliente', token:'demo_' + Math.random().toString(36).slice(2) };
  localStorage.setItem(CLI_TOKEN_KEY, user.token);
  localStorage.setItem(CLI_USER_KEY, JSON.stringify(user));
  btn.disabled = false; btn.textContent = 'Crear cuenta';
  enterAccount(user);
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchSection(sectionId) {
  document.querySelectorAll('.account-tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.section === sectionId);
    t.setAttribute('aria-selected', t.dataset.section === sectionId);
  });
  document.querySelectorAll('.account-section').forEach(s => {
    s.classList.toggle('is-active', s.id === `section-${sectionId}`);
  });
}

// ─── PRÓXIMAS CITAS ───────────────────────────────────────────────────────────
function loadProximas() {
  const lista = document.getElementById('listaProximas');
  const empty = document.getElementById('emptyProximas');
  const count = document.getElementById('tabCountProximas');

  const citas = DEMO.getProximasCitas();
  count.textContent = citas.length;

  if (!citas.length) {
    lista.innerHTML = '';
    empty.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');

  lista.innerHTML = citas.map(c => `
    <div class="cita-card">
      <div class="cita-card__head">
        <span class="cita-card__fecha">${c.fecha_larga} · ${c.hora}</span>
        <span class="cita-badge cita-badge--${c.estado}">${labelEstado(c.estado)}</span>
      </div>
      <h3 class="cita-card__title">${esc(c.servicio_nombre)}</h3>
      <p class="cita-card__row">Con <strong>${esc(c.barbero_nombre)}</strong></p>
      ${c.notas ? `<p class="cita-card__row">Nota: ${esc(c.notas)}</p>` : ''}
      <p class="cita-card__total">$${c.precio}</p>
      <div class="cita-card__foot">
        <button class="cita-card__cancel-btn" data-id="${c.id_cita}" data-desc="${esc(c.servicio_nombre)} el ${esc(c.fecha_larga)}">Cancelar</button>
      </div>
    </div>`).join('');

  lista.querySelectorAll('.cita-card__cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => openCancelModal(btn.dataset.id, btn.dataset.desc));
  });
}

// ─── HISTORIAL ────────────────────────────────────────────────────────────────
function loadHistorial() {
  const lista = document.getElementById('listaHistorial');
  const empty = document.getElementById('emptyHistorial');
  const count = document.getElementById('tabCountHistorial');

  const citas = DEMO.getHistorialCitas();
  count.textContent = citas.length;

  if (!citas.length) {
    lista.innerHTML = '';
    empty.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');

  lista.innerHTML = citas.map(c => `
    <div class="cita-card">
      <div class="cita-card__head">
        <span class="cita-card__fecha">${c.fecha_larga} · ${c.hora}</span>
        <span class="cita-badge cita-badge--${c.estado}">${labelEstado(c.estado)}</span>
      </div>
      <h3 class="cita-card__title">${esc(c.servicio_nombre)}</h3>
      <p class="cita-card__row">Con <strong>${esc(c.barbero_nombre)}</strong></p>
      <p class="cita-card__total">$${c.precio}</p>
    </div>`).join('');
}

// ─── ESTADÍSTICAS ─────────────────────────────────────────────────────────────
function loadStats() {
  const grid = document.getElementById('statsGrid');
  const hist = DEMO.getHistorialCitas();
  const prox = DEMO.getProximasCitas();

  const completadas   = hist.filter(c => c.estado === 'completada');
  const canceladas    = hist.filter(c => c.estado === 'cancelada');
  const noPresentadas = hist.filter(c => c.estado === 'no_presentada');
  const totalGastado  = completadas.reduce((acc, c) => acc + c.precio, 0);

  const servicioFav = completadas.reduce((acc, c) => {
    acc[c.servicio_nombre] = (acc[c.servicio_nombre] || 0) + 1; return acc;
  }, {});
  const favNombre = Object.entries(servicioFav).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

  grid.innerHTML = `
    <div class="stat-card">
      <p class="stat-card__label">Visitas completadas</p>
      <p class="stat-card__value">${completadas.length}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">Total invertido</p>
      <p class="stat-card__value">$${totalGastado.toLocaleString('es-MX')}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">Próximas citas</p>
      <p class="stat-card__value">${prox.length}</p>
    </div>
    <div class="stat-card">
      <p class="stat-card__label">Canceladas / No vino</p>
      <p class="stat-card__value">${canceladas.length + noPresentadas.length}</p>
    </div>
    <div class="stat-card stat-card--wide">
      <p class="stat-card__label">Servicio favorito</p>
      <p class="stat-card__value" style="font-size:1.2rem">${esc(favNombre)}</p>
    </div>`;
}

// ─── PERFIL ───────────────────────────────────────────────────────────────────
function loadPerfil() {
  const cli = DEMO.CLIENTE_DEMO;
  document.getElementById('perfilNombre').value   = currentUser?.nombre  || cli.nombre;
  document.getElementById('perfilApellido').value = currentUser?.apellido || cli.apellido;
  document.getElementById('perfilEmail').value    = currentUser?.email    || cli.email;
  document.getElementById('perfilTelefono').value = cli.telefono;
}

async function handlePerfilSave(e) {
  e.preventDefault();
  const btn = document.getElementById('perfilGuardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  await delay(500);
  DEMO.actualizarPerfil({});
  btn.disabled = false; btn.textContent = 'Guardar cambios';
  toast('Perfil actualizado');
}

// ─── MODAL CANCELACIÓN ────────────────────────────────────────────────────────
function openCancelModal(idCita, desc) {
  cancelTarget = idCita;
  document.getElementById('cancelModalDesc').textContent = desc;
  document.getElementById('cancelMotivo').value = '';
  const modal = document.getElementById('cancelModal');
  modal.style.display = '';
  modal.removeAttribute('aria-hidden');
}

function closeCancelModal() {
  document.getElementById('cancelModal').style.display = 'none';
  cancelTarget = null;
}

async function ejecutarCancelacion() {
  if (!cancelTarget) return;
  const btn = document.getElementById('cancelModalOk');
  btn.disabled = true; btn.textContent = 'Cancelando…';
  await delay(400);
  DEMO.cancelarCita(cancelTarget, document.getElementById('cancelMotivo').value.trim());
  btn.disabled = false; btn.textContent = 'Sí, cancelar';
  closeCancelModal();
  loadProximas();
  loadHistorial();
  loadStats();
  toast('Cita cancelada correctamente');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function labelEstado(estado) {
  return {
    pendiente_confirmacion: 'Por confirmar',
    pendiente:   'Pendiente',
    en_espera:   'En espera',
    en_curso:    'En curso',
    completada:  'Completada',
    cancelada:   'Cancelada',
    no_presentada: 'No asistí',
  }[estado] || estado;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function toast(msg) {
  let el = document.getElementById('mcToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mcToast';
    el.style.cssText = 'position:fixed;bottom:3rem;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #b88e3c;color:#fff;padding:.7rem 1.4rem;border-radius:6px;font-size:.85rem;z-index:9998;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}
