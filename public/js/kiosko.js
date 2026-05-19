'use strict';

/* ============================================================
   1. CONFIGURACIÓN
   ============================================================ */
const SUPABASE_URL = 'https://cqsgilldrbbigkuxjgnj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_k6gNs3jVdHzQn_eBbMzqVg_ANwgYtuN';
const ID_SUCURSAL  = '5d024273-df32-4d71-85a8-0e8a2b0a0e0d';

const HDR = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

/* ============================================================
   2. CLIENTE HTTP — solo anon, sin JWT
   ============================================================ */
const db = {
  async get(ruta) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: HDR });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
    return res.json();
  },

  async rpc(fn, params = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: HDR,
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
    return res.json();
  },
};

/* ============================================================
   3. ESTADO
   ============================================================ */
const sel = {
  nombre:    '',
  telefono:  '',
  servicio:  null,  // { id_servicio, nombre, duracion_min, precio }
  barberoId: null,  // null = asignación automática
};

let ultimaCitaId = null;  // highlight en cola tras registrar
let timerVolver  = null;  // auto-reset en confirmación

/* Caché para evitar re-renders innecesarios (igual que dashboard) */
const dataCache = {
  enServicio: null,
  enEspera: null,

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
   4. NAVEGACIÓN
   ============================================================ */
function irA(paso) {
  document.querySelectorAll('.kiosko-step').forEach(el => el.classList.remove('is-active'));
  document.getElementById(`step-${paso}`).classList.add('is-active');
}

/* ============================================================
   5. PASO 3 — SERVICIOS
   ============================================================ */
async function renderServicios() {
  const grid = document.getElementById('serviciosGrid');
  grid.innerHTML = '<p class="kiosko-msg">Cargando…</p>';
  document.getElementById('btnServicioSig').disabled = true;
  sel.servicio = null;

  try {
    const lista = await db.get(
      `servicio?select=id_servicio,nombre,duracion_min,precio&activo=eq.true&order=nombre.asc`
    );
    grid.innerHTML = '';

    lista.forEach(s => {
      const card = document.createElement('button');
      card.className  = 'servicio-card';
      card.dataset.id = s.id_servicio;
      card.innerHTML  = `
        <span class="servicio-card__nombre">${s.nombre}</span>
        <span class="servicio-card__precio">$${Number(s.precio).toFixed(0)}</span>
        <span class="servicio-card__duracion">${s.duracion_min} min</span>
      `;
      card.addEventListener('click', () => {
        grid.querySelectorAll('.servicio-card').forEach(c => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        sel.servicio = s;
        document.getElementById('btnServicioSig').disabled = false;
      });
      grid.appendChild(card);
    });
  } catch {
    grid.innerHTML = `<p class="kiosko-msg kiosko-msg--error">No se pudieron cargar los servicios.</p>`;
  }
}

/* ============================================================
   6. PASO 4 — BARBEROS
   ============================================================ */
async function calcularEsperaBarbero(idEmpleado) {
  try {
    const rows = await db.get(
      `cita?select=fecha_hora_fin&id_empleado=eq.${idEmpleado}&estado=in.(pendiente,en_curso)&order=fecha_hora_fin.desc&limit=1`
    );
    if (!rows.length || !rows[0].fecha_hora_fin) return 0;
    return Math.max(0, Math.round((new Date(rows[0].fecha_hora_fin) - Date.now()) / 60000));
  } catch {
    return 0;
  }
}

async function renderBarberos() {
  const grid = document.getElementById('barberosGridKiosko');
  grid.innerHTML = '<p class="kiosko-msg">Cargando…</p>';
  sel.barberoId  = null;

  try {
    const barberos = await db.get(
      `v_panel_barberos?id_sucursal=eq.${ID_SUCURSAL}&select=id_empleado,barbero_nombre,foto_url,estado_actual`
    );
    grid.innerHTML = '';

    // Tarjeta AUTOMÁTICO — siempre primera y seleccionada por defecto
    const auto = document.createElement('button');
    auto.className = 'barbero-kiosko-card es-auto is-selected';
    auto.innerHTML = `
      <div class="barbero-kiosko-card__auto-ico">⚡</div>
      <div class="barbero-kiosko-card__info">
        <span class="barbero-kiosko-card__nombre">Automático</span>
        <span class="barbero-kiosko-card__esp">El sistema elige al barbero más rápido disponible</span>
      </div>
    `;
    auto.addEventListener('click', () => seleccionarBarbero(auto, null));
    grid.appendChild(auto);

    const ESTADO_LABEL = {
      libre:     'Disponible',
      ocupado:   'En servicio',
      en_espera: 'En espera',
      ausente:   'Ausente',
    };

    for (const b of barberos) {
      const esAusente = b.estado_actual === 'ausente';
      const espera    = !esAusente && b.estado_actual !== 'libre'
        ? await calcularEsperaBarbero(b.id_empleado)
        : 0;

      const card = document.createElement('button');
      card.className  = `barbero-kiosko-card${esAusente ? ' es-ausente' : ''}`;
      card.dataset.id = b.id_empleado;
      if (esAusente) card.disabled = true;

      const fotoHtml = b.foto_url
        ? `<img class="barbero-kiosko-card__foto" src="${b.foto_url}" alt="${b.barbero_nombre}" loading="lazy">`
        : `<div class="barbero-kiosko-card__foto barbero-kiosko-card__foto--inicial">${b.barbero_nombre[0].toUpperCase()}</div>`;

      card.innerHTML = `
        ${fotoHtml}
        <span class="barbero-kiosko-card__nombre">${b.barbero_nombre}</span>
        <span class="barbero-kiosko-card__badge ${b.estado_actual}">${ESTADO_LABEL[b.estado_actual] ?? b.estado_actual}</span>
        ${espera > 0 ? `<span class="barbero-kiosko-card__espera">~${espera} min de espera</span>` : ''}
      `;
      if (!esAusente) card.addEventListener('click', () => seleccionarBarbero(card, b.id_empleado));
      grid.appendChild(card);
    }
  } catch {
    grid.innerHTML = `<p class="kiosko-msg kiosko-msg--error">No se pudieron cargar los barberos.</p>`;
  }
}

function seleccionarBarbero(card, id) {
  document.querySelectorAll('.barbero-kiosko-card').forEach(c => c.classList.remove('is-selected'));
  card.classList.add('is-selected');
  sel.barberoId = id;
}

/* ============================================================
   7. REGISTRAR
   ============================================================ */
async function registrar() {
  const btn = document.getElementById('btnRegistrar');
  btn.disabled    = true;
  btn.textContent = 'Registrando…';

  try {
    const params = {
      p_id_sucursal: ID_SUCURSAL,
      p_nombre:      sel.nombre,
      p_telefono:    sel.telefono,
      p_id_servicio: sel.servicio.id_servicio,
    };
    if (sel.barberoId) params.p_id_empleado = sel.barberoId;

    const idCita = await db.rpc('registrar_walkin', params);
    ultimaCitaId  = idCita;

    await mostrarConfirmacion(idCita);
    await actualizarCola();
    irA('confirmacion');

    clearTimeout(timerVolver);
    timerVolver = setTimeout(resetKiosko, 30000);
  } catch (e) {
    alert(`No se pudo registrar: ${e.message}`);
    btn.disabled    = false;
    btn.textContent = 'Registrarme →';
  }
}

async function mostrarConfirmacion(idCita) {
  const primerNombre = sel.nombre.split(' ')[0];
  document.getElementById('confirmTitulo').textContent = `¡Listo, ${primerNombre}!`;

  try {
    const [citaRows, colaTodo] = await Promise.all([
      db.get(`v_cola_walkins?id_cita=eq.${idCita}&select=barbero_nombre,espera_estimada_min`),
      db.get(`v_cola_walkins?id_sucursal=eq.${ID_SUCURSAL}&select=id_cita&order=posicion_cola.asc`),
    ]);

    if (citaRows.length) {
      const cita = citaRows[0];
      document.getElementById('confirmBarbero').textContent = `Con ${cita.barbero_nombre}`;

      const pos = colaTodo.findIndex(c => c.id_cita === idCita) + 1;
      document.getElementById('confirmNumero').textContent = `#${pos || 1}`;

      const espera = Math.round(cita.espera_estimada_min || 0);
      document.getElementById('confirmEspera').textContent = espera > 0
        ? `Tiempo estimado de espera: ~${espera} min`
        : '¡Eres el primero! Pasa de inmediato.';
    }
  } catch {
    document.getElementById('confirmNumero').textContent = '#1';
    document.getElementById('confirmBarbero').textContent = '';
    document.getElementById('confirmEspera').textContent = '';
  }
}

/* ============================================================
   8. COLA EN VIVO (con caché inteligente, igual que dashboard)
   ============================================================ */
async function actualizarCola() {
  try {
    const [enServicio, enEspera] = await Promise.all([
      db.get(
        `v_panel_barberos?id_sucursal=eq.${ID_SUCURSAL}&cita_estado=eq.en_curso` +
        `&select=barbero_nombre,nombre_walkin,cliente_nombre,cliente_apellido`
      ),
      db.get(
        `v_cola_walkins?id_sucursal=eq.${ID_SUCURSAL}` +
        `&select=id_cita,nombre_walkin,barbero_nombre,espera_estimada_min&order=posicion_cola.asc`
      ),
    ]);

    // Solo actualizar DOM si los datos realmente cambiaron
    const serviciosCambiaron = dataCache.changed('enServicio', enServicio);
    const esperaCambio = dataCache.changed('enEspera', enEspera);

    if (serviciosCambiaron) {
      renderEnServicio(enServicio);
    }

    if (esperaCambio) {
      renderEspera(enEspera);
    }

    // Mostrar/ocultar mensaje de cola vacía
    if (serviciosCambiaron || esperaCambio) {
      const vaciaEl = document.getElementById('colaVacia');
      vaciaEl.style.display = enEspera.length ? 'none' : '';
    }
  } catch { /* no interrumpir al cliente */ }
}

function renderEnServicio(lista) {
  document.getElementById('colaEnServicio').innerHTML = lista.map(b => {
    const nombre = b.nombre_walkin
      || `${b.cliente_nombre || ''} ${b.cliente_apellido || ''}`.trim()
      || 'Cliente';
    return `
      <div class="cola-activo">
        <span class="cola-activo__dot"></span>
        <div class="cola-activo__info">
          <span class="cola-activo__nombre">${nombre}</span>
          <span class="cola-activo__barbero">con ${b.barbero_nombre}</span>
        </div>
      </div>`;
  }).join('');
}

function renderEspera(lista) {
  document.getElementById('colaLista').innerHTML = lista.map((c, i) => {
    const esNuevo = c.id_cita === ultimaCitaId;
    const espera  = c.espera_estimada_min > 0
      ? `<span class="cola-item__espera">~${Math.round(c.espera_estimada_min)} min</span>`
      : '';
    return `
      <div class="cola-item${esNuevo ? ' es-nuevo' : ''}">
        <span class="cola-item__num">#${i + 1}</span>
        <div class="cola-item__info">
          <span class="cola-item__nombre">${c.nombre_walkin || 'Cliente'}</span>
          <span class="cola-item__barbero">con ${c.barbero_nombre}</span>
        </div>
        ${espera}
      </div>`;
  }).join('');
}

/* ============================================================
   9. RESET
   ============================================================ */
function resetKiosko() {
  clearTimeout(timerVolver);

  sel.nombre    = '';
  sel.telefono  = '';
  sel.servicio  = null;
  sel.barberoId = null;
  ultimaCitaId  = null;

  document.getElementById('inputNombre').value           = '';
  document.getElementById('inputTelefono').value         = '';
  document.getElementById('datosError').textContent      = '';
  document.getElementById('btnServicioSig').disabled     = true;
  document.getElementById('serviciosGrid').innerHTML     = '';
  document.getElementById('barberosGridKiosko').innerHTML = '';

  const btn = document.getElementById('btnRegistrar');
  btn.disabled    = false;
  btn.textContent = 'Registrarme →';

  irA('bienvenida');
}

/* ============================================================
   10. EVENTOS
   ============================================================ */
function initEventos() {
  // Bienvenida → Datos
  document.getElementById('btnComenzar').addEventListener('click', () => irA('datos'));

  // Datos → Servicio
  document.getElementById('btnDatosSig').addEventListener('click', () => {
    const nombre = document.getElementById('inputNombre').value.trim();
    const tel    = document.getElementById('inputTelefono').value.trim().replace(/\D/g, '');
    const errEl  = document.getElementById('datosError');

    if (!nombre)        { errEl.textContent = 'Por favor escribe tu nombre.'; return; }
    if (tel.length < 8) { errEl.textContent = 'Escribe un número de teléfono válido.'; return; }
    errEl.textContent = '';

    sel.nombre   = nombre;
    sel.telefono = tel;
    renderServicios();
    irA('servicio');
  });

  // Servicio → Barbero
  document.getElementById('btnServicioSig').addEventListener('click', () => {
    renderBarberos();
    irA('barbero');
  });

  // Registrar
  document.getElementById('btnRegistrar').addEventListener('click', registrar);

  // Volver al inicio
  document.getElementById('btnVolver').addEventListener('click', resetKiosko);

  // Botones ← Regresar (data-back="paso")
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const destino = btn.dataset.back;
      if (destino === 'datos')    sel.servicio  = null;
      if (destino === 'servicio') sel.barberoId = null;
      irA(destino);
    });
  });

  // Cancelar auto-reset si el cliente toca la pantalla de confirmación
  document.getElementById('step-confirmacion').addEventListener('pointerdown', () => {
    clearTimeout(timerVolver);
  });
}

/* ============================================================
   11. INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initEventos();
  actualizarCola();

  // Sincronizar polling cada 5s en múltiplos del epoch (0, 5, 10, 15...)
  // Así dashboard y kiosko polleen al mismo tiempo
  const ahora = Date.now();
  const msCiclo = 5000;
  const msHastaSiguiente = msCiclo - (ahora % msCiclo);
  setTimeout(() => {
    setInterval(actualizarCola, msCiclo);
  }, msHastaSiguiente);
});
