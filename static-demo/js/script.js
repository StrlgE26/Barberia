'use strict';

// ─── SESIÓN CLIENTE ───────────────────────────────────────────────────────────
const CLI_TOKEN_KEY = 'sb_cli_token';
const CLI_USER_KEY  = 'sb_user';

// ─── WIZARD STATE ─────────────────────────────────────────────────────────────
const booking = {
  idSucursal:  'suc-001',
  servicios:   [], // [{id, nombre, precio, duracion}]
  idBarbero:   '',
  fecha:       '',
  slotIso:     '',
  currentStep: 1,
};

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Año en el footer
  const yearEl = document.getElementById('currentYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Navbar toggle
  const navToggle = document.getElementById('navToggle');
  const navMenu   = document.getElementById('navMenu');
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const open = navMenu.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open);
    });
  }

  // Scroll-based navbar shadow
  window.addEventListener('scroll', () => {
    document.getElementById('navbar')?.classList.toggle('is-scrolled', window.scrollY > 60);
  }, { passive: true });

  // Smooth scroll for nav links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); navMenu?.classList.remove('is-open'); }
    });
  });

  // Booking modal triggers
  document.querySelectorAll('.js-open-booking').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); openBookingModal(); });
  });

  // Wizard navigation
  document.getElementById('wizardNext')?.addEventListener('click', wizardNext);
  document.getElementById('wizardPrev')?.addEventListener('click', wizardPrev);
  document.getElementById('bookingForm')?.addEventListener('submit', handleSubmitBooking);
  document.getElementById('modalClose')?.addEventListener('click', closeBookingModal);
  document.getElementById('modalBackdrop')?.addEventListener('click', closeBookingModal);

  // Auth modal triggers
  document.getElementById('navAcceder')?.addEventListener('click', () => openAuthModal('login'));
  document.getElementById('navCuentaToggle')?.addEventListener('click', toggleCuentaDropdown);
  document.getElementById('navLogoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('navMisCitas')?.addEventListener('click', () => { window.location.href = '/mi-cuenta'; });
  document.getElementById('authModalClose')?.addEventListener('click', closeAuthModal);
  document.getElementById('authModalBackdrop')?.addEventListener('click', closeAuthModal);
  document.querySelectorAll('.auth-tab').forEach(t => t.addEventListener('click', () => switchAuthTab(t.dataset.tab)));
  document.getElementById('authLoginForm')?.addEventListener('submit', handleAuthLogin);
  document.getElementById('authRegisterForm')?.addEventListener('submit', handleAuthRegister);
  document.getElementById('authSinCuenta')?.addEventListener('click', () => { closeAuthModal(); openBookingModal(); });
  document.getElementById('regSinCuenta')?.addEventListener('click', () => { closeAuthModal(); openBookingModal(); });

  // Date field: min = today
  const fieldDate = document.getElementById('fieldDate');
  if (fieldDate) fieldDate.min = DEMO.getHoy();

  // Slot / barbero change listeners
  document.getElementById('fieldBarber')?.addEventListener('change', () => { booking.idBarbero = document.getElementById('fieldBarber').value; loadSlots(); });
  document.getElementById('fieldDate')?.addEventListener('change', () => { booking.fecha = document.getElementById('fieldDate').value; loadSlots(); });

  // Load dynamic content
  loadServicios();
  loadCarousel();
  loadSucursales();
  checkSession();
  initScrollReveal();
});

// ─── SESSION ──────────────────────────────────────────────────────────────────
function checkSession() {
  const token = localStorage.getItem(CLI_TOKEN_KEY);
  const raw   = localStorage.getItem(CLI_USER_KEY);
  if (token && raw) {
    try {
      const user = JSON.parse(raw);
      if (user.rol === 'cliente') { setLoggedInUI(user); return; }
    } catch (_) { /* ignore */ }
  }
  setLoggedOutUI();
}

function setLoggedInUI(user) {
  document.getElementById('navAcceder').hidden = true;
  const cuenta = document.getElementById('navCuenta');
  if (cuenta) cuenta.hidden = false;
}

function setLoggedOutUI() {
  document.getElementById('navAcceder').hidden = false;
  const cuenta = document.getElementById('navCuenta');
  if (cuenta) cuenta.hidden = true;
}

function toggleCuentaDropdown() {
  const dd = document.getElementById('navCuentaDropdown');
  if (dd) dd.hidden = !dd.hidden;
}

function handleLogout() {
  localStorage.removeItem(CLI_TOKEN_KEY);
  localStorage.removeItem(CLI_USER_KEY);
  setLoggedOutUI();
  toast('Sesión cerrada.');
}

