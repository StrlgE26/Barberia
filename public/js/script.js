/**
 * Academia De Barberia The Hipster CDMX — script.js
 * Semana 2: Conectado a Supabase
 *
 * Módulos:
 *  1. Configuración Supabase
 *  2. Cliente HTTP (fetch wrapper sobre REST API)
 *  3. Navbar
 *  4. Carrusel
 *  5. Carga dinámica de servicios
 *  6. Carga dinámica de barberos
 *  7. Modal + flujo de agendado
 *     a) Servicio → barberos disponibles
 *     b) Barbero + fecha → slots disponibles
 *     c) Validación bloqueo por teléfono
 *     d) Inserción cita + detalle_cita en Supabase
 *  8. Scroll reveal
 *  9. Utilidades
 */

'use strict';

/* ============================================================
   1. CONFIGURACIÓN SUPABASE
   ============================================================ */
const SUPABASE_URL = 'https://cqsgilldrbbigkuxjgnj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_k6gNs3jVdHzQn_eBbMzqVg_ANwgYtuN';

// ID de la sucursal actual.
// En el futuro vendrá del login del admin de sucursal.
const ID_SUCURSAL = '5d024273-df32-4d71-85a8-0e8a2b0a0e0d';

/* ============================================================
   2. CLIENTE HTTP — wrapper fetch para Supabase REST API
   Sin SDK externo. Cero dependencias.
   ============================================================ */
