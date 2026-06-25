'use strict';

// ─── ESTADO ───────────────────────────────────────────────────────────────────
const STATE = {
  nombre:     '',
  telefono:   '',
  idServicio: null,
  idBarbero:  null, // null = automático
};
let resetTimer    = null;
let colaInterval  = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnComenzar').addEventListener('click', () => goStep('datos'));

  document.getElementById('btnDatosSig').addEventListener('click', handleDatosSig);
  document.getElementById('btnServicioSig').addEventListener('click', () => goStep('barbero'));
  document.getElementById('btnRegistrar').addEventListener('click', handleRegistrar);
  document.getElementById('btnVolver').addEventListener('click', () => resetKiosko());

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goStep(btn.dataset.back));
  });

  renderServicios();
  renderBarberos();
  loadCola();
  colaInterval = setInterval(loadCola, 5000);
});

// ─── NAVEGACIÓN DE PASOS ──────────────────────────────────────────────────────
function goStep(stepId) {
  document.querySelectorAll('.kiosko-step').forEach(s => s.classList.remove('is-active'));
  const el = document.getElementById(`step-${stepId}`);
  if (el) el.classList.add('is-active');

  if (stepId === 'barbero') renderBarberos();
  if (stepId === 'bienvenida') resetState();
}

function resetState() {
  STATE.nombre = STATE.telefono = '';
  STATE.idServicio = STATE.idBarbero = null;
  document.getElementById('inputNombre').value = '';
  document.getElementById('inputTelefono').value = '';
  document.getElementById('datosError').textContent = '';
  document.querySelectorAll('.servicio-card').forEach(c => c.classList.remove('is-selected'));
  document.getElementById('btnServicioSig').disabled = true;
}

function resetKiosko() {
  if (resetTimer) clearTimeout(resetTimer);
  resetState();
  goStep('bienvenida');
}

// ─── PASO DATOS ───────────────────────────────────────────────────────────────
function handleDatosSig() {
  const nombre = document.getElementById('inputNombre').value.trim();
  const tel    = document.getElementById('inputTelefono').value.trim();
  const errEl  = document.getElementById('datosError');
  if (!nombre) { errEl.textContent = 'Por favor ingresa tu nombre.'; return; }
  if (!tel || tel.length < 8) { errEl.textContent = 'Ingresa un número de teléfono válido.'; return; }
  errEl.textContent = '';
  STATE.nombre   = nombre;
  STATE.telefono = tel;
  goStep('servicio');
}

// ─── PASO SERVICIO ────────────────────────────────────────────────────────────
function renderServicios() {
  const grid = document.getElementById('serviciosGrid');
  grid.innerHTML = DEMO.SERVICIOS.map(s => `
    <button class="servicio-card" data-id="${s.id_servicio}" type="button">
      <span class="servicio-card__nombre">${esc(s.nombre)}</span>
      <span class="servicio-card__precio">$${s.precio}</span>
      <span class="servicio-card__duracion">${s.duracion_min} min</span>
    </button>`).join('');

  grid.querySelectorAll('.servicio-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.servicio-card').forEach(c => c.classList.remove('is-selected'));
      card.classList.add('is-selected');
      STATE.idServicio = card.dataset.id;
      document.getElementById('btnServicioSig').disabled = false;
    });
  });
}

