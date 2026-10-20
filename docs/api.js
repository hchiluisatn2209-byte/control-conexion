// Llamadas a las funciones de Supabase
const CFG = window.CONFIG || {};
const CONFIGURADO = !!CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('TU-PROYECTO') && !!CFG.SUPABASE_KEY && !CFG.SUPABASE_KEY.startsWith('TU-');

async function rpc(fn, args = {}) {
  if (!CONFIGURADO) throw new Error('Falta configurar config.js con la URL y la clave de Supabase.');
  const cab = { apikey: CFG.SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (CFG.SUPABASE_KEY.startsWith('eyJ')) cab.Authorization = 'Bearer ' + CFG.SUPABASE_KEY; // clave "anon" antigua
  let r;
  try {
    r = await fetch(`${CFG.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers: cab, body: JSON.stringify(args) });
  } catch { throw new Error('No hay conexión con Supabase. Revisa tu internet o la URL en config.js.'); }
  const texto = await r.text();
  let j; try { j = JSON.parse(texto); } catch { j = texto; }
  if (!r.ok) {
    const msg = j?.message || `Error ${r.status}`;
    if (/Could not find the function|PGRST202/.test(msg)) throw new Error('Supabase no encuentra las funciones: ejecuta supabase/instalar.sql (paso 2 de la guía).');
    if (/Invalid API key|No API key/i.test(msg)) throw new Error('La clave de Supabase en config.js no es válida.');
    throw new Error(msg);
  }
  return j;
}

function aviso_sin_config() {
  if (CONFIGURADO) return;
  const d = document.createElement('div');
  d.style.cssText = 'background:var(--warn-bg);color:var(--warn);padding:10px 16px;font-size:14px;text-align:center';
  d.textContent = 'Falta configurar docs/config.js con la URL y la clave de tu proyecto de Supabase.';
  document.body.prepend(d);
}

function leer(k, almacen = localStorage) { try { return almacen.getItem(k); } catch { return null; } }
function guardar(k, v, almacen = localStorage) { try { v == null ? almacen.removeItem(k) : almacen.setItem(k, v); } catch {} }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Duración legible: "2 h 05 m", "15 min", "< 1 min"
function duracion(seg) {
  seg = Math.round(seg || 0);
  if (seg < 60) return '< 1 min';
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  return `${Math.floor(seg / 3600)} h ${String(Math.floor(seg % 3600 / 60)).padStart(2, '0')} m`;
}
const hora = f => f ? new Date(f).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

// Lista con barras de aplicaciones / sitios: [{app, sitio, segundos, personas?}]
function listaUso(items, limite = 15) {
  if (!items?.length) return '<p class="suave" style="margin:0">Aún no hay datos de uso hoy.</p>';
  const max = Math.max(...items.map(u => u.segundos));
  return items.slice(0, limite).map(u => `
    <div class="uso">
      <span class="nom" title="${esc(u.sitio ? `${u.sitio} (${u.app})` : u.app)}">${u.sitio ? `${esc(u.sitio)} <small>· ${esc(u.app)}</small>` : esc(u.app)}</span>
      <span class="num">${duracion(u.segundos)}${u.personas ? ` <small class="suave">· ${u.personas} pers.</small>` : ''}</span>
      <span class="barra"><i style="width:${Math.max(2, Math.round(u.segundos / max * 100))}%"></i></span>
    </div>`).join('');
}
const host = url => { try { return new URL(url).host; } catch { return url; } };
