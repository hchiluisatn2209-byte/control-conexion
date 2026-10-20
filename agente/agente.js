// Agente de Control de Conexión — se instala en cada computador.
// Cada INTERVALO segundos verifica internet, GitHub, PostgreSQL y las páginas de trabajo, y envía un latido a Supabase.
// Cada 5 s mira qué aplicación está al frente: guarda solo el nombre de la app o del sitio (nunca contenido).
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
const { execFile, spawn } = require('node:child_process');
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
  if (process.platform === 'win32' && ultimaMuestra && Date.now() - ultimaMuestra.t < 30_000) return ultimaMuestra.idle;
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


// ---------- ajustes que manda el servidor (se actualizan en cada latido) ----------
const SERVIDOR = { paginas: [], registrar_uso: true, umbral_inactivo_seg: 600 };

// ---------- páginas de trabajo ----------
async function probarPaginas() {
  return Promise.all(SERVIDOR.paginas.slice(0, 10).map(async url => {
    const t = Date.now();
    try {
      const r = await conTiempo(fetch(url, { redirect: 'follow', cache: 'no-store', headers: { 'User-Agent': 'control-conexion-agente' } }), 10000);
      try { await r.body?.cancel(); } catch {}
      return { url, ok: r.status < 500, ms: Date.now() - t, detalle: `HTTP ${r.status}` };
    } catch (e) {
      const causa = e.cause?.code || e.cause?.message || e.message;
      // Certificado interno no reconocido: el servidor sí respondió
      if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(causa)) return { url, ok: true, ms: Date.now() - t, detalle: 'Responde (certificado interno)' };
      return { url, ok: false, ms: null, detalle: String(causa).slice(0, 120) };
    }
  }));
}

// ---------- aplicación / sitio en uso ----------
const NAVEGADORES = [['msedge', 'Edge'], ['microsoft edge', 'Edge'], ['chrome', 'Chrome'], ['firefox', 'Firefox'],
                     ['brave', 'Brave'], ['opera', 'Opera'], ['safari', 'Safari'], ['vivaldi', 'Vivaldi']];
const SUFIJOS = /\s*[-–—:]\s*(google chrome|microsoft​?\s*edge|mozilla firefox|brave|opera|vivaldi|personal|perfil \d+|profile \d+|trabajo|work)\s*$/i;

// Del título de la pestaña deja solo el nombre del sitio, p. ej. "Issues · org/repo · GitHub - Google Chrome" -> "GitHub"
function sitioDesdeTitulo(titulo) {
  let t = String(titulo || '').replace(/^\(\d+\+?\)\s*/, '');
  for (let i = 0; i < 3; i++) t = t.replace(SUFIJOS, '');
  t = t.replace(/\s+(y|and)\s+\d+\s+(páginas?|pages?)\s+(más|more)\s*$/i, '');
  const partes = t.split(/\s+[-–—|·•:]\s+/).map(x => x.trim()).filter(Boolean);
  if (!partes.length) return 'Nueva pestaña';
  const s = partes[partes.length - 1];
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}
function clasificar(m) {
  const proc = String(m.app || '').toLowerCase();
  const nav = NAVEGADORES.find(([k]) => proc === k || proc.includes(k));
  if (nav) return { app: nav[1], sitio: sitioDesdeTitulo(m.titulo) };
  if (!proc || proc === 'idle' || proc === 'lockapp' || proc === 'loginwindow') return null; // pantalla bloqueada
  if (proc === 'explorer' && !m.titulo) return { app: 'Escritorio', sitio: '' };
  return { app: String(m.desc || m.app).replace(/\.exe$/i, '').slice(0, 60), sitio: '' };
}

const uso = new Map();       // "app\tsitio" -> segundos acumulados desde el último envío
let ultimaMuestra = null;    // { idle, t } la última lectura del monitor
function sumarUso(m, seg) {
  ultimaMuestra = { idle: m.idle, t: Date.now() };
  if (!SERVIDOR.registrar_uso) return;
  if (m.idle != null && m.idle > SERVIDOR.umbral_inactivo_seg) return;   // inactivo: no cuenta
  const c = clasificar(m);
  if (!c) return;
  const k = `${c.app}\t${c.sitio}`;
  uso.set(k, (uso.get(k) || 0) + seg);
}

