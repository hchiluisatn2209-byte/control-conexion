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
