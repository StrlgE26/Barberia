/* ============================================================
   /mi-cuenta — dashboard del cliente registrado
   Requiere que script.js (mismo orden) haya expuesto:
   db, SUPABASE_URL, SUPABASE_KEY, escapeHtml, formatPrecio,
   showToast, limpiarTelefono, validarTelefonoFrontend
   ============================================================ */
(function initMiCuenta() {
  // Refs DOM ----------
  const gate         = document.getElementById('accountGate');
  const main         = document.getElementById('accountMain');
  const accHello     = document.getElementById('accHello');
  const heroName     = document.getElementById('heroName');
  const accLogout    = document.getElementById('accLogout');

  const proximasList   = document.getElementById('proximasList');
  const proximasEmpty  = document.getElementById('proximasEmpty');
  const historialList  = document.getElementById('historialList');
  const historialEmpty = document.getElementById('historialEmpty');
  const countProximas  = document.getElementById('countProximas');
  const countHistorial = document.getElementById('countHistorial');

  const statVisitas  = document.getElementById('statVisitas');
  const statGastado  = document.getElementById('statGastado');
  const statBarbero  = document.getElementById('statBarbero');
  const statServicio = document.getElementById('statServicio');
  const statDesde    = document.getElementById('statDesde');

  const perfilForm   = document.getElementById('perfilForm');
  const perfNombre   = document.getElementById('perfNombre');
  const perfApellido = document.getElementById('perfApellido');
  const perfTelefono = document.getElementById('perfTelefono');
  const perfEmail    = document.getElementById('perfEmail');

  const tabs     = document.querySelectorAll('.account-tab');
  const sections = document.querySelectorAll('.account-section');

  // Modal cancelar
  const cancelModal    = document.getElementById('cancelModal');
  const cancelBackdrop = document.getElementById('cancelBackdrop');
  const cancelClose    = document.getElementById('cancelClose');
  const cancelBack     = document.getElementById('cancelBack');
  const cancelConfirm  = document.getElementById('cancelConfirm');
  const cancelMotivo   = document.getElementById('cancelMotivo');
  let cancelTargetCitaId = null;

  // Estado --------
  let session = null;  // { token, user, cliente }

  // Constantes ----
  const ESTADO_LABEL = {
    pendiente_confirmacion: 'Por confirmar',
    pendiente:              'Confirmada',
    en_curso:               'En curso',
    completada:             'Completada',
    cancelada:              'Cancelada',
    no_presentada:          'No asistió',
  };
  const TZ = 'America/Mexico_City';

  // Helpers fecha/hora ----
  function fmtFecha(iso) {
    return new Date(iso).toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
    });
  }
  function fmtHora(iso) {
    return new Date(iso).toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
  }

  function authHeaders() {
    return {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${session.token}`,
      'Content-Type':  'application/json',
    };
  }

  /* ---------- Tabs ---------- */
  tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  function switchTab(name) {
    tabs.forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on);
    });
    sections.forEach(s => {
      const on = s.dataset.section === name;
      s.classList.toggle('is-active', on);
      s.hidden = !on;
    });
  }

  /* ---------- Init / auth gate ---------- */
  async function init() {
    const tok    = localStorage.getItem('sb_cli_token');
    const usrRaw = localStorage.getItem('sb_cli_user');
    if (!tok || !usrRaw) return showGate();

    let usr;
    try { usr = JSON.parse(usrRaw); } catch { return showGate(); }
    if (!usr?.id) return showGate();

    session = { token: tok, user: usr };

    // Cargar cliente con su token (RLS cliente_propio_perfil)
    let rows;
    try {
      rows = await db.get('cliente',
        'id_cliente,nombre,apellido,telefono,email,tipo,auth_user_id,fecha_registro',
        { auth_user_id: usr.id }, tok);
    } catch (err) {
      console.error('No se pudo leer cliente:', err);
      return showGate();
    }
    if (!rows.length) {
      showToast('No tienes perfil de cliente vinculado. Contacta al administrador.', 'error');
      return showGate();
    }
    session.cliente = rows[0];

    showMain();
    renderHeader();
    fillPerfil();
    await Promise.all([loadProximas(), loadHistorial()]);
  }

  function showGate() {
    gate.classList.remove('is-hidden');
    main.classList.add('is-hidden');
  }
  function showMain() {
    gate.classList.add('is-hidden');
    main.classList.remove('is-hidden');
  }

  function renderHeader() {
    const nombre = session.cliente.nombre || 'Cliente';
    heroName.textContent = nombre;
    accHello.textContent = nombre;
  }

  /* ---------- Próximas citas ---------- */
  async function loadProximas() {
    proximasList.innerHTML = '<div class="empty-state">Cargando…</div>';
    proximasEmpty.classList.add('is-hidden');
    try {
      // Embedded FK joins de PostgREST: trae empleado, sucursal y detalle_cita+servicio
      // en una sola query.
      const select = 'id_cita,fecha_hora_inicio,fecha_hora_fin,estado,notas,' +
        'empleado(nombre,apellidos),' +
        'sucursal(nombre,direccion),' +
        'detalle_cita(precio_aplicado,orden,servicio(nombre))';
      const url = `${SUPABASE_URL}/rest/v1/cita?` +
        `select=${encodeURIComponent(select)}` +
        `&id_cliente=eq.${session.cliente.id_cliente}` +
        `&estado=in.(pendiente_confirmacion,pendiente,en_curso)` +
        `&order=fecha_hora_inicio.asc`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      renderCitas(data, proximasList, proximasEmpty, /*allowCancel=*/true);
      countProximas.textContent = data.length;
    } catch (err) {
      console.error('Próximas:', err);
      proximasList.innerHTML = '';
      proximasEmpty.textContent = 'No se pudieron cargar tus próximas citas.';
      proximasEmpty.classList.remove('is-hidden');
    }
  }

  /* ---------- Historial ---------- */
  async function loadHistorial() {
    historialList.innerHTML = '<div class="empty-state">Cargando…</div>';
    historialEmpty.classList.add('is-hidden');
    try {
      const url = `${SUPABASE_URL}/rest/v1/v_historial_cliente?` +
        `id_cliente=eq.${session.cliente.id_cliente}` +
        `&order=fecha_hora_inicio.desc`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      renderHistorial(data);
      countHistorial.textContent = data.length;
      renderStats(data);
    } catch (err) {
      console.error('Historial:', err);
      historialList.innerHTML = '';
      historialEmpty.textContent = 'No se pudo cargar el historial.';
      historialEmpty.classList.remove('is-hidden');
    }
  }

  /* ---------- Render próximas (con cancel) ---------- */
  function renderCitas(citas, container, empty, allowCancel) {
    container.innerHTML = '';
    if (!citas.length) {
      empty.textContent = 'No tienes próximas citas. ¿Agendamos una?';
      empty.classList.remove('is-hidden');
      return;
    }
    empty.classList.add('is-hidden');
    container.innerHTML = citas.map(c => {
      const detalles = (c.detalle_cita || []).slice().sort((a,b) => (a.orden||0) - (b.orden||0));
      const serviciosTxt = detalles.map(d => d.servicio?.nombre).filter(Boolean).join(', ');
      const total = detalles.reduce((s,d) => s + parseFloat(d.precio_aplicado || 0), 0);
      const barbero = c.empleado ? `${c.empleado.nombre || ''} ${c.empleado.apellidos || ''}`.trim() : '—';
      const sucursal = c.sucursal?.nombre || '';
      return `
        <article class="cita-card">
          <div class="cita-card__head">
            <span class="cita-card__fecha">${fmtFecha(c.fecha_hora_inicio)}</span>
            <span class="cita-badge cita-badge--${c.estado}">${ESTADO_LABEL[c.estado] || c.estado}</span>
          </div>
          <h3 class="cita-card__title">${fmtHora(c.fecha_hora_inicio)} – ${fmtHora(c.fecha_hora_fin)}</h3>
          <div class="cita-card__row"><span>Barbero:</span> <strong>${escapeHtml(barbero || '—')}</strong></div>
          <div class="cita-card__row"><span>Servicios:</span> <strong>${escapeHtml(serviciosTxt || '—')}</strong></div>
          ${sucursal ? `<div class="cita-card__row"><span>Sucursal:</span> ${escapeHtml(sucursal)}</div>` : ''}
          <p class="cita-card__total">Total: $${formatPrecio(total)}</p>
          ${allowCancel ? `
            <div class="cita-card__foot">
              <button type="button" class="cita-card__cancel-btn" data-cancel-id="${c.id_cita}">Cancelar</button>
            </div>` : ''}
        </article>
      `;
    }).join('');

    container.querySelectorAll('[data-cancel-id]').forEach(btn => {
      btn.addEventListener('click', () => openCancelModal(btn.dataset.cancelId));
    });
  }

  /* ---------- Render historial (v_historial_cliente) ---------- */
  function renderHistorial(rows) {
    historialList.innerHTML = '';
    if (!rows.length) {
      historialEmpty.textContent = 'Aún no tienes citas completadas en tu historial.';
      historialEmpty.classList.remove('is-hidden');
      return;
    }
    historialEmpty.classList.add('is-hidden');
    historialList.innerHTML = rows.map(c => {
      const barbero = `${c.barbero_nombre || ''} ${c.barbero_apellidos || ''}`.trim();
      const sucursal = c.sucursal_nombre || '';
      return `
        <article class="cita-card">
          <div class="cita-card__head">
            <span class="cita-card__fecha">${fmtFecha(c.fecha_hora_inicio)}</span>
            <span class="cita-badge cita-badge--${c.estado}">${ESTADO_LABEL[c.estado] || c.estado}</span>
          </div>
          <h3 class="cita-card__title">${fmtHora(c.fecha_hora_inicio)} – ${fmtHora(c.fecha_hora_fin)}</h3>
          <div class="cita-card__row"><span>Barbero:</span> <strong>${escapeHtml(barbero || '—')}</strong></div>
          <div class="cita-card__row"><span>Servicios:</span> <strong>${escapeHtml(c.servicios_nombres || '—')}</strong></div>
          ${sucursal ? `<div class="cita-card__row"><span>Sucursal:</span> ${escapeHtml(sucursal)}</div>` : ''}
          <p class="cita-card__total">Total: $${formatPrecio(parseFloat(c.total_pagado || 0))}</p>
        </article>
      `;
    }).join('');
  }

  /* ---------- Stats (computadas desde el historial) ---------- */
  function renderStats(historial) {
    const completadas = historial.filter(c => c.estado === 'completada');
    statVisitas.textContent = completadas.length;
    statGastado.textContent =
      `$${formatPrecio(completadas.reduce((s,c) => s + parseFloat(c.total_pagado || 0), 0))}`;

    // Barbero más visitado
    const barbCount = {};
    completadas.forEach(c => {
      const k = `${c.barbero_nombre || ''} ${c.barbero_apellidos || ''}`.trim() || '—';
      barbCount[k] = (barbCount[k] || 0) + 1;
    });
    const topBarb = Object.entries(barbCount).sort((a,b) => b[1] - a[1])[0];
    statBarbero.textContent = topBarb ? topBarb[0] : '—';

    // Servicio favorito (servicios_nombres viene como "Corte, Barba")
    const servCount = {};
    completadas.forEach(c => {
      (c.servicios_nombres || '').split(',').map(x => x.trim()).filter(Boolean)
        .forEach(name => { servCount[name] = (servCount[name] || 0) + 1; });
    });
    const topServ = Object.entries(servCount).sort((a,b) => b[1] - a[1])[0];
    statServicio.textContent = topServ ? topServ[0] : '—';

    if (session.cliente.fecha_registro) {
      statDesde.textContent = new Date(session.cliente.fecha_registro).toLocaleDateString('es-ES', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
      });
    } else {
      statDesde.textContent = '—';
    }
  }

  /* ---------- Perfil ---------- */
  function fillPerfil() {
    perfNombre.value   = session.cliente.nombre   || '';
    perfApellido.value = session.cliente.apellido || '';
    perfTelefono.value = session.cliente.telefono || '';
    perfEmail.value    = session.cliente.email    || session.user.email || '';
  }

  perfilForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre   = perfNombre.value.trim();
    const apellido = perfApellido.value.trim();
    const telefono = limpiarTelefono(perfTelefono.value);
    if (!nombre || !apellido || !telefono) {
      showToast('Completa todos los campos.', 'error');
      return;
    }
    const v = validarTelefonoFrontend(telefono);
    if (!v.valido) { showToast(v.error, 'error'); return; }

    const submitBtn = perfilForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando…';
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/cliente?id_cliente=eq.${session.cliente.id_cliente}`,
        {
          method: 'PATCH',
          headers: { ...authHeaders(), 'Prefer': 'return=representation' },
          body: JSON.stringify({ nombre, apellido, telefono }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const [updated] = await res.json();
      session.cliente = { ...session.cliente, ...updated };
      renderHeader();
      showToast('✓ Perfil actualizado.', 'success');
    } catch (err) {
      console.error(err);
      showToast('No se pudo actualizar el perfil.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar cambios';
    }
  });

  /* ---------- Cancel modal ---------- */
  function openCancelModal(citaId) {
    cancelTargetCitaId = citaId;
    cancelMotivo.value = '';
    cancelModal.classList.add('is-open');
    cancelModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function closeCancelModal() {
    cancelTargetCitaId = null;
    cancelModal.classList.remove('is-open');
    cancelModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  cancelClose.addEventListener('click', closeCancelModal);
  cancelBackdrop.addEventListener('click', closeCancelModal);
  cancelBack.addEventListener('click', closeCancelModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && cancelModal.classList.contains('is-open')) closeCancelModal();
  });

  cancelConfirm.addEventListener('click', async () => {
    if (!cancelTargetCitaId) return;
    cancelConfirm.disabled = true;
    cancelConfirm.textContent = 'Cancelando…';
    try {
      // RPC con auth header (SECURITY DEFINER + auth.uid())
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancelar_mi_cita`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          p_id_cita: cancelTargetCitaId,
          p_motivo:  cancelMotivo.value.trim() || null,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.ok) throw new Error(result?.mensaje || 'No se pudo cancelar');
      showToast('Cita cancelada.', 'success');
      closeCancelModal();
      await Promise.all([loadProximas(), loadHistorial()]);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Error al cancelar.', 'error');
    } finally {
      cancelConfirm.disabled = false;
      cancelConfirm.textContent = 'Sí, cancelar';
    }
  });

  /* ---------- Logout ---------- */
  accLogout.addEventListener('click', () => {
    ['sb_cli_token','sb_cli_refresh','sb_cli_user','sb_cli_nombre'].forEach(k => localStorage.removeItem(k));
    window.location.href = '/';
  });

  // Auto-init (script.js carga primero con defer; sus globales ya existen)
  init();
})();
