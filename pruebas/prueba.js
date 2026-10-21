// Prueba las funciones SQL tal como las llamaría Supabase (rol "anon").
// Uso: DATABASE_URL=postgres://... ADMIN_CLAVE=... node pruebas/prueba.js
const assert = require('node:assert/strict');
const pg = require('pg');

const CLAVE = process.env.ADMIN_CLAVE || 'clave-de-prueba-123';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function rpc(fn, args) {
  const nombres = Object.keys(args);
  const sql = `select public.${fn}(${nombres.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  await db.query('set role anon');
  try { return (await db.query(sql, Object.values(args))).rows[0].r; }
  finally { await db.query('reset role'); }
}
async function falla(promesa, texto) {
  await assert.rejects(promesa, e => e.message.includes(texto));
}

(async () => {
  await db.connect();
  try {
    // anon no puede leer las tablas directamente
    await db.query('set role anon');
    await falla(db.query('select * from privado.empleados'), 'permission denied');
    await db.query('reset role');

    await falla(rpc('admin_estado', { p_clave: 'mala' }), 'Clave de administrador incorrecta');

    const email = `prueba${Date.now()}@test.com`;
    const nuevo = await rpc('admin_crear_empleado', { p_clave: CLAVE, p_nombre: 'Prueba', p_email: email, p_equipo: 'QA' });
    const token = nuevo.token_agente;
    assert.equal(token.length, 48);

    await falla(rpc('yo', { p_token: 'malo' }), 'Token no válido');
    assert.equal((await rpc('yo', { p_token: token })).estado, 'desconectado');

    await rpc('latido', { p_token: token, p_datos: { host: 'pc', internet_ok: true, github_ok: true, postgres_ok: true, inactivo_seg: 3 } });
    assert.equal((await rpc('yo', { p_token: token })).estado, 'pausa');

    await rpc('iniciar_jornada', { p_token: token });
    const yo = await rpc('yo', { p_token: token });
    assert.equal(yo.estado, 'conectado');
    assert.equal(yo.jornada.fin, null);

    await rpc('latido', { p_token: token, p_datos: { host: 'pc', internet_ok: true, inactivo_seg: 900 } });
    assert.equal((await rpc('yo', { p_token: token })).estado, 'inactivo');

    // v2: ajustes centrales, uso de aplicaciones, páginas de trabajo y tiempo conectado
    await falla(rpc('admin_guardar_ajustes', { p_clave: CLAVE, p_paginas: ['intranet sin http'], p_registrar_uso: true }), 'http');
    await rpc('admin_guardar_ajustes', { p_clave: CLAVE, p_paginas: ['https://intranet.ejemplo.com', ''], p_registrar_uso: true });
    const resp = await rpc('latido', { p_token: token, p_datos: { host: 'pc', internet_ok: true, inactivo_seg: 5, intervalo: 60,
      paginas: [{ url: 'https://intranet.ejemplo.com', ok: true, ms: 120 }],
      uso: [{ app: 'Chrome', sitio: 'GitHub', seg: 50 }, { app: 'Excel', sitio: '', seg: 10 }] } });
    assert.deepEqual(resp.paginas, ['https://intranet.ejemplo.com']);
    assert.equal(resp.registrar_uso, true);
    assert.equal((await rpc('yo', { p_token: token })).paginas[0].ok, true);
    await rpc('latido', { p_token: token, p_datos: { host: 'pc', uso: [{ app: 'Chrome', sitio: 'GitHub', seg: 30 }] } });
    const yo2 = await rpc('yo', { p_token: token });
    assert.equal(yo2.uso[0].sitio, 'GitHub');
    assert.equal(yo2.uso[0].segundos, 80, 'el tiempo se acumula');
    assert.ok(yo2.conectado_seg >= 180);
    assert.ok(yo2.primera_conexion);
    await rpc('admin_guardar_ajustes', { p_clave: CLAVE, p_paginas: [], p_registrar_uso: false });
    await rpc('latido', { p_token: token, p_datos: { host: 'pc', uso: [{ app: 'Chrome', sitio: 'GitHub', seg: 30 }] } });
    assert.equal((await rpc('yo', { p_token: token })).uso[0].segundos, 80, 'con registrar_uso=false no se guarda');
    await rpc('admin_guardar_ajustes', { p_clave: CLAVE, p_paginas: [], p_registrar_uso: true });

    const est = await rpc('admin_estado', { p_clave: CLAVE });
    const fila = est.empleados.find(e => e.email === email);
    assert.ok(fila);
    assert.ok((await rpc('admin_dia', { p_clave: CLAVE, p_id: fila.id })).length >= 1);
    assert.equal(await rpc('admin_token', { p_clave: CLAVE, p_id: fila.id }), token);
    assert.ok((await rpc('admin_tokens', { p_clave: CLAVE })).some(t => t.token === token));
    assert.equal((await rpc('admin_uso', { p_clave: CLAVE, p_id: fila.id })).length, 2);
    assert.ok((await rpc('admin_uso_equipo', { p_clave: CLAVE })).some(u => u.sitio === 'GitHub'));

    const masivo = await rpc('admin_cargar_empleados', { p_clave: CLAVE, p_lista: JSON.stringify([
      { nombre: 'A', email: `a${Date.now()}@t.com` }, { nombre: '', email: 'x@t.com' }, { nombre: 'B', email: `b${Date.now()}@t.com`, equipo: 'Datos' }]) });
    assert.equal(masivo.length, 2);
    // ciudad: se guarda en mayúsculas y una recarga sin github_user/ciudad no borra lo que ya había
    const em = `c${Date.now()}@t.com`;
    await rpc('admin_cargar_empleados', { p_clave: CLAVE, p_lista: JSON.stringify([{ ciudad: 'uio', nombre: 'C', email: em, github_user: 'gh-c' }]) });
    await rpc('admin_cargar_empleados', { p_clave: CLAVE, p_lista: JSON.stringify([{ ciudad: '', nombre: 'C2', email: em, github_user: '' }]) });
    const c = (await rpc('admin_estado', { p_clave: CLAVE })).empleados.find(e => e.email === em);
    assert.equal(c.ciudad, 'UIO'); assert.equal(c.github_user, 'gh-c'); assert.equal(c.nombre, 'C2');
    const nuevo2 = await rpc('admin_crear_empleado', { p_clave: CLAVE, p_nombre: 'D', p_email: `d${Date.now()}@t.com`, p_ciudad: 'gye' });
    assert.equal(nuevo2.ciudad, 'GYE');

    // reporte por fecha y fechas disponibles
    const rep = await rpc('admin_reporte', { p_clave: CLAVE });
    assert.ok(Array.isArray(rep.empleados) && rep.empleados.length);
    const miRep = rep.empleados.find(x => x.email === email);
    assert.ok(miRep.conectado_seg >= 60, 'el reporte trae segundos conectados');
    assert.ok(Array.isArray(rep.uso));
    const fechas = await rpc('admin_fechas', { p_clave: CLAVE });
    assert.ok(fechas.length >= 1, 'hay al menos una fecha con datos');
    const repAyer = await rpc('admin_reporte', { p_clave: CLAVE, p_dia: '2020-01-01' });
    assert.equal(repAyer.empleados.find(x => x.email === email).conectado_seg, 0, 'día sin datos: 0 segundos');
    assert.ok(Array.isArray(await rpc('admin_dia', { p_clave: CLAVE, p_id: fila.id, p_dia: '2020-01-01' })));

    // Regresión zona horaria: un latido de las 23:00 locales de HOY debe contarse en el reporte,
    // aunque la sesión de la base esté en UTC (como ocurre en Supabase).
    await db.query("set timezone='UTC'");
    await db.query(`insert into privado.latidos (empleado_id, recibido_en, internet_ok, trabajando, intervalo_seg)
      values ($1, (privado.dia_hoy()::timestamp + time '23:00') at time zone (select zona_horaria from privado.ajustes), true, true, 60)`, [fila.id]);
    const repTarde = (await rpc('admin_reporte', { p_clave: CLAVE })).empleados.find(x => x.email === email);
    assert.ok(repTarde.conectado_seg >= 60, 'el latido nocturno se cuenta en el reporte del día (zona horaria)');
    await db.query('reset timezone');

    await rpc('terminar_jornada', { p_token: token });
    assert.equal((await rpc('yo', { p_token: token })).estado, 'pausa');

    const nuevoToken = await rpc('admin_renovar_token', { p_clave: CLAVE, p_id: fila.id });
    await falla(rpc('yo', { p_token: token }), 'Token no válido');
    await rpc('admin_desactivar_empleado', { p_clave: CLAVE, p_id: fila.id });
    await falla(rpc('yo', { p_token: nuevoToken }), 'Token no válido');

    console.log('✔ Todas las pruebas pasaron');
  } catch (e) {
    console.error('✘', e.message); process.exitCode = 1;
  } finally { await db.end(); }
})();
