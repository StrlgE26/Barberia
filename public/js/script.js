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
    // Fetch barberos + mapa de sucursales en paralelo (badge "ubicación")
    const [barberos, sucursales] = await Promise.all([
      db.get(
        'v_panel_barberos',
        'id_empleado,barbero_nombre,barbero_apellidos,especialidad,foto_url,estado_actual,id_sucursal',
        { id_sucursal: ID_SUCURSAL }
      ),
      db.get('sucursal', 'id_sucursal,nombre', { activa: 'true' }),
    ]);

    if (barberos.length === 0) {
      track.innerHTML = '<p class="empty-state" style="padding:2rem">No hay barberos registrados.</p>';
      return;
    }

    const sucursalMap = Object.fromEntries(
      (sucursales || []).map(s => [s.id_sucursal, s.nombre])
    );

    // SVG inline para avatar por defecto (cuando no hay foto_url)
    const defaultAvatarSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
           aria-hidden="true" class="barber-card__avatar-icon">
        <circle cx="12" cy="9" r="3.4"/>
        <path d="M5 19c1.5-3.2 4.2-4.8 7-4.8s5.5 1.6 7 4.8"/>
      </svg>
    `;

    // SVG pin para la badge de sucursal
    const pinSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           aria-hidden="true" width="11" height="11">
        <path d="M12 22s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z"/>
        <circle cx="12" cy="10" r="2.5"/>
      </svg>
    `;

    track.innerHTML = barberos.map(b => {
      const nombreCompleto = `${b.barbero_nombre || ''} ${b.barbero_apellidos || ''}`.trim();
      const sucursalNombre = sucursalMap[b.id_sucursal] || '';
      const avatarContent  = b.foto_url
        ? `<img src="${escapeHtml(b.foto_url)}" alt="${escapeHtml(nombreCompleto)}" loading="lazy"/>`
        : defaultAvatarSvg;

      return `
        <div class="carousel__slide">
          <article class="barber-card barber-card--minimal js-open-booking"
                   role="button" tabindex="0"
                   data-barber-id="${b.id_empleado}"
                   data-barber-name="${escapeHtml(b.barbero_nombre)}"
                   data-context="barber"
                   aria-label="Agendar con ${escapeHtml(nombreCompleto)}">
            <div class="barber-card__avatar">${avatarContent}</div>
            <h3 class="barber-card__name">${escapeHtml(nombreCompleto)}</h3>
            <p class="barber-card__branch">${escapeHtml(b.especialidad || 'Barbero profesional')}</p>
            <div class="barber-card__stars" aria-hidden="true">
              <span>★</span><span>★</span><span>★</span><span>★</span><span>★</span>
            </div>
            ${sucursalNombre ? `
              <div class="barber-card__sucursal">
                ${pinSvg}
                <span>${escapeHtml(sucursalNombre)}</span>
              </div>` : ''}
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
   6b. SECCIÓN UBICACIÓN — multi-sucursal dinámica
   Renderiza N bloques (info + mapa) desde la tabla `sucursal`.
   Con 1 sucursal se ve igual que el diseño original.
   Con N se apilan verticalmente manteniendo el mismo estilo.
   ============================================================ */
async function cargarSucursalesUI() {
  const container = document.getElementById('sucursalesContainer');
  const titleEl   = document.getElementById('sucursalesTitle');
  if (!container) return;

  try {
    const sucursales = await db.get(
      'sucursal',
      'id_sucursal,nombre,direccion,telefono,horario_apertura,horario_cierre',
      { activa: 'true' }
    );

    if (!sucursales.length) {
      container.innerHTML = '<p class="empty-state" style="padding:2rem">Próximamente más sucursales.</p>';
      if (titleEl) titleEl.innerHTML = 'Nuestras<br><em>sucursales.</em>';
      return;
    }

    // Título: con 1 sucursal usamos el nombre de la zona (parte 2 de la
    // dirección, ej. "Riobamba 690, Lindavista, ..." → "Lindavista").
    // Con N usamos un título genérico que cubre cualquier cantidad.
    if (titleEl) {
      if (sucursales.length === 1) {
        const zona = extraerZona(sucursales[0].direccion) || sucursales[0].nombre;
        titleEl.innerHTML = `Visítanos en<br><em>${escapeHtml(zona)}.</em>`;
      } else {
        titleEl.innerHTML = 'Nuestras<br><em>sucursales.</em>';
      }
    }

    const showName = sucursales.length > 1;
    container.innerHTML = sucursales.map(s => renderSucursalCard(s, showName)).join('');

    // Registrar el botón "Agendar Cita Aquí" de cada sucursal
    registrarTriggers();
  } catch (err) {
    console.error('Error cargando sucursales:', err);
    container.innerHTML = '<p class="empty-state" style="padding:2rem">Error al cargar las sucursales.</p>';
  }
}

/* Renderiza un bloque de sucursal con el mismo layout 2-col de antes */
function renderSucursalCard(s, showName) {
  const tel       = (s.telefono || '').trim();
  const telDigits = tel.replace(/\D/g, '');
  const horarioStr = (s.horario_apertura && s.horario_cierre)
    ? `Lunes – Domingo · ${trimSeconds(s.horario_apertura)} – ${trimSeconds(s.horario_cierre)}`
    : 'Lunes – Domingo · Siempre abierto';
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(s.direccion || s.nombre)}&output=embed`;

  return `
    <div class="location__grid sucursal-card">

      <div class="location__info">

        ${showName ? `<h3 class="sucursal-card__name">${escapeHtml(s.nombre || '')}</h3>` : ''}

        <ul class="location__details">
          <li class="location__detail">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <div>
              <strong>Dirección</strong>
              <span>${escapeHtml(s.direccion || '—')}</span>
            </div>
          </li>
          <li class="location__detail">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <div>
              <strong>Horario</strong>
              <span>${escapeHtml(horarioStr)}</span>
            </div>
          </li>
          ${tel ? `
          <li class="location__detail">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.82 19.79 19.79 0 01.5 1.18 2 2 0 012.68 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.45 7.35a16 16 0 006.18 6.18l1.71-1.48a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z"/></svg>
            <div>
              <strong>Teléfono</strong>
              <a href="tel:${escapeHtml(tel)}">${escapeHtml(tel)}</a>
            </div>
          </li>
          <li class="location__detail">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            <div>
              <strong>WhatsApp</strong>
              <a href="https://wa.me/52${escapeHtml(telDigits)}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>
            </div>
          </li>` : ''}
        </ul>

        <a href="#"
           class="btn btn--primary js-open-booking"
           data-context="location"
           data-sucursal-id="${s.id_sucursal}">
          Agendar Cita Aquí
        </a>

      </div>

      <div class="location__map">
        <iframe
          src="${mapSrc}"
          width="100%"
          height="100%"
          style="border:0;"
          allowfullscreen=""
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          title="Ubicación ${escapeHtml(s.nombre || '')}"
        ></iframe>
      </div>

    </div>
  `;
}

/* Helpers — usados solo por la sección de sucursales */
function extraerZona(direccion) {
  if (!direccion) return '';
  const parts = direccion.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : (parts[0] || '');
}
function trimSeconds(timeStr) {
  // "09:00:00" → "09:00"
  return String(timeStr || '').slice(0, 5);
}

/* ============================================================
   7. MODAL + FLUJO COMPLETO DE AGENDADO
   ============================================================ */
(function initWizardModal() {
  const modal    = document.getElementById('bookingModal');
  const backdrop = document.getElementById('modalBackdrop');
  const closeBtn = document.getElementById('modalClose');
  const form     = document.getElementById('bookingForm');
  if (!modal || !form) return;

  /* ---------- Refs DOM ---------- */
  const selectSucursal = document.getElementById('fieldSucursal');
  const cardsGrid      = document.getElementById('serviceCardsGrid');
  const step1Total     = document.getElementById('step1Total');
  const selectBarbero  = document.getElementById('fieldBarber');
  const fieldFecha     = document.getElementById('fieldDate');
  const slotsContainer = document.getElementById('slotsContainer');
  const slotGrid       = document.getElementById('slotPillGrid');
  const slotsEmpty     = document.getElementById('slotsEmpty');
  const summaryCard    = document.getElementById('summaryCard');
  const loggedBanner   = document.getElementById('loggedBanner');
  const loggedName     = document.getElementById('loggedName');
  const emailAuthAlert = document.getElementById('emailAuthAlert');
  const emailAuthLogin = document.getElementById('emailAuthLogin');
  const guestFields    = document.getElementById('guestFields');
  const fName          = document.getElementById('fieldName');
  const fApellidos     = document.getElementById('fieldApellidos');
  const fPhone         = document.getElementById('fieldPhone');
  const fEmail         = document.getElementById('fieldEmail');
  const fNotas         = document.getElementById('fieldNotas');
  const prevBtn        = document.getElementById('wizardPrev');
  const nextBtn        = document.getElementById('wizardNext');
  const submitBtn      = document.getElementById('submitBookingBtn');
  const stepIndicators = modal.querySelectorAll('.wizard-step[data-step]');
  const panels         = modal.querySelectorAll('.wizard-panel[data-panel]');

  /* ---------- Estado del wizard ---------- */
  const wizard = {
    paso: 1,
    sucursalId: null,
    servicios: [],           // [{id, nombre, precio, duracion}]
    barberoId: null,
    barberoNombre: null,
    slotInicio: null,
    slotFin: null,
    clienteLogueado: null,   // row de cliente si hay sesión Auth activa
    _preBarber: null,        // pre-selección via data-barber-id en trigger
  };

  let sucursalesCargadas = false;
  let serviciosCache     = [];

  const sumDuracion = () => wizard.servicios.reduce((s, x) => s + x.duracion, 0);
  const sumPrecio   = () => wizard.servicios.reduce((s, x) => s + x.precio,   0);

  /* ---------- Navegación entre pasos ---------- */
  function irAPaso(n) {
    wizard.paso = n;
    panels.forEach(p => {
      const isActive = parseInt(p.dataset.panel) === n;
      p.classList.toggle('is-active', isActive);
      p.hidden = !isActive;
    });
    stepIndicators.forEach(s => {
      const step = parseInt(s.dataset.step);
      s.classList.toggle('is-active', step === n);
      s.classList.toggle('is-done',   step < n);
    });
    prevBtn.hidden   = n === 1;
    nextBtn.hidden   = n === 3;
    submitBtn.hidden = n !== 3;
    if (n === 3) renderResumen();
  }

  /* ---------- Cargar sucursales (Step 1) ---------- */
  async function cargarSucursales() {
    if (sucursalesCargadas) return;
    try {
      const sucs = await db.get('sucursal', 'id_sucursal,nombre,direccion', { activa: 'true' });
      selectSucursal.innerHTML = '<option value="">Selecciona una sucursal…</option>' +
        sucs.map(s => `<option value="${s.id_sucursal}">${escapeHtml(s.nombre)}</option>`).join('');
      sucursalesCargadas = true;
      // Auto-seleccionar si solo hay una sucursal activa
      if (sucs.length === 1) {
        selectSucursal.value = sucs[0].id_sucursal;
        wizard.sucursalId    = sucs[0].id_sucursal;
      }
    } catch (err) {
      console.error('Error cargando sucursales:', err);
      selectSucursal.innerHTML = '<option value="">Error al cargar sucursales</option>';
    }
  }

  selectSucursal.addEventListener('change', () => {
    wizard.sucursalId = selectSucursal.value || null;
    // Reset Step 2 (barbero pertenece a una sucursal)
    wizard.barberoId  = null;
    wizard.slotInicio = null;
    wizard.slotFin    = null;
    selectBarbero.value = '';
    if (fieldFecha) fieldFecha.value = '';
    slotsContainer.classList.add('is-hidden');
  });

  /* ---------- Cargar y renderizar servicios (Step 1) ---------- */
  async function asegurarServicios() {
    if (serviciosCache.length) return;
    serviciosCache = await db.get('servicio',
      'id_servicio,nombre,duracion_min,precio,categoria',
      { activo: 'true' });
  }

  function renderServiceCards() {
    cardsGrid.innerHTML = serviciosCache.map(s => `
      <button type="button" class="service-card" role="checkbox" aria-checked="false"
              data-id="${s.id_servicio}"
              data-duracion="${s.duracion_min}"
              data-precio="${s.precio}">
        <span class="service-card__nombre">${escapeHtml(s.nombre)}</span>
        <span class="service-card__meta">$${formatPrecio(s.precio)} · ${s.duracion_min}min</span>
      </button>
    `).join('');
    cardsGrid.querySelectorAll('.service-card').forEach(btn => {
      btn.addEventListener('click', () => toggleServiceCard(btn));
    });
    actualizarStep1Total();
  }

  function toggleServiceCard(btn) {
    const id = btn.dataset.id;
    const idx = wizard.servicios.findIndex(x => x.id === id);
    if (idx >= 0) {
      wizard.servicios.splice(idx, 1);
      btn.classList.remove('is-selected');
      btn.setAttribute('aria-checked', 'false');
    } else {
      wizard.servicios.push({
        id,
        nombre:   btn.querySelector('.service-card__nombre').textContent,
        precio:   parseFloat(btn.dataset.precio),
        duracion: parseInt(btn.dataset.duracion),
      });
      btn.classList.add('is-selected');
      btn.setAttribute('aria-checked', 'true');
    }
    // Cambiar servicios invalida los slots ya elegidos
    wizard.slotInicio = null; wizard.slotFin = null;
    slotsContainer.classList.add('is-hidden');
    actualizarStep1Total();
  }

  function actualizarStep1Total() {
    if (!wizard.servicios.length) { step1Total.hidden = true; return; }
    step1Total.hidden = false;
    const n = wizard.servicios.length;
    step1Total.textContent =
      `${n} servicio${n > 1 ? 's' : ''} · ${sumDuracion()}min · $${formatPrecio(sumPrecio())}`;
  }

  /* ---------- Cargar barberos por sucursal (Step 2) ---------- */
  async function cargarBarberosPorSucursal() {
    if (!wizard.sucursalId) {
      selectBarbero.innerHTML = '<option value="">Primero elige una sucursal</option>';
      return;
    }
    selectBarbero.innerHTML = '<option value="">Cargando…</option>';
    try {
      const barbs = await db.get('empleado',
        'id_empleado,nombre,apellidos,estado_actual,especialidad',
        { activo: 'true', rol: 'barbero', id_sucursal: wizard.sucursalId });
      if (!barbs.length) {
        selectBarbero.innerHTML = '<option value="">Sin barberos en esta sucursal</option>';
        return;
      }
      selectBarbero.innerHTML = '<option value="">Selecciona un barbero…</option>' +
        barbs.map(b => {
          const fullName = `${b.nombre || ''} ${b.apellidos || ''}`.trim();
          const label    = b.especialidad ? `${fullName} — ${b.especialidad}` : fullName;
          return `
            <option value="${b.id_empleado}"
                    data-nombre="${escapeHtml(fullName)}"
                    ${b.estado_actual === 'ausente' ? 'disabled' : ''}>
              ${escapeHtml(label)}
            </option>`;
        }).join('');

      // Aplicar pre-selección si vino desde un trigger con data-barber-id
      if (wizard._preBarber) {
        selectBarbero.value = wizard._preBarber;
        wizard._preBarber   = null;
        selectBarbero.dispatchEvent(new Event('change'));
      }
    } catch (err) {
      console.error('Error cargando barberos:', err);
      selectBarbero.innerHTML = '<option value="">Error al cargar barberos</option>';
    }
  }

  selectBarbero.addEventListener('change', () => {
    wizard.barberoId    = selectBarbero.value || null;
    const opt           = selectBarbero.options[selectBarbero.selectedIndex];
    wizard.barberoNombre = opt?.dataset?.nombre || opt?.text || '';
    wizard.slotInicio = null; wizard.slotFin = null;
    cargarSlots();
  });
  fieldFecha.addEventListener('change', () => {
    wizard.slotInicio = null; wizard.slotFin = null;
    cargarSlots();
  });

  /* ---------- Slots (Step 2) ---------- */
  async function cargarSlots() {
    if (!wizard.barberoId || !fieldFecha.value || !wizard.servicios.length) {
      slotsContainer.classList.add('is-hidden');
      return;
    }
    slotsContainer.classList.remove('is-hidden');
    slotsEmpty.classList.add('is-hidden');
    slotGrid.innerHTML = '<p class="wizard-empty-slots">Cargando…</p>';
    try {
      const slots = await db.rpc('obtener_slots_disponibles', {
        p_id_empleado:  wizard.barberoId,
        p_fecha:        fieldFecha.value,
        p_duracion_min: sumDuracion(),
      });
      const dispo = slots.filter(s => s.disponible);
      if (!dispo.length) {
        slotGrid.innerHTML = '';
        slotsEmpty.classList.remove('is-hidden');
        return;
      }
      slotGrid.innerHTML = dispo.map(s => `
        <button type="button" class="slot-pill" role="radio" aria-checked="false"
                data-inicio="${s.slot_inicio}" data-fin="${s.slot_fin}">
          ${formatHora(s.slot_inicio)}
        </button>
      `).join('');
      slotGrid.querySelectorAll('.slot-pill').forEach(b => {
        b.addEventListener('click', () => seleccionarSlot(b));
      });
    } catch (err) {
      console.error('Error cargando slots:', err);
      slotGrid.innerHTML = '<p class="wizard-empty-slots">Error al cargar horarios.</p>';
    }
  }

  function seleccionarSlot(btn) {
    slotGrid.querySelectorAll('.slot-pill').forEach(b => {
      b.classList.remove('is-selected');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('is-selected');
    btn.setAttribute('aria-checked', 'true');
    wizard.slotInicio = btn.dataset.inicio;
    wizard.slotFin    = btn.dataset.fin;
  }

  /* ---------- Validación por paso ---------- */
  function validarPaso(n) {
    if (n === 1) {
      if (!wizard.sucursalId)         return 'Selecciona una sucursal.';
      if (!wizard.servicios.length)   return 'Selecciona al menos un servicio.';
    }
    if (n === 2) {
      if (!wizard.barberoId)          return 'Selecciona un barbero.';
      if (!fieldFecha.value)          return 'Selecciona una fecha.';
      if (!wizard.slotInicio)         return 'Selecciona un horario disponible.';
    }
    return null;
  }

  prevBtn.addEventListener('click', () => irAPaso(Math.max(1, wizard.paso - 1)));
  nextBtn.addEventListener('click', async () => {
    const err = validarPaso(wizard.paso);
    if (err) { showToast(err, 'error'); return; }
    if (wizard.paso === 1) {
      await cargarBarberosPorSucursal();
    }
    irAPaso(wizard.paso + 1);
  });

  /* ---------- Resumen del Step 3 ---------- */
  function renderResumen() {
    const servs = wizard.servicios
      .map(s => `<li>${escapeHtml(s.nombre)} <span style="color:var(--clr-white-40)">— $${formatPrecio(s.precio)} · ${s.duracion}min</span></li>`)
      .join('');
    const fecha = wizard.slotInicio ? wizard.slotInicio.split('T')[0] : '';
    const ini   = wizard.slotInicio ? formatHora(wizard.slotInicio) : '';
    const fin   = wizard.slotFin    ? formatHora(wizard.slotFin)    : '';

    summaryCard.innerHTML = `
      <div class="summary-card__row"><span>Barbero:</span> <strong>${escapeHtml(wizard.barberoNombre)}</strong></div>
      <div class="summary-card__row"><span>Servicios:</span></div>
      <ul style="margin:0 0 0 1.1rem; padding:0; font-size:0.85rem; line-height:1.6;">${servs}</ul>
      <div class="summary-card__row"><span>Horario:</span> <strong>${fecha} · ${ini} – ${fin}</strong></div>
      <div class="summary-card__total">Total: <strong>$${formatPrecio(sumPrecio())}</strong></div>
    `;
    aplicarSesionCliente();
  }

  /* ---------- Cliente logueado: detectar y auto-fill ---------- */
  async function detectarSesionCliente() {
    wizard.clienteLogueado = null;
    const tok = localStorage.getItem('sb_cli_token');
    const usrRaw = localStorage.getItem('sb_cli_user');
    if (!tok || !usrRaw) return;
    let usr;
    try { usr = JSON.parse(usrRaw); } catch { return; }
    if (!usr?.id) return;
    try {
      // Pasamos el token del cliente para que RLS (cliente_propio_perfil)
      // permita leer su propio row.
      const rows = await db.get('cliente',
        'id_cliente,nombre,apellido,telefono,email,tipo,auth_user_id',
        { auth_user_id: usr.id },
        tok);
      if (rows.length) wizard.clienteLogueado = rows[0];
    } catch (err) {
      console.warn('No se pudo leer cliente logueado:', err);
    }
  }

  function aplicarSesionCliente() {
    const logged = wizard.clienteLogueado;
    if (logged) {
      loggedBanner.classList.remove('is-hidden');
      loggedName.textContent =
        (logged.nombre || '') + (logged.apellido ? ' ' + logged.apellido : '');
      guestFields.style.display = 'none';
      fName.value      = logged.nombre   || '';
      fApellidos.value = logged.apellido || '';
      fPhone.value     = logged.telefono || '';
      fEmail.value     = logged.email    || '';
    } else {
      loggedBanner.classList.add('is-hidden');
      guestFields.style.display = '';
    }
  }

  // Click en "Inicia sesión" del alert de email-con-Auth
  if (emailAuthLogin) {
    emailAuthLogin.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window._openAuthModal === 'function') {
        window._openAuthModal('login');
      }
    });
  }

  /* ---------- Validación de teléfono en tiempo real ---------- */
  fPhone.addEventListener('input', () => {
    const v = validarTelefonoFrontend(fPhone.value);
    fPhone.classList.toggle('form-input--error', !v.valido && fPhone.value.trim().length > 0);
    fPhone.title = v.valido ? '' : v.error;
  });

  /* ---------- Abrir / cerrar modal ---------- */
  async function openModal(triggerEl) {
    await Promise.all([cargarSucursales(), asegurarServicios()]);
    renderServiceCards();

    // Pre-selección desde triggers de la página
    if (triggerEl) {
      const serviceId = triggerEl.dataset.serviceId || null;
      const barberId  = triggerEl.dataset.barberId  || null;
      if (serviceId) {
        const card = cardsGrid.querySelector(`.service-card[data-id="${serviceId}"]`);
        if (card && !card.classList.contains('is-selected')) toggleServiceCard(card);
      }
      if (barberId) wizard._preBarber = barberId;
    }

    await detectarSesionCliente();

    irAPaso(1);

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    resetWizard();
  }

  function resetWizard() {
    wizard.paso = 1;
    wizard.sucursalId = null;
    wizard.servicios = [];
    wizard.barberoId = null;
    wizard.barberoNombre = null;
    wizard.slotInicio = null;
    wizard.slotFin = null;
    wizard._preBarber = null;
    selectSucursal.value = '';
    selectBarbero.value  = '';
    if (fieldFecha) fieldFecha.value = '';
    if (cardsGrid)  cardsGrid.innerHTML = '';
    if (slotGrid)   slotGrid.innerHTML  = '';
    slotsContainer.classList.add('is-hidden');
    fName.value = fApellidos.value = fPhone.value = fEmail.value = fNotas.value = '';
    emailAuthAlert.classList.add('is-hidden');
    form.reset();
  }

  window._openBookingModal  = openModal;
  window._closeBookingModal = closeModal;

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  /* ---------- Submit final (Paso 3) ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (wizard.paso !== 3) return;

    const logged = wizard.clienteLogueado;
    const nombre   = (logged ? logged.nombre   : fName.value).trim();
    const apellido = (logged ? logged.apellido : fApellidos.value).trim();
    const telefono = limpiarTelefono(logged ? logged.telefono : fPhone.value);
    const email    = (logged ? logged.email    : fEmail.value).trim().toLowerCase();
    const notas    = fNotas.value.trim() || null;

    // Validación de campos obligatorios
    if (!nombre || !apellido || !telefono || !email) {
      showToast('Completa nombre, apellidos, teléfono y email.', 'error');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      showToast('Email inválido.', 'error');
      fEmail.classList.add('form-input--error');
      return;
    }

    submitBtn.disabled    = true;
    submitBtn.textContent = 'Verificando…';

    try {
      // 0. Teléfono (formato + backend)
      const fv = validarTelefonoFrontend(telefono);
      if (!fv.valido) { showToast(fv.error, 'error'); return; }
      const vb = await db.rpc('validar_telefono', { p_telefono: telefono });
      if (!vb[0]?.valido) {
        showToast(vb[0]?.error || 'Teléfono inválido', 'error');
        fPhone.classList.add('form-input--error');
        return;
      }
      fPhone.classList.remove('form-input--error');

      // 1. Anti-spam (bloqueo de teléfono por día por sucursal)
      submitBtn.textContent = 'Verificando disponibilidad…';
      const fechaCita = wizard.slotInicio.split('T')[0];
      const puede = await db.rpc('telefono_puede_reservar', {
        p_telefono:    telefono,
        p_id_sucursal: wizard.sucursalId,
        p_fecha:       fechaCita,
      });
      if (!puede) {
        showToast('Este número ya tiene una cita ese día en esta sucursal.', 'error');
        return;
      }

      // 2. Doble check de disponibilidad del barbero
      const libre = await db.rpc('barbero_disponible', {
        p_id_empleado: wizard.barberoId,
        p_inicio:      wizard.slotInicio,
        p_fin:         wizard.slotFin,
      });
      if (!libre) {
        showToast('Ese horario ya no está disponible. Elige otro.', 'error');
        await cargarSlots();
        return;
      }

      // 3. Resolver id_cliente
      submitBtn.textContent = 'Agendando…';
      let clienteId = logged?.id_cliente || null;

      if (!clienteId) {
        // 3.a. ¿el email pertenece a un cliente REGISTRADO (con Auth)?
        //      Vía RPC (SECURITY DEFINER) porque anon no tiene SELECT sobre cliente.
        const matchByEmail = await db.rpc('buscar_cliente_por_email', { p_email: email });
        const registered = matchByEmail.find(c => c.auth_user_id);
        if (registered) {
          emailAuthAlert.classList.remove('is-hidden');
          showToast('Ese email ya tiene cuenta. Inicia sesión o usa otro email.', 'error');
          return;
        }
        // 3.b. lookup por teléfono → reusar id_cliente si existe
        const matchByPhone = await db.rpc('buscar_cliente_por_telefono', { p_telefono: telefono });
        if (matchByPhone.length) {
          clienteId = matchByPhone[0].id_cliente;
        } else {
          // 3.c. Crear cliente nuevo como anónimo
          const [nuevo] = await db.post('cliente', {
            nombre, apellido, telefono, email, tipo: 'anonimo',
          }, true);
          clienteId = nuevo.id_cliente;
        }
      }

      // 4. Insertar cita en estado pendiente_confirmacion
      const [cita] = await db.post('cita', {
        id_sucursal:       wizard.sucursalId,
        id_empleado:       wizard.barberoId,
        id_cliente:        clienteId,
        fecha_hora_inicio: wizard.slotInicio,
        fecha_hora_fin:    wizard.slotFin,
        origen:            'online',
        estado:            'pendiente_confirmacion',
        notas,
      }, true);

      // 5. Insertar detalle_cita (N filas — una por servicio). Trigger recalcula fecha_hora_fin.
      const detalles = wizard.servicios.map((s, i) => ({
        id_cita:         cita.id_cita,
        id_servicio:     s.id,
        precio_aplicado: s.precio,
        orden:           i + 1,
      }));
      await db.post('detalle_cita', detalles);

      // 6. Disparar email de confirmación
      submitBtn.textContent = 'Enviando confirmación…';
      let emailOk = false;
      try {
        const r = await fetch('/api/enviar-confirmacion-cita', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_cita: cita.id_cita, email_cliente: email }),
        });
        emailOk = r.ok;
        if (!r.ok) {
          const txt = await r.text();
          console.warn(`Email no enviado (HTTP ${r.status}):`, txt);
        }
      } catch (e) {
        console.warn('Email: fallo de red o endpoint inalcanzable', e);
      }

      if (emailOk) {
        showToast('✓ ¡Revisa tu email para confirmar la cita! Tienes 10 minutos.', 'success');
      } else {
        // No mentir al usuario: la cita quedó creada pero sin email no podrá confirmar
        // (se autocancelará en 10 min). En dev local sin `vercel dev` esto es normal.
        showToast('⚠ Cita creada, pero el email de confirmación no se envió. Revisa la consola.', 'error');
      }
      setTimeout(closeModal, 2400);

    } catch (err) {
      console.error('Error al agendar:', err);
      showToast(err.message || 'Error al agendar. Intenta de nuevo.', 'error');
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Confirmar Reserva';
    }
  });
})();

/* ============================================================
   7b. AUTH LANDING — Sesión de cliente (login / registro / logout)
   ============================================================ */
const sesionCliente = {
  token:   localStorage.getItem('sb_cli_token')  || null,
  usuario: JSON.parse(localStorage.getItem('sb_cli_user') || 'null'),
  nombre:  localStorage.getItem('sb_cli_nombre') || null,
};

/* ------------------------------------------------------------
   Validar la sesión guardada en localStorage. Si el JWT expiró
   o fue revocado, Supabase responde 401. En ese caso limpiamos
   todo y refrescamos el navbar para mostrar "Acceder".
   Esto evita que el sitio muestre datos de un usuario anterior
   tras cerrar el navegador o quedarse con un token caducado.
   ------------------------------------------------------------ */
function limpiarSesionLocal() {
  sesionCliente.token   = null;
  sesionCliente.usuario = null;
  sesionCliente.nombre  = null;
  ['sb_cli_token','sb_cli_refresh','sb_cli_user','sb_cli_nombre']
    .forEach(k => localStorage.removeItem(k));
}

(async function validarSesionAlCargar() {
  if (!sesionCliente.token) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${sesionCliente.token}`,
      },
    });
    if (!res.ok) throw new Error(`Token inválido (${res.status})`);
    // Token OK: refrescar usuario en memoria y storage con datos canónicos
    const user = await res.json();
    sesionCliente.usuario = user;
    localStorage.setItem('sb_cli_user', JSON.stringify(user));
  } catch (err) {
    console.warn('Sesión vieja descartada:', err.message);
    limpiarSesionLocal();
    if (typeof actualizarNavAuth === 'function') actualizarNavAuth();
  }
})();

/* ------------------------------------------------------------
   Capturar retorno desde verificación de email de Supabase Auth.
   Cuando el cliente hace click en el link del correo, Supabase
   redirige al Site URL con tokens en el hash:
     /#access_token=...&refresh_token=...&type=signup
   Guardamos la sesión, limpiamos la URL y avisamos al usuario.
   ------------------------------------------------------------ */
(function captureAuthReturn() {
  if (!window.location.hash || !window.location.hash.includes('access_token=')) return;

  const params       = new URLSearchParams(window.location.hash.slice(1));
  const accessToken  = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type         = params.get('type'); // 'signup' | 'recovery' | 'magiclink' | ...
  if (!accessToken) return;

  // Decodificar payload del JWT para obtener id, email y nombre
  let user = null;
  try {
    const b64  = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64);
    const payload = JSON.parse(decodeURIComponent(escape(json)));
    user = {
      id:    payload.sub,
      email: payload.email,
      user_metadata: payload.user_metadata || {},
    };
  } catch (err) {
    console.warn('No se pudo decodificar el JWT del hash:', err);
  }

  if (user) {
    sesionCliente.token   = accessToken;
    sesionCliente.usuario = user;
    sesionCliente.nombre  = user.user_metadata?.nombre || null;
    localStorage.setItem('sb_cli_token', accessToken);
    if (refreshToken) localStorage.setItem('sb_cli_refresh', refreshToken);
    localStorage.setItem('sb_cli_user', JSON.stringify(user));
    if (sesionCliente.nombre) localStorage.setItem('sb_cli_nombre', sesionCliente.nombre);
  }

  // Limpiar el hash para que el token no quede visible en la URL
  history.replaceState(null, '', window.location.pathname + window.location.search);

  // Feedback al usuario y refresco del navbar (en el siguiente tick: showToast
  // se define después en el archivo).
  const mensaje = type === 'signup'
    ? '✓ Email confirmado. Sesión iniciada.'
    : '✓ Sesión iniciada.';
  setTimeout(async () => {
    if (typeof showToast === 'function') showToast(mensaje, 'success');
    // Si es un signup, crear la fila `cliente` (la función es idempotente:
    // si ya existe no duplica). Imprescindible para que /mi-cuenta funcione.
    if (type === 'signup' && user && typeof asegurarClienteRegistrado === 'function') {
      try { await asegurarClienteRegistrado(accessToken, user); } catch (_) {}
    }
    if (typeof actualizarNavAuth === 'function') actualizarNavAuth();
  }, 400);
})();

async function loginCliente(email, password) {
  // Limpiar datos del usuario anterior antes de probar credenciales nuevas.
  // Si el lookup posterior falla por cualquier razón, NO debe quedar el
  // nombre del usuario previo en el toast / navbar.
  sesionCliente.nombre = null;
  localStorage.removeItem('sb_cli_nombre');

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

  // Asegurar fila en `cliente` (la crea si no existe usando user_metadata
  // capturado en el registro). También setea sesionCliente.nombre.
  try {
    await asegurarClienteRegistrado(data.access_token, data.user);
  } catch (err) {
    console.warn('No se pudo asegurar cliente registrado tras login:', err);
  }
}

async function registrarCliente(email, password, nombre, apellido, telefono) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      // user_metadata: lo lee asegurarClienteRegistrado() para crear la fila
      // `cliente` con tipo='registrado' cuando el email se verifique.
      data: { nombre, apellido, telefono },
    }),
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

    // Si Supabase devolvió sesión directa (sin confirmación de email),
    // crear la fila cliente inmediatamente.
    try { await asegurarClienteRegistrado(data.access_token, data.user); } catch (_) {}
  }
}

/* ------------------------------------------------------------
   asegurarClienteRegistrado — crea la fila `cliente` si no existe.
   Necesario para que /mi-cuenta encuentre un perfil y para asociar
   citas futuras al mismo id_cliente que el JWT.

   La policy RLS `cliente_registro_publico` permite INSERT cuando
   auth_user_id = auth.uid() AND tipo = 'registrado'. Por eso se
   manda el token del usuario en el Authorization header.

   Lee nombre/apellido/telefono de user_metadata (que se setea en
   el signup); si faltan, NO inserta (no podemos cumplir el NOT
   NULL de telefono con datos inventados).
   ------------------------------------------------------------ */
async function asegurarClienteRegistrado(token, user) {
  if (!user || !user.id) return null;

  const meta = user.user_metadata || {};
  const nombre   = (meta.nombre   || '').trim();
  const apellido = (meta.apellido || '').trim();
  const telefono = (meta.telefono || '').trim();

  // RPC que hace TODO en una sola llamada (SECURITY DEFINER):
  //  · Si el usuario ya está vinculado → devuelve su id_cliente.
  //  · Si existe un cliente anónimo con el mismo email o teléfono →
  //    UPGRADE in-place (set auth_user_id, tipo='registrado') preservando
  //    citas históricas.
  //  · Si no existe → INSERT nuevo con tipo='registrado'.
  //  · Si el email ya pertenece a OTRO usuario registrado → conflicto.
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/vincular_o_crear_cliente_registrado`,
      {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          p_user_id:  user.id,
          p_email:    user.email || '',
          p_nombre:   nombre,
          p_apellido: apellido,
          p_telefono: telefono,
        }),
      }
    );
    if (!res.ok) {
      console.error('RPC vincular_o_crear_cliente_registrado falló:', await res.text());
      return null;
    }
    const data = await res.json();
    const result = Array.isArray(data) ? data[0] : data;

    if (!result?.ok) {
      console.warn('Vincular cliente:', result?.accion, result?.mensaje);
      // Si fue conflicto de email, avisar visualmente
      if (result?.accion === 'conflict_email' && typeof showToast === 'function') {
        showToast(result.mensaje, 'error');
      }
      return null;
    }

    // Log diagnóstico: indica si se hizo upgrade, se creó nuevo, o ya existía
    console.info(`Cliente: ${result.accion} (${result.id_cliente})`);

    // Refrescar nombre en sesión leyendo el row final
    try {
      const rows = await db.get(
        'cliente',
        'id_cliente,nombre',
        { id_cliente: result.id_cliente },
        token
      );
      if (rows.length && rows[0].nombre) {
        sesionCliente.nombre = rows[0].nombre;
        localStorage.setItem('sb_cli_nombre', rows[0].nombre);
      }
    } catch (_) {}

    return result.id_cliente;
  } catch (err) {
    console.error('Error en asegurarClienteRegistrado:', err);
    return null;
  }
}