// ─── PASO BARBERO ─────────────────────────────────────────────────────────────
function renderBarberos() {
  const grid = document.getElementById('barberosGridKiosko');
  const barberos = DEMO.getPanelBarberos();

  const autoEl = document.createElement('button');
  autoEl.className = 'barbero-card-kiosko is-selected';
  autoEl.dataset.id = 'auto';
  autoEl.type = 'button';
  autoEl.innerHTML = `
    <div class="barbero-card-kiosko__avatar auto-avatar">★</div>
    <span class="barbero-card-kiosko__nombre">Automático</span>
    <span class="barbero-card-kiosko__estado">El más disponible</span>`;

  grid.innerHTML = '';
  grid.appendChild(autoEl);
  STATE.idBarbero = null;

  barberos.forEach(b => {
    const disponible = b.estado_actual !== 'ausente';
    const estadoLabel = { libre:'Libre', en_espera:'En espera', ocupado:'Ocupado', ausente:'No disponible' }[b.estado_actual] || b.estado_actual;
    const btn = document.createElement('button');
    btn.className = `barbero-card-kiosko ${!disponible ? 'is-disabled' : ''}`;
    btn.dataset.id = b.id_empleado;
    btn.disabled = !disponible;
    btn.type = 'button';
    btn.innerHTML = `
      <div class="barbero-card-kiosko__avatar">${b.barbero_nombre.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
      <span class="barbero-card-kiosko__nombre">${esc(b.barbero_nombre)}</span>
      <span class="barbero-card-kiosko__estado estado--${b.estado_actual}">${estadoLabel}</span>`;
    grid.appendChild(btn);
  });

  grid.querySelectorAll('.barbero-card-kiosko:not(.is-disabled)').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.barbero-card-kiosko').forEach(c => c.classList.remove('is-selected'));
      card.classList.add('is-selected');
      STATE.idBarbero = card.dataset.id === 'auto' ? null : card.dataset.id;
    });
  });
}

// ─── REGISTRO ─────────────────────────────────────────────────────────────────
async function handleRegistrar() {
  if (!STATE.idServicio) { toast('Selecciona un servicio primero.'); return; }
  const btn = document.getElementById('btnRegistrar');
  btn.disabled = true; btn.textContent = 'Registrando…';

  await delay(600);

  const idCita = DEMO.registrarWalkin(STATE.nombre, STATE.telefono, STATE.idServicio, STATE.idBarbero || undefined);
  const cola   = DEMO.getColaWalkins();
  const pos    = cola.findIndex(c => c.id_cita === idCita) + 1 || cola.length;
  const item   = cola.find(c => c.id_cita === idCita);
  const espera = item?.espera_estimada_min || 0;

  document.getElementById('confirmTitulo').textContent = `¡Listo, ${STATE.nombre}!`;
  document.getElementById('confirmBarbero').textContent =
    item ? `Con ${item.barbero_nombre} · ${item.servicio_nombre}` : '';
  document.getElementById('confirmNumero').textContent = `#${pos}`;
  document.getElementById('confirmEspera').textContent =
    espera > 0 ? `Espera aproximada: ${espera} minutos` : 'Eres el próximo en turno';

  btn.disabled = false; btn.textContent = 'Registrarme →';
  goStep('confirmacion');
  loadCola();

  // Auto-reset after 20 s
  resetTimer = setTimeout(resetKiosko, 20000);
}

// ─── COLA EN VIVO ─────────────────────────────────────────────────────────────
function loadCola() {
  const servicio = document.getElementById('colaEnServicio');
  const lista    = document.getElementById('colaLista');
  const vacia    = document.getElementById('colaVacia');

  const barberos = DEMO.getPanelBarberos();
  const ocupados = barberos.filter(b => b.estado_actual === 'ocupado' && b.cliente_actual);
  servicio.innerHTML = ocupados.map(b => `
    <div class="cola-en-servicio__item">
      <span class="cola-en-servicio__badge">En corte</span>
      <span class="cola-en-servicio__cliente">${esc(b.cliente_actual)}</span>
      <span class="cola-en-servicio__barbero">con ${esc(b.barbero_nombre)}</span>
    </div>`).join('');

  const cola = DEMO.getColaWalkins();
  if (!cola.length) {
    lista.innerHTML = '';
    vacia.style.display = '';
    return;
  }
  vacia.style.display = 'none';
  lista.innerHTML = cola.map(c => `
    <div class="cola-item">
      <span class="cola-item__pos">${c.posicion_cola}</span>
      <div class="cola-item__info">
        <span class="cola-item__nombre">${esc(c.nombre_walkin)}</span>
        <span class="cola-item__servicio">${esc(c.servicio_nombre)}</span>
      </div>
      <span class="cola-item__barbero">${esc(c.barbero_nombre)}</span>
    </div>`).join('');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function toast(msg) {
  let el = document.getElementById('kToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'kToast';
    el.style.cssText = 'position:fixed;top:2rem;left:50%;transform:translateX(-50%);background:#1a1a1a;border:1px solid #b88e3c;color:#fff;padding:.7rem 1.4rem;border-radius:6px;font-size:1rem;z-index:9999;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.remove(), 3000);
}