// ─── SERVICIOS GRID (sección pública) ────────────────────────────────────────
function loadServicios() {
  const grid = document.getElementById('serviciosGrid');
  if (!grid) return;
  grid.innerHTML = DEMO.SERVICIOS.map(s => `
    <article class="service-card ${s.destacado ? 'service-card--featured' : ''}">
      ${s.destacado ? '<span class="service-card__badge">Más popular</span>' : ''}
      <div class="service-card__body">
        <h3 class="service-card__name">${esc(s.nombre)}</h3>
        <p class="service-card__desc">${esc(s.descripcion)}</p>
      </div>
      <div class="service-card__foot">
        <span class="service-card__price">$${s.precio}</span>
        <span class="service-card__duration">${s.duracion_min} min</span>
        <button class="btn btn--ghost btn--sm js-open-booking">Agendar</button>
      </div>
    </article>`).join('');

  grid.querySelectorAll('.js-open-booking').forEach(btn => {
    btn.addEventListener('click', () => openBookingModal());
  });
}

// ─── CARRUSEL EQUIPO ──────────────────────────────────────────────────────────
function loadCarousel() {
  const track = document.getElementById('carouselTrack');
  if (!track) return;
  const barberos = DEMO.EMPLEADOS_BASE.filter(e => e.rol === 'barbero');
  track.innerHTML = barberos.map(b => `
    <div class="carousel__slide">
      <div class="team-card">
        <div class="team-card__photo team-card__photo--inicial">${b.nombre[0]}${b.apellido[0]}</div>
        <h3 class="team-card__name">${esc(b.nombre)} ${esc(b.apellido)}</h3>
        <p class="team-card__role">${esc(b.especialidad || 'Barbero')}</p>
      </div>
    </div>`).join('');

  initCarousel(barberos.length);
}

function initCarousel(total) {
  let idx = 0;
  const prev  = document.getElementById('carouselPrev');
  const next  = document.getElementById('carouselNext');
  const dots  = document.getElementById('carouselDots');
  const track = document.getElementById('carouselTrack');

  if (!track || total === 0) return;

  if (dots) {
    dots.innerHTML = Array.from({ length: total }, (_, i) =>
      `<button class="carousel__dot ${i===0?'is-active':''}" data-i="${i}" aria-label="Barbero ${i+1}"></button>`
    ).join('');
    dots.querySelectorAll('.carousel__dot').forEach(d => {
      d.addEventListener('click', () => goSlide(+d.dataset.i));
    });
  }

  function goSlide(n) {
    idx = (n + total) % total;
    track.style.transform = `translateX(-${idx * 100}%)`;
    dots?.querySelectorAll('.carousel__dot').forEach((d, i) => d.classList.toggle('is-active', i === idx));
  }

  prev?.addEventListener('click', () => goSlide(idx - 1));
  next?.addEventListener('click', () => goSlide(idx + 1));

  // Auto-advance
  setInterval(() => goSlide(idx + 1), 4000);
}

// ─── SUCURSALES ───────────────────────────────────────────────────────────────
function loadSucursales() {
  const container = document.getElementById('sucursalesContainer');
  if (!container) return;
  const s = DEMO.SUCURSAL;
  container.innerHTML = `
    <div class="sucursal-card">
      <div class="sucursal-card__info">
        <h3 class="sucursal-card__nombre">${esc(s.nombre)}</h3>
        <p class="sucursal-card__dir">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${esc(s.direccion)}
        </p>
        <p class="sucursal-card__tel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.82 19.79 19.79 0 01.5 1.18 2 2 0 012.68 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.45 7.35a16 16 0 006.18 6.18l1.71-1.48a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>
          ${esc(s.telefono)}
        </p>
        <p class="sucursal-card__horario">${esc(s.horario)}</p>
        <button class="btn btn--primary js-open-booking" style="margin-top:1rem">Agendar aquí</button>
      </div>
      <div class="sucursal-card__map">
        <a href="https://maps.google.com/?q=${encodeURIComponent(s.direccion)}" target="_blank" rel="noopener" class="sucursal-card__map-link">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
          Ver en Google Maps
        </a>
      </div>
    </div>`;

  container.querySelector('.js-open-booking')?.addEventListener('click', () => openBookingModal());
}

// ─── BOOKING MODAL ────────────────────────────────────────────────────────────
function openBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (!modal) return;
  modal.removeAttribute('aria-hidden');
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  resetWizard();
}

function closeBookingModal() {
  const modal = document.getElementById('bookingModal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');
  document.body.style.overflow = '';
}