function logoutCliente() {
  sesionCliente.token   = null;
  sesionCliente.usuario = null;
  sesionCliente.nombre  = null;
  ['sb_cli_token','sb_cli_refresh','sb_cli_user','sb_cli_nombre'].forEach(k => localStorage.removeItem(k));

  // Limpiar formularios para no dejar rastro de sesión anterior
  document.getElementById('authLoginForm')?.reset();
  document.getElementById('authRegisterForm')?.reset();
  document.getElementById('bookingForm')?.reset();
  const loginErr = document.getElementById('authLoginError');
  const regErr   = document.getElementById('authRegisterError');
  if (loginErr) loginErr.textContent = '';
  if (regErr)   regErr.textContent   = '';

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
    // Limpiar formularios y mensajes de error: que no queden datos sensibles
    // ni huellas de un intento anterior al volver a abrir.
    document.getElementById('authLoginForm')?.reset();
    document.getElementById('authRegisterForm')?.reset();
    const loginErr = document.getElementById('authLoginError');
    const regErr   = document.getElementById('authRegisterError');
    if (loginErr) loginErr.textContent = '';
    if (regErr)   regErr.textContent   = '';
    // Volver siempre al tab de login para el próximo open
    switchTab('login');
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
          window.location.href = '/dashboard';
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
    const apellido = document.getElementById('regApellido').value.trim();
    const telefono = limpiarTelefono(document.getElementById('regTelefono').value);
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const errEl    = document.getElementById('authRegisterError');
    const btn      = document.getElementById('authRegisterBtn');

    errEl.textContent = '';

    if (!nombre || !apellido || !telefono || !email || !password) {
      errEl.textContent = 'Completa todos los campos.';
      return;
    }
    const vt = validarTelefonoFrontend(telefono);
    if (!vt.valido) { errEl.textContent = vt.error; return; }

    btn.disabled      = true;
    btn.textContent   = 'Creando cuenta…';

    try {
      await registrarCliente(email, password, nombre, apellido, telefono);
      actualizarNavAuth();

      // Si Supabase requiere confirmación de email (lo habitual), no hay
      // access_token todavía. Avisar al usuario y cambiar al tab de login
      // para que sepa que después de verificar puede entrar.
      if (!sesionCliente.token) {
        e.target.reset();   // limpiar el form de registro
        switchTab('login');
        // Pre-llenar el email en el login para que solo tenga que poner pass
        const loginEmailEl = document.getElementById('authEmail');
        if (loginEmailEl) loginEmailEl.value = email;
        showToast('✓ Cuenta creada. Revisa tu email para verificar tu cuenta antes de iniciar sesión.', 'success');
      } else {
        // Supabase devolvió sesión directa (poco común sin confirmación)
        e.target.reset();
        closeAuthModal();
        showToast('¡Cuenta creada! Bienvenido.', 'success');
      }
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
    window.location.href = '/mi-cuenta';
  });

  // Aplicar estado inicial de sesión
  actualizarNavAuth();

  // Si la URL trae ?login=1 (p.ej. redirect desde /mi-cuenta cuando no hay
  // sesión), abrir el modal de auth automáticamente.
  if (new URLSearchParams(window.location.search).get('login') === '1') {
    if (typeof window._openAuthModal === 'function') {
      setTimeout(() => window._openAuthModal('login'), 300);
    }
  }
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

  // Cargar servicios, barberos y sucursales en paralelo desde Supabase
  await Promise.all([
    cargarServicios(),
    cargarBarberos(),
    cargarSucursalesUI(),
  ]);

  // Scroll reveal sobre los elementos ya renderizados
  initScrollReveal();
});