const db = {

  /**
   * GET — consulta con filtros opcionales
   * @param {string} tabla   - nombre de tabla o vista
   * @param {string} select  - columnas (default *)
   * @param {Object} filtros - { columna: valor } → eq filter
   */
  async get(tabla, select = '*', filtros = {}, token = null) {
    let url = `${SUPABASE_URL}/rest/v1/${tabla}?select=${encodeURIComponent(select)}`;

    Object.entries(filtros).forEach(([col, val]) => {
      url += `&${col}=eq.${encodeURIComponent(val)}`;
    });

    const res = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${token || SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error ${res.status} en ${tabla}`);
    }

    return res.json();
  },

  /**
   * POST — inserta un registro
   * @param {string}  tabla    - nombre de la tabla
   * @param {Object}  data     - datos a insertar
   * @param {boolean} retornar - true = retorna el registro creado
   */
  async post(tabla, data, retornar = false) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        retornar ? 'return=representation' : 'return=minimal',
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error ${res.status} al insertar en ${tabla}`);
    }

    return retornar ? res.json() : null;
  },

  /**
   * RPC — llama a una función PostgreSQL de Supabase
   * @param {string} funcion - nombre de la función
   * @param {Object} params  - parámetros
   */
  async rpc(funcion, params = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Error ${res.status} en RPC ${funcion}`);
    }

    return res.json();
  },
};

/* ============================================================
   3. NAVBAR — scroll + mobile toggle
   ============================================================ */
(function initNavbar() {
  const navbar = document.getElementById('navbar');
  const toggle = document.getElementById('navToggle');
  const menu   = document.getElementById('navMenu');

  if (!navbar) return;

  function handleScroll() {
    navbar.classList.toggle('nav--scrolled', window.scrollY > 50);
  }
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  if (!toggle || !menu) return;

  function openMenu() {
    menu.classList.add('is-open');
    toggle.classList.add('is-active');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    menu.classList.remove('is-open');
    toggle.classList.remove('is-active');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', () => {
    menu.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

  document.addEventListener('click', (e) => {
    if (menu.classList.contains('is-open') &&
        !menu.contains(e.target) &&
        !toggle.contains(e.target)) {
      closeMenu();
    }
  });
})();

/* ============================================================
   4. CARRUSEL — movimiento continuo, sin pausas entre slides
   ============================================================ */
function initCarousel() {
  const carousel = document.getElementById('teamCarousel');
  const track    = document.getElementById('carouselTrack');
  const btnPrev  = document.getElementById('carouselPrev');
  const btnNext  = document.getElementById('carouselNext');
  const dotsWrap = document.getElementById('carouselDots');

  if (!carousel || !track) return;

  const slides = Array.from(track.querySelectorAll('.carousel__slide'));
  if (slides.length === 0) return;

  let current      = 0;
  let autoTimer    = null;
  let isPaused     = false;
  // Velocidad del autoplay en ms. Bajo = más rápido.
  const INTERVALO  = 2800;

  function getVisible() {
    const w = carousel.offsetWidth;
    if (w >= 860) return Math.min(3, slides.length);
    if (w >= 540) return Math.min(2, slides.length);
    return 1;
  }

  function getMaxIndex() {
    return Math.max(0, slides.length - getVisible());
  }

  function buildDots() {
    if (!dotsWrap) return;
    dotsWrap.innerHTML = '';
    const pages = getMaxIndex() + 1;
    for (let i = 0; i < pages; i++) {
      const dot = document.createElement('button');
      dot.className = 'carousel__dot';
      dot.setAttribute('aria-label', `Barbero ${i + 1}`);
      dot.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(dot);
    }
    updateDots();
  }

  function updateDots() {
    if (!dotsWrap) return;
    dotsWrap.querySelectorAll('.carousel__dot').forEach((d, i) => {
      d.classList.toggle('is-active', i === current);
    });
  }

  function goTo(index) {
    const maxIndex = getMaxIndex();

    // Wrap-around: si pasa del último vuelve al primero
    if (index > maxIndex) index = 0;
    if (index < 0)        index = maxIndex;

    current = index;

    const gap    = parseInt(getComputedStyle(track).gap) || 0;
    const offset = current * ((slides[0]?.offsetWidth || 0) + gap);
    track.style.transform = `translateX(-${offset}px)`;

    if (btnPrev) btnPrev.disabled = false; // siempre activos con wrap-around
    if (btnNext) btnNext.disabled = false;

    updateDots();
  }

  /* Avanzar automáticamente — siempre hacia adelante, wrap al llegar al final */
  function tick() {
    if (!isPaused) goTo(current + 1);
  }

  function startAuto() {
    stopAuto();
    // Usar intervalo corto y constante para movimiento continuo
    autoTimer = setInterval(tick, INTERVALO);
  }

  function stopAuto() {
    clearInterval(autoTimer);
  }

  /* Pausa al hover/touch — reanuda inmediatamente al salir */
  carousel.addEventListener('mouseenter', () => { isPaused = true;  });
  carousel.addEventListener('mouseleave', () => { isPaused = false; });

  /* Controles manuales — no pausan el autoplay */
  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      goTo(current - 1);
    });
  }
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      goTo(current + 1);
    });
  }

  /* Touch / swipe */
  let touchStartX = 0;
  track.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    isPaused    = true;
  }, { passive: true });

  track.addEventListener('touchend', e => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 48) {
      goTo(diff > 0 ? current + 1 : current - 1);
    }
    isPaused = false;
  }, { passive: true });

  /* Teclado */
  carousel.setAttribute('tabindex', '0');
  carousel.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });

  /* Resize */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      goTo(0);
      buildDots();
    }, 200);
  });

  buildDots();
  goTo(0);
  startAuto();
}

/* ============================================================
   5. CARGA DINÁMICA DE SERVICIOS
   Reemplaza las tarjetas hardcodeadas con datos reales de Supabase
   ============================================================ */
/* ============================================================
   POBLAR SELECTS DEL MODAL
   Se ejecuta al abrir el modal por primera vez
   ============================================================ */
let selectsPoblados = false;

async function poblarSelectsModal() {
  if (selectsPoblados) return;

  const selectServicio = document.getElementById('fieldService');
  const selectBarbero  = document.getElementById('fieldBarber');

  // Cargar servicios y barberos en paralelo
  const [resServicios, resBarberos] = await Promise.allSettled([
    selectServicio
      ? db.get('servicio', 'id_servicio,nombre,duracion_min,precio', { activo: 'true' })
      : Promise.resolve([]),
    selectBarbero
      ? db.get('empleado', 'id_empleado,nombre,apellidos,estado_actual',
               { activo: 'true', rol: 'barbero', id_sucursal: ID_SUCURSAL })
      : Promise.resolve([]),
  ]);

  if (resServicios.status === 'fulfilled' && selectServicio) {
    const servicios = resServicios.value;
    selectServicio.innerHTML =
      '<option value="">Selecciona un servicio…</option>' +
      servicios.map(s =>
        `<option value="${s.id_servicio}"
                 data-duracion="${s.duracion_min}"
                 data-precio="${s.precio}">
           ${escapeHtml(s.nombre)} — $${formatPrecio(s.precio)}
         </option>`
      ).join('');
    if (servicios.length === 0) {
      selectServicio.innerHTML = '<option value="">Sin servicios disponibles</option>';
    }
  } else if (resServicios.status === 'rejected') {
    console.error('Error cargando servicios:', resServicios.reason);
    if (selectServicio) selectServicio.innerHTML = '<option value="">Error al cargar servicios</option>';
  }

  if (resBarberos.status === 'fulfilled' && selectBarbero) {
    const barberos = resBarberos.value;
    selectBarbero.innerHTML =
      '<option value="">Selecciona un barbero…</option>' +
      barberos.map(b =>
        `<option value="${b.id_empleado}"
                 ${b.estado_actual === 'ausente' ? 'disabled' : ''}>
           ${escapeHtml(b.nombre)} ${escapeHtml(b.apellidos || '')}
           ${b.estado_actual === 'ausente' ? '— No disponible' : ''}
         </option>`
      ).join('');
  } else if (resBarberos.status === 'rejected') {
    console.error('Error cargando barberos:', resBarberos.reason);
  }

  // Marcar como poblado solo si ambas cargas tuvieron éxito
  if (resServicios.status === 'fulfilled' && resBarberos.status === 'fulfilled') {
    selectsPoblados = true;
  }
}

async function cargarServicios() {
  const grid = document.getElementById('serviciosGrid');
  if (!grid) return;

  // Esqueleto mientras carga
  grid.innerHTML = `
    <div class="skeleton-card"></div>
    <div class="skeleton-card skeleton-card--featured"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
  `;

  try {
    const servicios = await db.get(
      'servicio',
      'id_servicio,nombre,descripcion,duracion_min,precio,categoria',
      { activo: 'true' }
    );

    if (servicios.length === 0) {
      grid.innerHTML = '<p class="empty-state">No hay servicios disponibles.</p>';
      return;
    }

    const iconos = {
      corte:       '✂',
      barba:       '▲',
      combo:       '⚡',
      tratamiento: '◆',
      color:       '★',
      diseno:      '◉',
    };

    // El más caro es el destacado
    const destacadoId = servicios
      .slice()
      .sort((a, b) => b.precio - a.precio)[0]?.id_servicio;

    grid.innerHTML = servicios.map(s => {
      const esDestacado = s.id_servicio === destacadoId;
      return `
        <article class="service-card ${esDestacado ? 'service-card--featured' : ''}"
                 data-service-id="${s.id_servicio}">
          ${esDestacado ? '<span class="service-card__badge">Más pedido</span>' : ''}
          <div class="service-card__top">
            <span class="service-card__icon" aria-hidden="true">
              ${iconos[s.categoria] || '✂'}
            </span>
            <h3 class="service-card__name">${escapeHtml(s.nombre)}</h3>
          </div>
          <p class="service-card__desc">${escapeHtml(s.descripcion || '')}</p>
          <div class="service-card__meta">
            <span class="service-card__duration" data-duration="${s.duracion_min}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span class="service-card__duration-value">${s.duracion_min}</span> min
            </span>
            <span class="service-card__price">
              $<span class="service-card__price-value">${formatPrecio(s.precio)}</span>
            </span>
          </div>
          <a href="#"
             class="btn btn--primary btn--sm js-open-booking"
             data-service-id="${s.id_servicio}"
             data-service-name="${escapeHtml(s.nombre)}"
             data-service-duration="${s.duracion_min}"
             data-service-price="${s.precio}"
             data-context="service">
            Agendar
          </a>
        </article>
      `;
    }).join('');

    registrarTriggers();
    initScrollReveal();

  } catch (err) {
    console.error('Error cargando servicios:', err);
    grid.innerHTML = '<p class="empty-state">Error al cargar servicios. Recarga la página.</p>';
  }
}

/* ============================================================
   6. CARGA DINÁMICA DE BARBEROS
   Usa la vista v_panel_barberos (estado en tiempo real incluido)
   ============================================================ */
async function cargarBarberos() {
  const track = document.getElementById('carouselTrack');
  if (!track) return;

  track.innerHTML = `
    <div class="carousel__slide">
      <div class="skeleton-barber"></div>
    </div>
  `;

  try {
    const barberos = await db.get(
      'v_panel_barberos',
      'id_empleado,barbero_nombre,barbero_apellidos,especialidad,foto_url,estado_actual,id_sucursal',
      { id_sucursal: ID_SUCURSAL }
    );

    if (barberos.length === 0) {
      track.innerHTML = '<p class="empty-state" style="padding:2rem">No hay barberos registrados.</p>';
      return;
    }

    const coloresEstado = {
      libre:     { bg: '#1a2e1a', borde: '#2d5a2d', texto: '#4ade80', label: 'Disponible' },
      en_espera: { bg: '#2e2a1a', borde: '#5a4d2d', texto: '#facc15', label: 'En espera'  },
      ocupado:   { bg: '#2e1a1a', borde: '#5a2d2d', texto: '#f87171', label: 'Ocupado'    },
      ausente:   { bg: '#1e1e1e', borde: '#333333', texto: '#9ca3af', label: 'Ausente'    },
    };

    track.innerHTML = barberos.map(b => {
      const estado = coloresEstado[b.estado_actual] || coloresEstado.libre;
      const imgUrl = b.foto_url ||
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80';

      return `
        <div class="carousel__slide">
          <article class="barber-card">
            <div class="barber-card__img-wrap">
              <img
                src="${escapeHtml(imgUrl)}"
                alt="Fotografía de ${escapeHtml(b.barbero_nombre)}"
                class="barber-card__img"
                loading="lazy"
              />
            </div>
            <div class="barber-card__body">
              <h3 class="barber-card__name">
                ${escapeHtml(b.barbero_nombre)} ${escapeHtml(b.barbero_apellidos || '')}
              </h3>
              <p class="barber-card__branch">
                ${escapeHtml(b.especialidad || 'Barbero profesional')}
              </p>
              ${estado.label}
              </span>
              <a href="#"
                 class="btn btn--outline btn--sm js-open-booking"
                 data-barber-id="${b.id_empleado}"
                 data-barber-name="${escapeHtml(b.barbero_nombre)}"
                 data-context="barber">
                Agendar con ${escapeHtml(b.barbero_nombre)}
              </a>
            </div>
          </article>
        </div>
      `;
    }).join('');

    initCarousel();
    registrarTriggers();

  } catch (err) {
    console.error('Error cargando barberos:', err);
    track.innerHTML = '<p class="empty-state" style="padding:2rem">Error al cargar el equipo.</p>';
  }
}

/* ============================================================
   7. MODAL + FLUJO COMPLETO DE AGENDADO
   ============================================================ */
(function initModal() {
  const modal    = document.getElementById('bookingModal');
  const backdrop = document.getElementById('modalBackdrop');
  const closeBtn = document.getElementById('modalClose');
  const form     = document.getElementById('bookingForm');

  if (!modal) return;

  /* Estado interno del flujo de reserva */
  const estado = {
    servicioId:       null,
    servicioNombre:   null,
    servicioDuracion: null,
    servicioPrecio:   null,
    barberoId:        null,
    barberoNombre:    null,
    slotInicio:       null,
    slotFin:          null,
  };

  const selectServicio  = document.getElementById('fieldService');
  const selectBarbero   = document.getElementById('fieldBarber');
  const fieldFecha      = document.getElementById('fieldDate');
  const contenedorSlots = document.getElementById('slotsContainer');
  const selectSlot      = document.getElementById('fieldSlot');
  const fieldTelefono   = form?.telefono;

  /* --- Validación de teléfono en tiempo real --- */
  if (fieldTelefono) {
    fieldTelefono.addEventListener('input', () => {
      const validacion = validarTelefonoFrontend(fieldTelefono.value);
      if (validacion.valido) {
        fieldTelefono.classList.remove('form-input--error');
        fieldTelefono.title = '';
      } else {
        fieldTelefono.classList.add('form-input--error');
        fieldTelefono.title = validacion.error;
      }
    });

    fieldTelefono.addEventListener('blur', () => {
      const validacion = validarTelefonoFrontend(fieldTelefono.value);
      if (!validacion.valido && fieldTelefono.value.trim()) {
        fieldTelefono.classList.add('form-input--error');
      }
    });
  }

  /* --- Paso 1: cambio de servicio → resetear lo que sigue --- */
  if (selectServicio) {
    selectServicio.addEventListener('change', () => {
      const opt = selectServicio.options[selectServicio.selectedIndex];
      estado.servicioId       = opt.value || null;
      estado.servicioDuracion = parseInt(opt.dataset.duracion) || 30;
      estado.servicioPrecio   = parseFloat(opt.dataset.precio)  || 0;
      estado.servicioNombre   = opt.text.split(' —')[0];

      // Resetear pasos dependientes
      estado.barberoId  = null;
      estado.slotInicio = null;
      if (selectBarbero)   selectBarbero.value = '';
      if (fieldFecha)      fieldFecha.value    = '';
      if (contenedorSlots) contenedorSlots.classList.add('is-hidden');
    });
  }

  /* --- Paso 2: cambio de barbero o fecha → cargar slots --- */
  async function cargarSlots() {
    if (!estado.servicioId || !selectBarbero?.value || !fieldFecha?.value) return;

    estado.barberoId    = selectBarbero.value;
    estado.barberoNombre = selectBarbero.options[selectBarbero.selectedIndex]?.text || '';

    if (contenedorSlots) contenedorSlots.classList.remove('is-hidden');

    if (selectSlot) {
      selectSlot.innerHTML = '<option value="">Cargando horarios…</option>';
      selectSlot.disabled  = true;
    }

    try {
      const slots = await db.rpc('obtener_slots_disponibles', {
        p_id_empleado:  estado.barberoId,
        p_fecha:        fieldFecha.value,
        p_duracion_min: estado.servicioDuracion,
      });

      const disponibles = slots.filter(s => s.disponible);

      if (disponibles.length === 0) {
        if (selectSlot) {
          selectSlot.innerHTML = '<option value="">Sin horarios disponibles ese día</option>';
          selectSlot.disabled  = true;
        }
        return;
      }

      if (selectSlot) {
        selectSlot.innerHTML =
          '<option value="">Selecciona un horario…</option>' +
          disponibles.map(s => `
            <option value="${s.slot_inicio}" data-fin="${s.slot_fin}">
              ${formatHora(s.slot_inicio)} – ${formatHora(s.slot_fin)}
            </option>
          `).join('');
        selectSlot.disabled = false;
      }

    } catch (err) {
      console.error('Error cargando slots:', err);
      if (selectSlot) {
        selectSlot.innerHTML = '<option value="">Error al cargar horarios</option>';
        selectSlot.disabled  = true;
      }
    }
  }

  if (selectBarbero) selectBarbero.addEventListener('change', cargarSlots);
  if (fieldFecha)    fieldFecha.addEventListener('change', cargarSlots);

  /* --- Paso 3: selección de slot → guardar en estado --- */
  if (selectSlot) {
    selectSlot.addEventListener('change', () => {
      const opt = selectSlot.options[selectSlot.selectedIndex];
      estado.slotInicio = opt.value          || null;
      estado.slotFin    = opt.dataset.fin    || null;
    });
  }

  /* --- Abrir modal --- */
  async function openModal(triggerEl) {
    // Poblar selects la primera vez que se abre
    await poblarSelectsModal();

    if (triggerEl) {
      const serviceId  = triggerEl.dataset.serviceId       || null;
      const barberId   = triggerEl.dataset.barberId        || null;
      const duracion   = triggerEl.dataset.serviceDuration || null;
      const precio     = triggerEl.dataset.servicePrice    || null;

      if (serviceId && selectServicio) {
        selectServicio.value = serviceId;
        selectServicio.dispatchEvent(new Event('change'));
      }
      if (barberId && selectBarbero) {
        // Esperar a que el select esté poblado antes de seleccionar
        selectBarbero.value = barberId;
      }
      if (duracion) estado.servicioDuracion = parseInt(duracion);
      if (precio)   estado.servicioPrecio   = parseFloat(precio);
    }

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const first = modal.querySelector('input:not([type="hidden"])');
      if (first) first.focus();
    }, 320);
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // Exponer globalmente para que registrarTriggers() los use
  window._openBookingModal  = openModal;
  window._closeBookingModal = closeModal;

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  /* --- Submit: flujo completo de inserción --- */
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validarFormulario(form))    return;
    if (!validarEstadoReserva())     return;

    const submitBtn = document.getElementById('submitBookingBtn');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Verificando…';

    const nombre   = form.nombre.value.trim();
    const telefono = limpiarTelefono(form.telefono.value);
    const email    = form.email?.value?.trim() || null;
    const fechaCita = estado.slotInicio.split('T')[0];

    try {
      /* 0. Validar formato de teléfono (frontend first) */
      const validacionFront = validarTelefonoFrontend(telefono);
      if (!validacionFront.valido) {
        showToast(validacionFront.error, 'error');
        return;
      }

      /* 0.5. Validar teléfono en backend (verifica test numbers, etc) */
      submitBtn.textContent = 'Validando teléfono…';
      const resultadoValidacion = await db.rpc('validar_telefono', {
        p_telefono: telefono,
      });

      // RPC retorna un array con {valido, error}
      const validacion = resultadoValidacion[0];
      if (!validacion.valido) {
        showToast(validacion.error || 'Teléfono inválido', 'error');
        form.telefono.classList.add('form-input--error');
        return;
      }
      form.telefono.classList.remove('form-input--error');

      /* 1. Verificar bloqueo de teléfono */
      submitBtn.textContent = 'Verificando disponibilidad…';
      const puedeReservar = await db.rpc('telefono_puede_reservar', {
        p_telefono:    telefono,
        p_id_sucursal: ID_SUCURSAL,
        p_fecha:       fechaCita,
      });

      if (!puedeReservar) {
        showToast('Este número ya tiene una cita agendada en esa fecha. Solo se permite una por día.', 'error');
        return;
      }

      submitBtn.textContent = 'Agendando…';

      /* 2. Doble verificación de disponibilidad del barbero */
      const disponible = await db.rpc('barbero_disponible', {
        p_id_empleado: estado.barberoId,
        p_inicio:      estado.slotInicio,
        p_fin:         estado.slotFin,
      });

      if (!disponible) {
        showToast('Ese horario ya no está disponible. Por favor elige otro.', 'error');
        await cargarSlots();
        return;
      }

      /* 3. Buscar o crear cliente por teléfono */
      const clienteId = await obtenerOCrearCliente(nombre, telefono, email);

      /* 4. Insertar la cita en estado pendiente_confirmacion */
      const [citaCreada] = await db.post('cita', {
        id_sucursal:       ID_SUCURSAL,
        id_empleado:       estado.barberoId,
        id_cliente:        clienteId,
        fecha_hora_inicio: estado.slotInicio,
        fecha_hora_fin:    estado.slotFin,
        origen:            'online',
        estado:            'pendiente_confirmacion',
        notas:             form.notas?.value?.trim() || null,
      }, true);

      /* 5. Insertar detalle de la cita (servicio + precio histórico) */
      await db.post('detalle_cita', {
        id_cita:         citaCreada.id_cita,
        id_servicio:     estado.servicioId,
        precio_aplicado: estado.servicioPrecio,
        orden:           1,
      });

      /* 6. Enviar email de confirmación */
      submitBtn.textContent = 'Enviando confirmación…';
      const emailResponse = await fetch('/api/enviar-confirmacion-cita', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_cita: citaCreada.id_cita,
          email_cliente: email || telefono + '@noemail.local',
        }),
      });

      if (!emailResponse.ok) {
        console.warn('Email no se envió, pero la cita fue creada:', await emailResponse.text());
      }

      showToast('✓ ¡Revisa tu email para confirmar la cita! Tienes 10 minutos.', 'success');
      form.reset();
      if (contenedorSlots) contenedorSlots.classList.add('is-hidden');
      Object.keys(estado).forEach(k => { estado[k] = null; });
      setTimeout(closeModal, 1800);

    } catch (err) {
      console.error('Error al agendar:', err);
      showToast(err.message || 'Error al agendar. Intenta de nuevo.', 'error');
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Confirmar Cita';
    }
  });

  /* --- Validaciones del formulario --- */
  function validarEstadoReserva() {
    if (!estado.servicioId) {
      showToast('Por favor selecciona un servicio.', 'error');
      return false;
    }
    if (!estado.barberoId) {
      showToast('Por favor selecciona un barbero.', 'error');
      return false;
    }
    if (!estado.slotInicio) {
      showToast('Por favor selecciona un horario disponible.', 'error');
      return false;
    }
    return true;
  }
})();

/* ============================================================
   HELPER: buscar cliente por teléfono o crear uno nuevo
   Los clientes anónimos se identifican por teléfono.
   Reutilizar si ya existe mantiene el historial del cliente.
   ============================================================ */
async function obtenerOCrearCliente(nombre, telefono, email) {
  const existentes = await db.rpc('buscar_cliente_por_telefono', { p_telefono: telefono });

  if (existentes.length > 0) {
    return existentes[0].id_cliente;
  }

  const [nuevo] = await db.post('cliente', {
    nombre,
    telefono,
    email: email || null,
    tipo:  'anonimo',
  }, true);

  return nuevo.id_cliente;
}

/* ============================================================
   7b. AUTH LANDING — Sesión de cliente (login / registro / logout)
   ============================================================ */
const sesionCliente = {
  token:   localStorage.getItem('sb_cli_token')  || null,
  usuario: JSON.parse(localStorage.getItem('sb_cli_user') || 'null'),
  nombre:  localStorage.getItem('sb_cli_nombre') || null,
};

async function loginCliente(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Credenciales incorrectas');

  sesionCliente.token   = data.access_token;
  sesionCliente.usuario = data.user;
  localStorage.setItem('sb_cli_token',   data.access_token);
  localStorage.setItem('sb_cli_refresh', data.refresh_token);
  localStorage.setItem('sb_cli_user',    JSON.stringify(data.user));

  // Intentar obtener nombre del cliente registrado
  try {
    const rows = await db.get('cliente', 'nombre', { email: data.user.email }, data.access_token);
    if (rows.length > 0) {
      sesionCliente.nombre = rows[0].nombre;
      localStorage.setItem('sb_cli_nombre', rows[0].nombre);
    }
  } catch (_) {}
}

async function registrarCliente(email, password, nombre) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: { nombre } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Error al registrar');

  if (data.access_token) {
    sesionCliente.token   = data.access_token;
    sesionCliente.usuario = data.user;
    sesionCliente.nombre  = nombre;
    localStorage.setItem('sb_cli_token',   data.access_token);
    localStorage.setItem('sb_cli_refresh', data.refresh_token);
    localStorage.setItem('sb_cli_user',    JSON.stringify(data.user));
    localStorage.setItem('sb_cli_nombre',  nombre);
  }
}

function logoutCliente() {
  sesionCliente.token   = null;
  sesionCliente.usuario = null;
  sesionCliente.nombre  = null;
  ['sb_cli_token','sb_cli_refresh','sb_cli_user','sb_cli_nombre'].forEach(k => localStorage.removeItem(k));
  actualizarNavAuth();
  showToast('Sesión cerrada.', 'success');
}

function actualizarNavAuth() {
  const accederBtn = document.getElementById('navAcceder');
  const cuentaDiv  = document.getElementById('navCuenta');
  if (sesionCliente.token) {
    if (accederBtn) accederBtn.hidden = true;
    if (cuentaDiv)  cuentaDiv.hidden  = false;
  } else {
    if (accederBtn) accederBtn.hidden = false;
    if (cuentaDiv)  cuentaDiv.hidden  = true;
  }
}

/* Modal auth */
(function initAuthModal() {
  const modal   = document.getElementById('authModal');
  if (!modal) return;

  const backdrop = document.getElementById('authModalBackdrop');
  const closeBtn = document.getElementById('authModalClose');
  const tabs     = modal.querySelectorAll('.auth-tab');

  function openAuthModal(tabName) {
    if (tabName) switchTab(tabName);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => modal.querySelector('input')?.focus(), 280);
  }

  function closeAuthModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  window._openAuthModal = openAuthModal;

  function switchTab(tabName) {
    tabs.forEach(t => {
      const active = t.dataset.tab === tabName;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active);
    });
    modal.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('is-active'));
    const panel = document.getElementById(`authPanel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    if (panel) panel.classList.add('is-active');
  }

  tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

  if (closeBtn)  closeBtn.addEventListener('click', closeAuthModal);
  if (backdrop)  backdrop.addEventListener('click', closeAuthModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeAuthModal();
  });

  // Botones "Continuar sin cuenta"
  ['authSinCuenta','regSinCuenta'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      closeAuthModal();
      // Si llegaron aquí desde "Agendar", abrir el booking directamente
      if (window._pendingBookingBtn && typeof window._openBookingModal === 'function') {
        const btn = window._pendingBookingBtn;
        window._pendingBookingBtn = null;
        window._openBookingModal(btn);
      }
    });
  });

  // Botones .js-open-auth (incluye #navAcceder)
  document.addEventListener('click', e => {
    if (e.target.closest('.js-open-auth')) openAuthModal('login');
  });

  // Login form
  document.getElementById('authLoginForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errEl    = document.getElementById('authLoginError');
    const btn      = document.getElementById('authLoginBtn');

    errEl.textContent = '';
    btn.disabled      = true;
    btn.textContent   = 'Entrando…';

    try {
      await loginCliente(email, password);

      // Detectar si es empleado (admin/barbero) → redirigir al dashboard
      try {
        const emp = await db.get(
          'empleado',
          'id_empleado,rol',
          { auth_user_id: sesionCliente.usuario.id },
          sesionCliente.token
        );
        if (emp.length > 0) {
          // Copiar tokens al sessionStorage con las claves que espera dashboard.js
          sessionStorage.setItem('sb_token',   sesionCliente.token);
          sessionStorage.setItem('sb_refresh', localStorage.getItem('sb_cli_refresh'));
          sessionStorage.setItem('sb_user',    localStorage.getItem('sb_cli_user'));
          window.location.href = './dashboard.html';
          return;
        }
      } catch (_) {}

      actualizarNavAuth();
      closeAuthModal();
      showToast(`¡Bienvenido${sesionCliente.nombre ? ', ' + sesionCliente.nombre : ''}!`, 'success');

      // Si llegaron aquí desde "Agendar", abrir el booking tras el login
      if (window._pendingBookingBtn && typeof window._openBookingModal === 'function') {
        const pendingBtn = window._pendingBookingBtn;
        window._pendingBookingBtn = null;
        window._openBookingModal(pendingBtn);
      }
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Iniciar Sesión';
    }
  });

  // Register form
  document.getElementById('authRegisterForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const nombre   = document.getElementById('regNombre').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const errEl    = document.getElementById('authRegisterError');
    const btn      = document.getElementById('authRegisterBtn');

    errEl.textContent = '';
    btn.disabled      = true;
    btn.textContent   = 'Creando cuenta…';

    try {
      await registrarCliente(email, password, nombre);
      actualizarNavAuth();
      closeAuthModal();
      showToast('¡Cuenta creada! Bienvenido.', 'success');
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Crear cuenta';
    }
  });

  // Mi cuenta dropdown toggle
  document.getElementById('navCuentaToggle')?.addEventListener('click', e => {
    e.stopPropagation();
    const dd = document.getElementById('navCuentaDropdown');
    if (dd) dd.hidden = !dd.hidden;
  });

  document.addEventListener('click', e => {
    const cuenta = document.getElementById('navCuenta');
    const dd     = document.getElementById('navCuentaDropdown');
    if (cuenta && dd && !cuenta.contains(e.target) && !dd.hidden) {
      dd.hidden = true;
    }
  });

  document.getElementById('navLogoutBtn')?.addEventListener('click', () => {
    document.getElementById('navCuentaDropdown').hidden = true;
    logoutCliente();
  });

  document.getElementById('navMisCitas')?.addEventListener('click', () => {
    document.getElementById('navCuentaDropdown').hidden = true;
    showToast('Próximamente: historial de tus citas.', 'success');
  });

  // Aplicar estado inicial de sesión
  actualizarNavAuth();
})();