function resetWizard() {
  booking.servicios  = [];
  booking.idBarbero  = '';
  booking.fecha      = '';
  booking.slotIso    = '';
  booking.currentStep = 1;
  showWizardStep(1);
  renderServiceCards();
  populateWizardBarberos();
  populateSucursal();
  updateStep1Total();
  prefillGuestIfLoggedIn();
}

function showWizardStep(step) {
  booking.currentStep = step;
  document.querySelectorAll('.wizard-panel').forEach((p, i) => {
    p.classList.toggle('is-active', i + 1 === step);
    p.hidden = i + 1 !== step;
  });
  document.querySelectorAll('.wizard-step').forEach(s => {
    const n = +s.dataset.step;
    s.classList.toggle('is-active', n === step);
    s.classList.toggle('is-done', n < step);
  });
  document.getElementById('wizardPrev').hidden = step === 1;
  document.getElementById('wizardNext').hidden = step === 3;
  document.getElementById('submitBookingBtn').hidden = step !== 3;

  if (step === 3) buildSummaryCard();
}

function wizardNext() {
  if (booking.currentStep === 1) {
    if (!booking.idSucursal) { toast('Selecciona una sucursal.', 'error'); return; }
    if (!booking.servicios.length) { toast('Selecciona al menos un servicio.', 'error'); return; }
  }
  if (booking.currentStep === 2) {
    if (!booking.idBarbero) { toast('Selecciona un barbero.', 'error'); return; }
    if (!booking.fecha) { toast('Selecciona una fecha.', 'error'); return; }
    if (!booking.slotIso) { toast('Selecciona un horario.', 'error'); return; }
  }
  showWizardStep(booking.currentStep + 1);
}

function wizardPrev() {
  showWizardStep(booking.currentStep - 1);
}

// Step 1 — Sucursal
function populateSucursal() {
  const sel = document.getElementById('fieldSucursal');
  if (!sel) return;
  sel.innerHTML = `<option value="suc-001" selected>${esc(DEMO.SUCURSAL.nombre)}</option>`;
  booking.idSucursal = 'suc-001';
}

// Step 1 — Service cards
function renderServiceCards() {
  const grid = document.getElementById('serviceCardsGrid');
  if (!grid) return;
  grid.innerHTML = DEMO.SERVICIOS.map(s => `
    <label class="service-check-card ${s.destacado ? 'service-check-card--featured' : ''}" data-id="${s.id_servicio}">
      <input type="checkbox" class="service-check-card__input" value="${s.id_servicio}" aria-label="${esc(s.nombre)}"/>
      <div class="service-check-card__body">
        <span class="service-check-card__name">${esc(s.nombre)}</span>
        <span class="service-check-card__detail">$${s.precio} · ${s.duracion_min} min</span>
      </div>
      <span class="service-check-card__check" aria-hidden="true">✓</span>
    </label>`).join('');

  grid.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const srv = DEMO.getSrv(cb.value);
      if (!srv) return;
      if (cb.checked) {
        if (!booking.servicios.find(s => s.id === srv.id_servicio))
          booking.servicios.push({ id: srv.id_servicio, nombre: srv.nombre, precio: srv.precio, duracion: srv.duracion_min });
      } else {
        booking.servicios = booking.servicios.filter(s => s.id !== srv.id_servicio);
      }
      cb.closest('label').classList.toggle('is-selected', cb.checked);
      updateStep1Total();
    });
  });
}

function updateStep1Total() {
  const el = document.getElementById('step1Total');
  if (!el) return;
  if (!booking.servicios.length) { el.hidden = true; return; }
  const total = booking.servicios.reduce((acc, s) => acc + s.precio, 0);
  const dur   = booking.servicios.reduce((acc, s) => acc + s.duracion, 0);
  el.textContent = `Total: $${total} · ${dur} min`;
  el.hidden = false;
}

// Step 2 — Barberos
function populateWizardBarberos() {
  const sel = document.getElementById('fieldBarber');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecciona un barbero…</option>';
  DEMO.EMPLEADOS_BASE.filter(e => e.rol === 'barbero').forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id_empleado;
    opt.textContent = `${b.nombre} ${b.apellido} — ${b.especialidad || ''}`;
    sel.appendChild(opt);
  });
  booking.idBarbero = '';
}

