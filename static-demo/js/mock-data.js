'use strict';

/* eslint-disable no-unused-vars */
const DEMO = (() => {

  // ─── CREDENCIALES ─────────────────────────────────────────────────────────
  const CREDENTIALS = [
    { email: 'admin@barberia.com',    password: 'admin123',   rol: 'admin_general',  nombre: 'Roberto', apellido: 'Sánchez', id: 'emp-006' },
    { email: 'sucursal@barberia.com', password: 'admin123',   rol: 'admin_sucursal', nombre: 'Ana',     apellido: 'López',   id: 'emp-005' },
    { email: 'barbero@barberia.com',  password: 'barbero123', rol: 'barbero',        nombre: 'Carlos',  apellido: 'Mendoza', id: 'emp-001' },
    { email: 'cliente@barberia.com',  password: 'cliente123', rol: 'cliente',        nombre: 'Ana',     apellido: 'García',  id: 'cli-001' },
  ];

  // ─── CATÁLOGOS ESTÁTICOS ─────────────────────────────────────────────────
  const SUCURSAL = {
    id_sucursal: 'suc-001',
    nombre: 'The Hipster Lindavista',
    direccion: 'Riobamba 690, Lindavista, CDMX',
    telefono: '5589559791',
    horario: 'Lun–Sáb 10:00–20:00',
  };

  const SERVICIOS = [
    { id_servicio: 'srv-001', nombre: 'Corte Clásico',          duracion_min: 30, precio: 180, activo: true, descripcion: 'Corte con tijera y máquina, acabado perfecto.' },
    { id_servicio: 'srv-002', nombre: 'Degradado + Perfil',      duracion_min: 45, precio: 220, activo: true, descripcion: 'Fade preciso con perfilado de barba incluido.' },
    { id_servicio: 'srv-003', nombre: 'Arreglo de Barba',        duracion_min: 20, precio: 120, activo: true, descripcion: 'Líneas definidas y barba bien cuidada.' },
    { id_servicio: 'srv-004', nombre: 'Combo Total',             duracion_min: 60, precio: 320, activo: true, descripcion: 'Corte + Degradado + Barba. Todo en uno.', destacado: true },
    { id_servicio: 'srv-005', nombre: 'Tratamiento Hidratante',  duracion_min: 40, precio: 280, activo: true, descripcion: 'Hidratación profunda para cabello y cuero cabelludo.' },
    { id_servicio: 'srv-006', nombre: 'Diseño Personalizado',    duracion_min: 60, precio: 380, activo: true, descripcion: 'Diseños artísticos y líneas creativas a tu medida.' },
  ];

  const EMPLEADOS_BASE = [
    { id_empleado: 'emp-001', nombre: 'Carlos',    apellido: 'Mendoza',  email: 'barbero@barberia.com',  rol: 'barbero',        especialidad: 'Degradados y Diseños',      foto_url: null, id_sucursal: 'suc-001' },
    { id_empleado: 'emp-002', nombre: 'Diego',     apellido: 'Hernández',email: 'diego@barberia.com',    rol: 'barbero',        especialidad: 'Cortes Clásicos',           foto_url: null, id_sucursal: 'suc-001' },
    { id_empleado: 'emp-003', nombre: 'Rodrigo',   apellido: 'Torres',   email: 'rodrigo@barberia.com',  rol: 'barbero',        especialidad: 'Barba y Diseño',            foto_url: null, id_sucursal: 'suc-001' },
    { id_empleado: 'emp-004', nombre: 'Alejandro', apellido: 'Ruiz',     email: 'alejandro@barberia.com',rol: 'barbero',        especialidad: 'Corte Infantil y Clásico',  foto_url: null, id_sucursal: 'suc-001' },
    { id_empleado: 'emp-005', nombre: 'Ana',       apellido: 'López',    email: 'sucursal@barberia.com', rol: 'admin_sucursal', especialidad: null,                        foto_url: null, id_sucursal: 'suc-001' },
    { id_empleado: 'emp-006', nombre: 'Roberto',   apellido: 'Sánchez',  email: 'admin@barberia.com',    rol: 'admin_general',  especialidad: null,                        foto_url: null, id_sucursal: 'suc-001' },
  ];

  const CLIENTE_DEMO = {
    id_cliente: 'cli-001',
    nombre: 'Ana',
    apellido: 'García',
    email: 'cliente@barberia.com',
    telefono: '5512345678',
    fecha_registro: '2024-09-15',
  };

  // ─── ESTADO MUTABLE (localStorage) ───────────────────────────────────────
  const STORAGE_KEY = 'demo_barberia_state_v4';

  function getEstado() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    return _buildEstadoInicial();
  }

  function setEstado(estado) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(estado)); } catch (_) { /* ignore */ }
  }

  function resetEstado() {
    localStorage.removeItem(STORAGE_KEY);
    return _buildEstadoInicial();
  }

  function _iso(base, days, hh, mm) {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;
  }

  function _buildEstadoInicial() {
    const now = new Date();
    // Normalize to midnight so date math is stable
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const barberoStates = {
      'emp-001': 'ocupado',
      'emp-002': 'libre',
      'emp-003': 'en_espera',
      'emp-004': 'ausente',
    };

    function mkCita(id, idCliente, idEmp, idSrv, daysOffset, hh, mm, durMin, estado, origen, walkin, notas) {
      const inicio = _iso(base, daysOffset, hh, mm);
      const fin = new Date(new Date(inicio).getTime() + durMin * 60000).toISOString().slice(0, 19);
      return { id_cita: id, id_cliente: idCliente, id_empleado: idEmp, id_servicio: idSrv,
               id_sucursal: 'suc-001', fecha_hora_inicio: inicio, fecha_hora_fin: fin,
               estado, origen, nombre_walkin: walkin, notas: notas || null };
    }

    const citas = [
      // HOY — completadas
      mkCita('cit-001', 'cli-001', 'emp-001', 'srv-002',  0, 10,  0, 45, 'completada',   'web',      null,              null),
      mkCita('cit-002', null,      'emp-002', 'srv-001',  0, 10,  0, 30, 'completada',   'walkin',   'Luis Martínez',   null),
      mkCita('cit-003', null,      'emp-003', 'srv-003',  0, 10,  0, 20, 'completada',   'walkin',   'Pedro Ríos',      null),
      mkCita('cit-004', 'cli-001', 'emp-001', 'srv-004',  0, 11,  0, 60, 'completada',   'web',      null,              null),
      mkCita('cit-005', null,      'emp-002', 'srv-002',  0, 11,  0, 45, 'completada',   'walkin',   'Javier Cruz',     null),
      mkCita('cit-006', null,      'emp-003', 'srv-001',  0, 11,  0, 30, 'no_presentada','telefono', 'Gabriel Moreno',  null),
      // HOY — en curso / cola
      mkCita('cit-007', null,      'emp-001', 'srv-002',  0, 13,  0, 45, 'en_curso',     'walkin',   'Miguel Ángel Soto', null),
      mkCita('cit-008', null,      'emp-003', 'srv-003',  0, 13,  0, 20, 'en_espera',    'walkin',   'Fernando Vega',   null),
      // HOY — pendientes
      mkCita('cit-009', null,      'emp-002', 'srv-001',  0, 14,  0, 30, 'pendiente',    'web',      null,              null),
      mkCita('cit-010', null,      'emp-001', 'srv-005',  0, 15,  0, 40, 'pendiente',    'walkin',   'Héctor Ramírez',  null),
      mkCita('cit-011', null,      'emp-003', 'srv-002',  0, 15,  0, 45, 'pendiente',    'walkin',   'Óscar Guerrero',  null),
      mkCita('cit-012', 'cli-001', 'emp-002', 'srv-004',  0, 16,  0, 60, 'pendiente',    'web',      null,              'Dejar flequillo largo'),
      mkCita('cit-013', null,      'emp-003', 'srv-001',  0, 17,  0, 30, 'cancelada',    'walkin',   'Raúl Domínguez',  null),
      mkCita('cit-014', null,      'emp-001', 'srv-006',  0, 18,  0, 60, 'pendiente',    'telefono', 'Iván Castillo',   'Cliente VIP'),
      mkCita('cit-015', null,      'emp-002', 'srv-003',  0, 19,  0, 20, 'pendiente',    'walkin',   'Eduardo Flores',  null),
      // PRÓXIMAS (cliente demo)
      mkCita('cit-f01', 'cli-001', 'emp-001', 'srv-002',  1, 11,  0, 45, 'pendiente',    'web',      null,              null),
      mkCita('cit-f02', 'cli-001', 'emp-003', 'srv-001',  5, 16,  0, 30, 'pendiente',    'web',      null,              null),
      // HISTORIAL (cliente demo — fechas absolutas pasadas)
      { id_cita:'cit-h01', id_cliente:'cli-001', id_empleado:'emp-001', id_servicio:'srv-004', id_sucursal:'suc-001', fecha_hora_inicio:'2025-10-15T11:00:00', fecha_hora_fin:'2025-10-15T12:00:00', estado:'completada',   origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h02', id_cliente:'cli-001', id_empleado:'emp-002', id_servicio:'srv-002', id_sucursal:'suc-001', fecha_hora_inicio:'2025-11-02T10:00:00', fecha_hora_fin:'2025-11-02T10:45:00', estado:'completada',   origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h03', id_cliente:'cli-001', id_empleado:'emp-001', id_servicio:'srv-001', id_sucursal:'suc-001', fecha_hora_inicio:'2025-11-20T14:00:00', fecha_hora_fin:'2025-11-20T14:30:00', estado:'cancelada',    origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h04', id_cliente:'cli-001', id_empleado:'emp-003', id_servicio:'srv-003', id_sucursal:'suc-001', fecha_hora_inicio:'2025-12-05T12:00:00', fecha_hora_fin:'2025-12-05T12:20:00', estado:'completada',   origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h05', id_cliente:'cli-001', id_empleado:'emp-001', id_servicio:'srv-002', id_sucursal:'suc-001', fecha_hora_inicio:'2025-12-28T13:00:00', fecha_hora_fin:'2025-12-28T13:45:00', estado:'completada',   origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h06', id_cliente:'cli-001', id_empleado:'emp-002', id_servicio:'srv-004', id_sucursal:'suc-001', fecha_hora_inicio:'2026-01-15T11:00:00', fecha_hora_fin:'2026-01-15T12:00:00', estado:'completada',   origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h07', id_cliente:'cli-001', id_empleado:'emp-001', id_servicio:'srv-006', id_sucursal:'suc-001', fecha_hora_inicio:'2026-02-10T15:00:00', fecha_hora_fin:'2026-02-10T16:00:00', estado:'no_presentada',origen:'web', nombre_walkin:null, notas:null },
      { id_cita:'cit-h08', id_cliente:'cli-001', id_empleado:'emp-001', id_servicio:'srv-002', id_sucursal:'suc-001', fecha_hora_inicio:'2026-03-01T12:00:00', fecha_hora_fin:'2026-03-01T12:45:00', estado:'completada',   origen:'web', nombre_walkin:null, notas:null },
    ];

    const estado = { barberoStates, citas, nextId: 100 };
    setEstado(estado);
    return estado;
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function getHoy() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function fmtHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtFechaLarga(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function getSrv(id) { return SERVICIOS.find(s => s.id_servicio === id); }
  function getEmp(id) { return EMPLEADOS_BASE.find(e => e.id_empleado === id); }

  function nombreCliente(c) {
    if (c.nombre_walkin) return c.nombre_walkin;
    if (c.id_cliente === 'cli-001') return 'Ana García';
    return 'Cliente';
  }

  // ─── VISTAS SIMULADAS ────────────────────────────────────────────────────

  function getPanelBarberos() {
    const estado = getEstado();
    const HOY = getHoy();

    return EMPLEADOS_BASE.filter(e => e.rol === 'barbero').map(b => {
      const estadoActual = estado.barberoStates[b.id_empleado] || 'libre';

      const citaEnCurso = estado.citas.find(c =>
        c.id_empleado === b.id_empleado && c.estado === 'en_curso' &&
        c.fecha_hora_inicio.startsWith(HOY)
      );

      const siguientes = estado.citas.filter(c =>
        c.id_empleado === b.id_empleado &&
        (c.estado === 'pendiente' || c.estado === 'en_espera') &&
        c.fecha_hora_inicio.startsWith(HOY)
      ).sort((a, z) => a.fecha_hora_inicio.localeCompare(z.fecha_hora_inicio));

      const srv = citaEnCurso ? getSrv(citaEnCurso.id_servicio) : null;

      return {
        id_empleado:       b.id_empleado,
        barbero_nombre:    `${b.nombre} ${b.apellido}`,
        foto_url:          b.foto_url,
        especialidad:      b.especialidad,
        estado_actual:     estadoActual,
        cita_id_actual:    citaEnCurso?.id_cita || null,
        cliente_actual:    citaEnCurso ? nombreCliente(citaEnCurso) : null,
        servicio_actual:   srv?.nombre || null,
        hora_inicio_actual: citaEnCurso ? fmtHora(citaEnCurso.fecha_hora_inicio) : null,
        hora_fin_actual:    citaEnCurso ? fmtHora(citaEnCurso.fecha_hora_fin) : null,
        proxima_cita_hora:  siguientes[0] ? fmtHora(siguientes[0].fecha_hora_inicio) : null,
        nombre_walkin:      citaEnCurso?.nombre_walkin || null,
        cliente_nombre:     citaEnCurso?.id_cliente === 'cli-001' ? 'Ana' : null,
        cliente_apellido:   citaEnCurso?.id_cliente === 'cli-001' ? 'García' : null,
      };
    });
  }

  function getCitasDelDia() {
    const estado = getEstado();
    const HOY = getHoy();
    return estado.citas
      .filter(c => c.fecha_hora_inicio.startsWith(HOY))
      .sort((a, z) => a.fecha_hora_inicio.localeCompare(z.fecha_hora_inicio))
      .map(c => {
        const emp = getEmp(c.id_empleado);
        const srv = getSrv(c.id_servicio);
        return {
          id_cita:         c.id_cita,
          hora_inicio:     fmtHora(c.fecha_hora_inicio),
          hora_fin:        fmtHora(c.fecha_hora_fin),
          cliente_nombre:  nombreCliente(c),
          servicio_nombre: srv?.nombre || '—',
          barbero_nombre:  emp ? `${emp.nombre} ${emp.apellido}` : '—',
          estado:          c.estado,
          origen:          c.origen,
          notas:           c.notas,
        };
      });
  }

  function getColaWalkins() {
    const estado = getEstado();
    const HOY = getHoy();
    return estado.citas
      .filter(c =>
        c.fecha_hora_inicio.startsWith(HOY) &&
        (c.estado === 'en_espera' || c.estado === 'pendiente') &&
        (c.origen === 'walkin' || c.origen === 'telefono')
      )
      .sort((a, z) => a.fecha_hora_inicio.localeCompare(z.fecha_hora_inicio))
      .map((c, i) => {
        const emp = getEmp(c.id_empleado);
        const srv = getSrv(c.id_servicio);
        return {
          id_cita:             c.id_cita,
          nombre_walkin:       c.nombre_walkin || 'Cliente',
          barbero_nombre:      emp ? `${emp.nombre} ${emp.apellido}` : '—',
          servicio_nombre:     srv?.nombre || '—',
          posicion_cola:       i + 1,
          espera_estimada_min: i * (srv?.duracion_min || 30),
          id_sucursal:         'suc-001',
        };
      });
  }

  function getProximasCitas() {
    const estado = getEstado();
    const ahora = new Date().toISOString();
    return estado.citas
      .filter(c => c.id_cliente === 'cli-001' && c.fecha_hora_inicio > ahora &&
                   (c.estado === 'pendiente' || c.estado === 'en_espera' || c.estado === 'pendiente_confirmacion'))
      .sort((a, z) => a.fecha_hora_inicio.localeCompare(z.fecha_hora_inicio))
      .map(c => {
        const emp = getEmp(c.id_empleado);
        const srv = getSrv(c.id_servicio);
        return {
          id_cita:            c.id_cita,
          fecha_hora_inicio:  c.fecha_hora_inicio,
          fecha_hora_fin:     c.fecha_hora_fin,
          fecha_larga:        fmtFechaLarga(c.fecha_hora_inicio),
          hora:               fmtHora(c.fecha_hora_inicio),
          hora_fin:           fmtHora(c.fecha_hora_fin),
          estado:             c.estado,
          servicio_nombre:    srv?.nombre || '—',
          precio:             srv?.precio || 0,
          barbero_nombre:     emp ? `${emp.nombre} ${emp.apellido}` : '—',
          notas:              c.notas,
        };
      });
  }

  function getHistorialCitas() {
    const estado = getEstado();
    const ahora = new Date().toISOString();
    return estado.citas
      .filter(c => c.id_cliente === 'cli-001' &&
                   ['completada','cancelada','no_presentada'].includes(c.estado) &&
                   c.fecha_hora_inicio < ahora)
      .sort((a, z) => z.fecha_hora_inicio.localeCompare(a.fecha_hora_inicio))
      .map(c => {
        const emp = getEmp(c.id_empleado);
        const srv = getSrv(c.id_servicio);
        return {
          id_cita:           c.id_cita,
          fecha_hora_inicio: c.fecha_hora_inicio,
          fecha_larga:       fmtFechaLarga(c.fecha_hora_inicio),
          hora:              fmtHora(c.fecha_hora_inicio),
          estado:            c.estado,
          servicio_nombre:   srv?.nombre || '—',
          precio:            srv?.precio || 0,
          barbero_nombre:    emp ? `${emp.nombre} ${emp.apellido}` : '—',
        };
      });
  }

  // ─── RPCs SIMULADAS ───────────────────────────────────────────────────────

  function authenticate(email, password) {
    const cred = CREDENTIALS.find(c => c.email.toLowerCase() === email.toLowerCase() && c.password === password);
    if (!cred) return null;
    return {
      id:       cred.id,
      email:    cred.email,
      nombre:   cred.nombre,
      apellido: cred.apellido,
      rol:      cred.rol,
      token:    'demo_' + Math.random().toString(36).slice(2, 10),
    };
  }

  function cambiarEstadoCita(idCita, nuevoEstado /*, motivo */) {
    const estado = getEstado();
    const cita = estado.citas.find(c => c.id_cita === idCita);
    if (!cita) return { ok: false, mensaje: 'Cita no encontrada' };

    cita.estado = nuevoEstado;

    const HOY = getHoy();
    if (nuevoEstado === 'en_curso') {
      estado.barberoStates[cita.id_empleado] = 'ocupado';
    } else if (['completada','cancelada','no_presentada'].includes(nuevoEstado)) {
      const siguiente = estado.citas.find(c =>
        c.id_empleado === cita.id_empleado && c.id_cita !== idCita &&
        (c.estado === 'en_espera' || c.estado === 'pendiente') &&
        c.fecha_hora_inicio.startsWith(HOY)
      );
      estado.barberoStates[cita.id_empleado] = siguiente ? 'en_espera' : 'libre';
    }

    setEstado(estado);
    return { ok: true };
  }

  function cancelarCita(idCita, motivo) {
    return cambiarEstadoCita(idCita, 'cancelada', motivo);
  }

  function registrarWalkin(nombre, telefono, idServicio, idEmpleadoOpt) {
    const estado = getEstado();
    const srv = getSrv(idServicio);

    let idEmp = idEmpleadoOpt;
    if (!idEmp) {
      const orden = { libre: 0, en_espera: 1, ocupado: 2, ausente: 99 };
      idEmp = EMPLEADOS_BASE
        .filter(e => e.rol === 'barbero' && (estado.barberoStates[e.id_empleado] || 'libre') !== 'ausente')
        .sort((a, b) => (orden[estado.barberoStates[a.id_empleado] || 'libre'] || 0) - (orden[estado.barberoStates[b.id_empleado] || 'libre'] || 0))[0]?.id_empleado || 'emp-002';
    }

    const ahora = new Date();
    const fin = new Date(ahora.getTime() + (srv?.duracion_min || 30) * 60000);
    const id = `cit-w${++estado.nextId}`;

    estado.citas.push({
      id_cita: id, id_cliente: null, id_empleado: idEmp, id_servicio: idServicio,
      id_sucursal: 'suc-001',
      fecha_hora_inicio: ahora.toISOString().slice(0, 19),
      fecha_hora_fin:    fin.toISOString().slice(0, 19),
      estado: 'en_espera', origen: 'walkin',
      nombre_walkin: nombre, telefono_walkin: telefono, notas: null,
    });

    if ((estado.barberoStates[idEmp] || 'libre') === 'libre') {
      estado.barberoStates[idEmp] = 'en_espera';
    }

    setEstado(estado);
    return id;
  }

  function agendarCita(payload) {
    // payload: { idCliente, nombre, apellido, telefono, email, idServicio, idEmpleado, idSucursal, fechaHoraInicio, notas }
    const estado = getEstado();
    const srv = getSrv(payload.idServicio);
    const fin = new Date(new Date(payload.fechaHoraInicio).getTime() + (srv?.duracion_min || 30) * 60000);
    const id = `cit-a${++estado.nextId}`;

    estado.citas.push({
      id_cita: id,
      id_cliente: payload.idCliente || null,
      id_empleado: payload.idEmpleado,
      id_servicio: payload.idServicio,
      id_sucursal: payload.idSucursal || 'suc-001',
      fecha_hora_inicio: payload.fechaHoraInicio,
      fecha_hora_fin:    fin.toISOString().slice(0, 19),
      estado: 'pendiente',
      origen: 'web',
      nombre_walkin: null,
      notas: payload.notas || null,
    });

    setEstado(estado);
    return { id_cita: id, token: 'demo_confirm_token_' + id };
  }

  function generarSlots(idEmpleado, fecha, duracionMin) {
    const estado = getEstado();
    const ocupadas = estado.citas.filter(c =>
      c.id_empleado === idEmpleado &&
      c.fecha_hora_inicio.startsWith(fecha) &&
      !['cancelada','no_presentada'].includes(c.estado)
    );

    const slots = [];
    const START = 10 * 60;
    const END   = 20 * 60;

    for (let min = START; min + duracionMin <= END; min += 15) {
      const hh = String(Math.floor(min / 60)).padStart(2, '0');
      const mm = String(min % 60).padStart(2, '0');
      const slotIso = `${fecha}T${hh}:${mm}:00`;
      const slotFin = new Date(new Date(slotIso).getTime() + duracionMin * 60000).toISOString().slice(0, 19);

      const bloqueado = ocupadas.some(c => c.fecha_hora_inicio < slotFin && c.fecha_hora_fin > slotIso);
      if (!bloqueado) slots.push({ hora: `${hh}:${mm}`, iso: slotIso });
    }
    return slots;
  }

  function actualizarPerfil(/* datos */) {
    return { ok: true };
  }

  // ─── API PÚBLICA ──────────────────────────────────────────────────────────
  return {
    // Catálogos
    CREDENCIALES:   CREDENTIALS,
    SUCURSAL,
    SERVICIOS,
    EMPLEADOS_BASE,
    CLIENTE_DEMO,
    // Estado
    getEstado,
    setEstado,
    resetEstado,
    // Helpers
    getHoy,
    fmtHora,
    fmtFechaLarga,
    getSrv,
    getEmp,
    // Vistas
    getPanelBarberos,
    getCitasDelDia,
    getColaWalkins,
    getProximasCitas,
    getHistorialCitas,
    // RPCs
    authenticate,
    cambiarEstadoCita,
    cancelarCita,
    registrarWalkin,
    agendarCita,
    generarSlots,
    actualizarPerfil,
  };
})();
