// Agente de Control de Conexión — se instala en cada computador.
// Cada INTERVALO segundos verifica internet, GitHub y PostgreSQL y envía un latido a Supabase.
//
// Configuración: archivo agente.conf en la misma carpeta (el panel de administración lo genera):
//   SUPABASE_URL  URL del proyecto de Supabase
//   SUPABASE_KEY  clave pública (publishable / anon) de Supabase
//   TOKEN         token de la persona
//   PG_URL        base PostgreSQL de trabajo que debe alcanzar (opcional)
//   GITHUB_REPO   repositorio que debe poder leer, p. ej. miempresa/backend (opcional)
//   GITHUB_TOKEN  token personal de GitHub, solo si el repositorio es privado (opcional)
//   INTERVALO     segundos entre latidos (60 por defecto)
// Las variables de entorno con el mismo nombre tienen prioridad.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const pg = require('pg');

const sh = promisify(execFile);
const CARPETA = path.dirname(process.pkg ? process.execPath : path.resolve(process.argv[1] || '.'));
const ARCHIVO_LOG = path.join(CARPETA, 'agente.log');

// ---------- configuración ----------
function leerConf() {
  const conf = {};
  const archivo = path.join(CARPETA, 'agente.conf');
  if (fs.existsSync(archivo)) {
    for (const linea of fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) conf[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const k of ['SUPABASE_URL', 'SUPABASE_KEY', 'TOKEN', 'PG_URL', 'GITHUB_REPO', 'GITHUB_TOKEN', 'INTERVALO'])
    if (process.env[k]) conf[k] = process.env[k];
  return conf;
}
const C = leerConf();
const INTERVALO = Math.max(30, Number(C.INTERVALO) || 60) * 1000;

function log(texto) {
  const linea = `[${new Date().toLocaleString()}] ${texto}`;
  console.log(linea);
  try {
    if (fs.existsSync(ARCHIVO_LOG) && fs.statSync(ARCHIVO_LOG).size > 1_000_000) fs.renameSync(ARCHIVO_LOG, ARCHIVO_LOG + '.1');
    fs.appendFileSync(ARCHIVO_LOG, linea + os.EOL);
  } catch {}
}

if (!C.SUPABASE_URL || !C.SUPABASE_KEY || !C.TOKEN) {
  log(`Falta configuración. Coloca agente.conf (con SUPABASE_URL, SUPABASE_KEY y TOKEN) en: ${CARPETA}`);
  process.exit(1);
}

// ---------- verificaciones ----------
function conTiempo(promesa, ms = 8000) {
  return Promise.race([promesa, new Promise((_, r) => setTimeout(() => r(new Error(`sin respuesta en ${ms / 1000} s`)), ms))]);
}

async function probarInternet() {
  const t = Date.now();
  try {
    await conTiempo(fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' }));
    return { internet_ok: true, latencia_ms: Date.now() - t };
  } catch { return { internet_ok: false, latencia_ms: null }; }
}

async function probarGithub() {
  try {
    const cab = { Accept: 'application/vnd.github+json', 'User-Agent': 'control-conexion-agente' };
    if (C.GITHUB_TOKEN) cab.Authorization = `Bearer ${C.GITHUB_TOKEN}`;
    const url = C.GITHUB_REPO ? `https://api.github.com/repos/${C.GITHUB_REPO}` : 'https://api.github.com/zen';
    const r = await conTiempo(fetch(url, { headers: cab }));
    let git = 'git no instalado';
    try { git = (await sh('git', ['--version'])).stdout.trim(); } catch {}
    if (r.status === 404 && C.GITHUB_REPO) return { github_ok: false, github_detalle: `Sin acceso a ${C.GITHUB_REPO} (¿repo privado sin GITHUB_TOKEN?) · ${git}` };
    if (!r.ok) return { github_ok: false, github_detalle: `GitHub respondió ${r.status} · ${git}` };
    return { github_ok: true, github_detalle: `${C.GITHUB_REPO || 'GitHub'} accesible · ${git}` };
  } catch (e) { return { github_ok: false, github_detalle: e.message }; }
}

async function probarPostgres() {
  if (!C.PG_URL) return { postgres_ok: null, postgres_detalle: 'No configurado (PG_URL vacío)' };
  const c = new pg.Client({ connectionString: C.PG_URL, connectionTimeoutMillis: 6000 });
  const t = Date.now();
  try {
    await c.connect();
    const { rows } = await c.query('select current_database() as db, version() as v');
    return { postgres_ok: true, postgres_detalle: `${rows[0].db} · ${Date.now() - t} ms · ${rows[0].v.split(' ').slice(0, 2).join(' ')}` };
  } catch (e) { return { postgres_ok: false, postgres_detalle: e.message }; }
  finally { c.end().catch(() => {}); }
}

// Segundos sin teclado ni ratón (null si el sistema no lo permite)
async function segundosInactivo() {
  try {
    if (process.platform === 'win32') {
      const ps = `Add-Type @'
using System; using System.Runtime.InteropServices;
public class I { [StructLayout(LayoutKind.Sequential)] struct L { public uint s; public uint t; }
[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref L l);
public static uint S() { L l = new L(); l.s = 8; GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.t) / 1000; } }
'@; [I]::S()`;
      const { stdout } = await sh('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
      return Number(stdout.trim());
    }
    if (process.platform === 'darwin') {
      const { stdout } = await sh('ioreg', ['-c', 'IOHIDSystem']);
      const m = stdout.match(/"HIDIdleTime" = (\d+)/);
      return m ? Math.round(Number(m[1]) / 1e9) : null;
    }
    if (process.platform === 'linux') {
      const { stdout } = await sh('xprintidle');
      return Math.round(Number(stdout) / 1000);
    }
  } catch {}
  return null;
}

function ipLocal() {
  for (const lista of Object.values(os.networkInterfaces()))
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return null;
}

// ---------- envío ----------
async function enviar(datos) {
  const cab = { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (C.SUPABASE_KEY.startsWith('eyJ')) cab.Authorization = `Bearer ${C.SUPABASE_KEY}`;
  const r = await conTiempo(fetch(`${C.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/latido`, {
    method: 'POST', headers: cab, body: JSON.stringify({ p_token: C.TOKEN, p_datos: datos })
  }), 10000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Supabase respondió ${r.status}`);
  return j;
}

let pendiente = false;
async function latido() {
  if (pendiente) return;
  pendiente = true;
  try {
    const [net, gh, db, inactivo] = await Promise.all([probarInternet(), probarGithub(), probarPostgres(), segundosInactivo()]);
    const datos = { host: os.hostname(), ip: ipLocal(), ...net, ...gh, ...db, inactivo_seg: inactivo };
    const resp = await enviar(datos);
    const m = v => (v === true ? 'OK' : v === false ? 'FALLA' : '—');
    log(`internet ${m(datos.internet_ok)} · GitHub ${m(datos.github_ok)} · PostgreSQL ${m(datos.postgres_ok)} · jornada ${resp.trabajando ? 'iniciada' : 'sin iniciar'}`);
  } catch (e) {
    log(`No se pudo enviar el latido: ${e.message}`);
  } finally { pendiente = false; }
}

log(`Agente iniciado en ${os.hostname()} · reporta cada ${INTERVALO / 1000} s`);
latido();
setInterval(latido, INTERVALO);