function loadSlots() {
  const { idBarbero, fecha } = booking;
  const container = document.getElementById('slotsContainer');
  const grid      = document.getElementById('slotPillGrid');
  const empty     = document.getElementById('slotsEmpty');
  if (!container || !grid) return;

  if (!idBarbero || !fecha) { container.classList.add('is-hidden'); return; }

  const durTotal = booking.servicios.reduce((acc, s) => acc + s.duracion, 30);
  const slots    = DEMO.generarSlots(idBarbero, fecha, durTotal);

  container.classList.remove('is-hidden');
  grid.innerHTML = '';
  empty.classList.toggle('is-hidden', slots.length > 0);
  booking.slotIso = '';

  slots.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-pill';
    btn.textContent = s.hora;
    btn.dataset.iso = s.iso;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.slot-pill').forEach(p => { p.classList.remove('is-selected'); p.setAttribute('aria-checked','false'); });
      btn.classList.add('is-selected');
      btn.setAttribute('aria-checked','true');
      booking.slotIso = s.iso;
    });
    grid.appendChild(btn);
  });
}

// Step 3 — Summary + guest fields
function buildSummaryCard() {
  const card = document.getElementById('summaryCard');
  if (!card) return;
  const emp   = DEMO.getEmp(booking.idBarbero);
  const fecha = booking.fecha ? new Date(booking.fecha + 'T00:00:00').toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : '—';
  const hora  = booking.slotIso ? DEMO.fmtHora(booking.slotIso) : '—';
  const srvs  = booking.servicios.map(s => s.nombre).join(', ') || '—';
  const total = booking.servicios.reduce((acc, s) => acc + s.precio, 0);
  card.innerHTML = `
    <div class="summary-row"><span>Sucursal</span><strong>${esc(DEMO.SUCURSAL.nombre)}</strong></div>
    <div class="summary-row"><span>Servicio(s)</span><strong>${esc(srvs)}</strong></div>
    <div class="summary-row"><span>Barbero</span><strong>${emp ? esc(`${emp.nombre} ${emp.apellido}`) : '—'}</strong></div>
    <div class="summary-row"><span>Fecha</span><strong>${esc(fecha)}</strong></div>
    <div class="summary-row"><span>Hora</span><strong>${hora}</strong></div>
    <div class="summary-row"><span>Total</span><strong>$${total}</strong></div>`;

  // Show logged-in banner or guest fields
  const token = localStorage.getItem(CLI_TOKEN_KEY);
  const raw   = localStorage.getItem(CLI_USER_KEY);
  const loggedBanner = document.getElementById('loggedBanner');
  const guestFields  = document.getElementById('guestFields');
  if (token && raw) {
    try {
      const user = JSON.parse(raw);
      if (user.rol === 'cliente') {
        document.getElementById('loggedName').textContent = `${user.nombre} ${user.apellido}`;
        loggedBanner?.classList.remove('is-hidden');
        if (guestFields) guestFields.style.display = 'none';
        return;
      }
    } catch (_) { /* ignore */ }
  }
  loggedBanner?.classList.add('is-hidden');
  if (guestFields) guestFields.style.display = '';
}

function prefillGuestIfLoggedIn() {
  const raw = localStorage.getItem(CLI_USER_KEY);
  if (!raw) return;
  try {
    const user = JSON.parse(raw);
    const cli  = DEMO.CLIENTE_DEMO;
    const n = document.getElementById('fieldName');
    const a = document.getElementById('fieldApellidos');
    const e = document.getElementById('fieldEmail');
    const t = document.getElementById('fieldPhone');
    if (n) n.value = user.nombre || cli.nombre;
    if (a) a.value = user.apellido || cli.apellido;
    if (e) e.value = user.email || cli.email;
    if (t) t.value = cli.telefono;
  } catch (_) { /* ignore */ }
}

// ─── SUBMIT BOOKING ───────────────────────────────────────────────────────────
async function handleSubmitBooking(e) {
  e.preventDefault();
  if (!booking.servicios.length || !booking.idBarbero || !booking.slotIso) {
    toast('Faltan datos de la reserva.', 'error'); return;
  }

  const btn = document.getElementById('submitBookingBtn');
  btn.disabled = true; btn.textContent = 'Agendando…';

  // Get client data
  let idCliente = null;
  let nombre = '', apellido = '', email = '', telefono = '', notas = '';

  const raw = localStorage.getItem(CLI_USER_KEY);
  if (raw) {
    try {
      const user = JSON.parse(raw);
      if (user.rol === 'cliente') {
        idCliente = user.id;
        nombre    = user.nombre;
        apellido  = user.apellido;
        email     = user.email;
        telefono  = DEMO.CLIENTE_DEMO.telefono;
      }
    } catch (_) { /* ignore */ }
  }

  if (!idCliente) {
    nombre   = document.getElementById('fieldName')?.value.trim() || '';
    apellido = document.getElementById('fieldApellidos')?.value.trim() || '';
    email    = document.getElementById('fieldEmail')?.value.trim() || '';
    telefono = document.getElementById('fieldPhone')?.value.trim() || '';
    notas    = document.getElementById('fieldNotas')?.value.trim() || '';

    if (!nombre || !email || !telefono) {
      toast('Completa nombre, email y teléfono.', 'error');
      btn.disabled = false; btn.textContent = 'Confirmar Reserva';
      return;
    }
  }

  await delay(600);

  // Agendar cada servicio (o uno combinado)
  const result = DEMO.agendarCita({
    idCliente, nombre, apellido, email, telefono,
    idServicio: booking.servicios[0].id,
    idEmpleado: booking.idBarbero,
    idSucursal: 'suc-001',
    fechaHoraInicio: booking.slotIso,
    notas,
  });

  btn.disabled = false; btn.textContent = 'Confirmar Reserva';
  closeBookingModal();
  toast(`¡Reserva confirmada! Token: ${result.token.slice(-6)}`);
}