const MUESTRA_SEG = 5;
const PS_MONITOR = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [StructLayout(LayoutKind.Sequential)] struct L { public uint s; public uint t; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref L l);
  public static uint Idle() { L l = new L(); l.s = 8; GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.t) / 1000; }
}
'@
[Console]::OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  try {
    $h = [W]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 512
    [void][W]::GetWindowText($h, $sb, 512); [uint32]$procId = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$procId)
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $o = @{ app = "$($p.ProcessName)"; desc = "$($p.Description)"; titulo = $sb.ToString(); idle = [W]::Idle() }
    [Console]::WriteLine(($o | ConvertTo-Json -Compress))
  } catch {}
  Start-Sleep -Seconds ${MUESTRA_SEG}
}`;

function iniciarMonitor() {
  if (process.platform === 'win32') {
    const cod = Buffer.from(PS_MONITOR, 'utf16le').toString('base64');
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', cod], { windowsHide: true });
    let resto = '';
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', d => {
      const lineas = (resto + d).split(/\r?\n/); resto = lineas.pop();
      for (const l of lineas) { try { sumarUso(JSON.parse(l), MUESTRA_SEG); } catch {} }
    });
    ps.on('exit', () => setTimeout(iniciarMonitor, 30_000));   // si se cae, se reinicia
    ps.on('error', () => {});
    return;
  }
  // macOS: nombre de la app al frente (sin permisos especiales). Linux: xdotool, si está instalado.
  setInterval(async () => {
    try {
      const idle = await segundosInactivo();
      if (process.platform === 'darwin') {
        const { stdout } = await sh('lsappinfo', ['info', '-only', 'name', (await sh('lsappinfo', ['front'])).stdout.trim()]);
        const m = stdout.match(/"(?:LSDisplayName|name)"="([^"]+)"/i);
        sumarUso({ app: m ? m[1] : '', titulo: '', idle }, MUESTRA_SEG);
      } else if (process.platform === 'linux') {
        const titulo = (await sh('xdotool', ['getactivewindow', 'getwindowname'])).stdout.trim();
        const pid = (await sh('xdotool', ['getactivewindow', 'getwindowpid'])).stdout.trim();
        const app = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        sumarUso({ app, titulo, idle }, MUESTRA_SEG);
      }
    } catch {}
  }, MUESTRA_SEG * 1000);
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
    const [net, gh, db, inactivo, paginas] = await Promise.all([probarInternet(), probarGithub(), probarPostgres(), segundosInactivo(), probarPaginas()]);
    const enviado = [...uso.entries()].map(([k, seg]) => { const [app, sitio] = k.split('\t'); return { app, sitio, seg }; });
    const datos = { host: os.hostname(), ip: ipLocal(), ...net, ...gh, ...db, inactivo_seg: inactivo,
                    intervalo: INTERVALO / 1000, paginas: paginas.length ? paginas : null, uso: enviado };
    const resp = await enviar(datos);
    for (const u of enviado) {                          // descuenta lo enviado; lo nuevo sigue acumulando
      const k = `${u.app}\t${u.sitio}`, resto = (uso.get(k) || 0) - u.seg;
      resto > 0 ? uso.set(k, resto) : uso.delete(k);
    }
    if (Array.isArray(resp.paginas)) {
      const nuevas = resp.paginas.join() !== SERVIDOR.paginas.join();
      SERVIDOR.paginas = resp.paginas;
      if (nuevas && resp.paginas.length) setTimeout(latido, 5000);   // lista nueva: revisarla ya
    }
    if (typeof resp.registrar_uso === 'boolean') SERVIDOR.registrar_uso = resp.registrar_uso;
    if (resp.umbral_inactivo_seg) SERVIDOR.umbral_inactivo_seg = resp.umbral_inactivo_seg;
    const m = v => (v === true ? 'OK' : v === false ? 'FALLA' : '—');
    const pags = paginas.length ? ` · páginas ${paginas.filter(p => p.ok).length}/${paginas.length}` : '';
    log(`internet ${m(datos.internet_ok)} · GitHub ${m(datos.github_ok)} · PostgreSQL ${m(datos.postgres_ok)}${pags} · jornada ${resp.trabajando ? 'iniciada' : 'sin iniciar'}`);
  } catch (e) {
    log(`No se pudo enviar el latido: ${e.message}`);
  } finally { pendiente = false; }
}

log(`Agente iniciado en ${os.hostname()} · reporta cada ${INTERVALO / 1000} s`);
iniciarMonitor();
latido();
setInterval(latido, INTERVALO);
