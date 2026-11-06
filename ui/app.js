// Utilitas antarmuka bersama (tanpa pustaka luar).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Templat aman: nilai di-escape kecuali dibungkus raw().
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      const isRaw = (x) => x !== null && typeof x === 'object' && '__raw' in x;
      if (isRaw(v)) out += v.__raw;
      else if (Array.isArray(v)) out += v.map((x) => (isRaw(x) ? x.__raw : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return { __raw: out };
}
export const raw = (s) => ({ __raw: String(s) });
export function render(el, tpl) {
  el.innerHTML = tpl.__raw ?? tpl;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.pesan || 'Permintaan gagal.');
    this.status = status;
    this.code = body?.galat;
  }
}

export async function api(path, { method = 'GET', body, base = '', timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: base ? 'omit' : 'same-origin',
      signal: ctl.signal,
    });
  } catch (e) {
    const err = new ApiError(0, { pesan: 'Tidak tersambung ke server. Cek Wi-Fi sekolah, lalu coba lagi.', galat: 'jaringan' });
    err.network = true;
    throw err;
  } finally {
    clearTimeout(t);
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'object' ? data : { pesan: 'Server membalas dengan galat.' });
  return data;
}

let toastHost;
export function toast(msg, kind = '') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3500);
}

export async function withBusy(btn, fn) {
  if (btn) {
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    return await fn();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
    }
  }
}

// ---------- Format Indonesia ----------
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const hari = (n) => HARI[n];
export function tanggal(iso, { jam = false, hari: withDay = false } = {}) {
  if (!iso) return '–';
  const d = new Date(iso);
  let s = `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
  if (withDay) s = `${HARI[d.getDay()]}, ${s}`;
  if (jam) s += `, ${jam2(d)}`;
  return s;
}
export function jam2(d) {
  d = d instanceof Date ? d : new Date(d);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
export function lalu(iso) {
  if (!iso) return 'belum pernah';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}
export const angka = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const persen = (n, d = 0) => (n === null || n === undefined ? '–' : `${angka(n, d)}%`);

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- Kotak keluar (US-3): tindakan tersimpan di tablet saat Wi-Fi putus ----------
const OUTBOX_KEY = 'lentera.outbox.v1';
const listeners = new Set();
function readOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeOutbox(items) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  listeners.forEach((fn) => fn(items.length));
}
export const outbox = {
  count: () => readOutbox().length,
  onChange(fn) {
    listeners.add(fn);
    fn(readOutbox().length);
  },
  // Kirim sekarang; bila jaringan putus, simpan dan coba lagi otomatis.
  async send(path, method, body, label) {
    try {
      return { ok: true, data: await api(path, { method, body }) };
    } catch (e) {
      if (!e.network) throw e;
      const items = readOutbox();
      items.push({ id: uuid(), path, method, body, label, at: new Date().toISOString() });
      writeOutbox(items);
      return { ok: false, queued: true };
    }
  },
  async flush() {
    const items = readOutbox();
    if (!items.length) return 0;
    const left = [];
    let sent = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        await api(it.path, { method: it.method, body: it.body });
        sent++;
      } catch (e) {
        if (e.network) {
          left.push(...items.slice(i));
          break;
        }
        // galat data (mis. sesi sudah ditutup): buang agar antrean tidak macet
      }
    }
    writeOutbox(left);
    return sent;
  },
};
setInterval(() => outbox.flush().catch(() => {}), 8000);
window.addEventListener('online', () => outbox.flush().catch(() => {}));

// ---------- Ikon (SVG garis, 24px) ----------
const P = {
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M2 9a14.5 14.5 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10v4"/>',
  temp: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  drop: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.7-4.3L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4.3L21 15"/><path d="M21 20v-5h-5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l4-4-4-4M14 12H4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.5-1.5a4 4 0 0 1-5-5L13 5z" transform="translate(-2 -1)"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5"/><path d="M5 4h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  megaphone: '<path d="M3 10v4h4l7 4V6L7 10z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
}

export const BRAND_MARK = raw(`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="9" fill="var(--brand)"/>
  <path d="M11 9h10M12.5 9v2.2M19.5 9v2.2" stroke="oklch(1 0 0)" stroke-width="2" stroke-linecap="round"/>
  <path d="M10.5 12.5h11l-1.2 9.5a2 2 0 0 1-2 1.7h-4.6a2 2 0 0 1-2-1.7z" fill="none" stroke="oklch(1 0 0)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M16 15.5c1.6 1.6 1.9 2.9 1.9 3.7a1.9 1.9 0 0 1-3.8 0c0-.8.3-2.1 1.9-3.7z" fill="var(--flame)"/>
</svg>`);