// ─── AUTH MODAL ───────────────────────────────────────────────────────────────
function openAuthModal(tab) {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.removeAttribute('aria-hidden');
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  switchAuthTab(tab);
}

function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.remove('is-open');
  document.body.style.overflow = '';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', t.dataset.tab === tab);
  });
  document.getElementById('authPanelLogin')?.classList.toggle('is-active', tab === 'login');
  document.getElementById('authPanelRegister')?.classList.toggle('is-active', tab === 'register');
}

async function handleAuthLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('authEmail')?.value.trim();
  const password = document.getElementById('authPassword')?.value;
  const errEl    = document.getElementById('authLoginError');
  const btn      = document.getElementById('authLoginBtn');

  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Verificando…';
  await delay(400);

  const user = DEMO.authenticate(email, password);

  if (!user) { errEl.textContent = 'Correo o contraseña incorrectos.'; btn.disabled = false; btn.textContent = 'Iniciar Sesión'; return; }
  if (user.rol !== 'cliente') { errEl.textContent = 'Acceso solo para clientes en este panel.'; btn.disabled = false; btn.textContent = 'Iniciar Sesión'; return; }

  localStorage.setItem(CLI_TOKEN_KEY, user.token);
  localStorage.setItem(CLI_USER_KEY, JSON.stringify(user));
  btn.disabled = false; btn.textContent = 'Iniciar Sesión';
  setLoggedInUI(user);
  closeAuthModal();
  toast(`Bienvenida, ${user.nombre}!`);
}

async function handleAuthRegister(e) {
  e.preventDefault();
  const nombre   = document.getElementById('regNombre')?.value.trim();
  const apellido = document.getElementById('regApellido')?.value.trim();
  const email    = document.getElementById('regEmail')?.value.trim();
  const password = document.getElementById('regPassword')?.value;
  const errEl    = document.getElementById('authRegisterError');
  const btn      = document.getElementById('authRegisterBtn');

  errEl.textContent = '';
  if (!nombre || !apellido || !email || !password) { errEl.textContent = 'Completa todos los campos.'; return; }
  if (password.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }

  btn.disabled = true; btn.textContent = 'Creando…';
  await delay(500);

  const user = { id:'cli-001', email, nombre, apellido, rol:'cliente', token:'demo_' + Math.random().toString(36).slice(2) };
  localStorage.setItem(CLI_TOKEN_KEY, user.token);
  localStorage.setItem(CLI_USER_KEY, JSON.stringify(user));
  btn.disabled = false; btn.textContent = 'Crear cuenta';
  setLoggedInUI(user);
  closeAuthModal();
  toast(`Cuenta creada. Bienvenida, ${user.nombre}!`);
}

// ─── SCROLL REVEAL ────────────────────────────────────────────────────────────
function initScrollReveal() {
  const targets = document.querySelectorAll('.service-card, .sucursal-card, .section-header');
  if (!targets.length || !window.IntersectionObserver) {
    targets.forEach(el => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); } });
  }, { threshold: 0.12 });
  targets.forEach(el => io.observe(el));
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function toast(msg, type = 'success') {
  let el = document.getElementById('siteToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'siteToast';
    el.style.cssText = 'position:fixed;bottom:4rem;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #b88e3c;color:#fff;padding:.8rem 1.6rem;border-radius:8px;font-size:.88rem;z-index:99999;transition:opacity .3s;pointer-events:none;max-width:90vw;text-align:center;';
    document.body.appendChild(el);
  }
  el.style.borderColor = type === 'error' ? '#ef4444' : '#b88e3c';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}
