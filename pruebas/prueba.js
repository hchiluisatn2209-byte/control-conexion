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

    const est = await rpc('admin_estado', { p_clave: CLAVE });
    const fila = est.empleados.find(e => e.email === email);
    assert.ok(fila);
    assert.equal((await rpc('admin_dia', { p_clave: CLAVE, p_id: fila.id })).length, 1);
    assert.equal(await rpc('admin_token', { p_clave: CLAVE, p_id: fila.id }), token);
    assert.ok((await rpc('admin_tokens', { p_clave: CLAVE })).some(t => t.token === token));

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