/* ============================================================
   8. REGISTRAR TRIGGERS DE APERTURA DEL MODAL
   Se llama después de cada render dinámico para registrar
   los nuevos botones .js-open-booking sin duplicar listeners.
   ============================================================ */
function registrarTriggers() {
  // Clonar y reemplazar para limpiar listeners previos
  document.querySelectorAll('.js-open-booking').forEach(btn => {
    const clon = btn.cloneNode(true);
    btn.replaceWith(clon);
  });

  document.querySelectorAll('.js-open-booking').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // Si no hay sesión, sugerir login primero (puede continuar sin cuenta)
      if (!sesionCliente.token && typeof window._openAuthModal === 'function') {
        // Al hacer "Continuar sin cuenta" se abrirá el booking
        window._pendingBookingBtn = btn;
        window._openAuthModal('login');
      } else {
        window._pendingBookingBtn = null;
        if (typeof window._openBookingModal === 'function') {
          window._openBookingModal(btn);
        }
      }
    });
  });
}

/* ============================================================
   9. SCROLL REVEAL — IntersectionObserver
   ============================================================ */
function initScrollReveal() {
  const targets = document.querySelectorAll(
    '.service-card, .barber-card, .location__info, .location__map, .section-header'
  );

  if (!('IntersectionObserver' in window)) {
    targets.forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
    return;
  }

  targets.forEach((el, i) => {
    if (el.hasAttribute('data-reveal')) return;
    el.setAttribute('data-reveal', '');
    el.style.transitionDelay = `${(i % 4) * 0.08}s`;
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(el => observer.observe(el));
}

/* ============================================================
   10. SMOOTH SCROLL
   ============================================================ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const id = this.getAttribute('href');
    if (id === '#') return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY - 80,
      behavior: 'smooth',
    });
  });
});

/* ============================================================
   11. FECHA MÍNIMA EN DATEPICKER
   ============================================================ */
(function setMinDate() {
  const dateInput = document.getElementById('fieldDate');
  if (dateInput) dateInput.min = new Date().toISOString().split('T')[0];
})();

/* ============================================================
   12. AÑO EN FOOTER
   ============================================================ */
(function setYear() {
  const el = document.getElementById('currentYear');
  if (el) el.textContent = new Date().getFullYear();
})();

/* ============================================================
   UTILIDADES
   ============================================================ */

function validarFormulario(formEl) {
  let valid = true;
  formEl.querySelectorAll('[required]').forEach(field => {
    field.classList.remove('form-input--error');
    if (!field.value.trim()) {
      field.classList.add('form-input--error');
      valid = false;
    }
  });
  if (!valid) showToast('Por favor completa todos los campos requeridos.', 'error');
  return valid;
}

/* Validación de teléfono - solo dígitos, sin caracteres especiales */
function limpiarTelefono(tel) {
  return tel.trim().replace(/\s|-|\.|\(|\)/g, '');
}

/* Validación básica de teléfono en frontend */
function validarTelefonoFrontend(telefono) {
  const limpio = limpiarTelefono(telefono);

  // Validar largo
  if (limpio.length < 10 || limpio.length > 15) {
    return { valido: false, error: 'El teléfono debe tener entre 10 y 15 dígitos' };
  }

  // Validar que sean solo dígitos
  if (!/^\d+$/.test(limpio)) {
    return { valido: false, error: 'El teléfono solo puede contener números' };
  }

  // Validar que no sea número test (todos dígitos iguales)
  if (/^(\d)\1{9,}$/.test(limpio)) {
    return { valido: false, error: 'Este número de teléfono no es válido' };
  }

  return { valido: true, error: null };
}

function showToast(message, type = 'success') {
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position:      'fixed',
    bottom:        '2rem',
    left:          '50%',
    transform:     'translateX(-50%) translateY(16px)',
    background:    type === 'success' ? '#b88e3c' : '#7f1d1d',
    color:         type === 'success' ? '#0d0d0d' : '#ffffff',
    padding:       '0.85rem 1.75rem',
    borderRadius:  '6px',
    fontFamily:    "'Barlow Condensed', sans-serif",
    fontWeight:    '700',
    fontSize:      '0.92rem',
    letterSpacing: '0.06em',
    zIndex:        '9999',
    opacity:       '0',
    transition:    'opacity 0.3s ease, transform 0.3s ease',
    pointerEvents: 'none',
    whiteSpace:    'nowrap',
    boxShadow:     '0 8px 32px rgba(0,0,0,0.6)',
    maxWidth:      '90vw',
    textAlign:     'center',
  });

  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }));

  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function formatHora(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatPrecio(num) {
  return Number(num).toLocaleString('es-MX', { minimumFractionDigits: 0 });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ============================================================
   INICIALIZACIÓN — orden correcto de carga
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  // Registrar triggers estáticos (FAB, nav, hero)
  registrarTriggers();

  // Cargar servicios y barberos en paralelo desde Supabase
  await Promise.all([
    cargarServicios(),
    cargarBarberos(),
  ]);

  // Scroll reveal sobre los elementos ya renderizados
  initScrollReveal();
});
