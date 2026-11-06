// Grafik garis SVG kecil untuk telemetri. Satu seri per grafik; garis ambang diberi label teks.
import { esc } from './app.js';

export function lineChart(points, { min, max, unit = '', color = 'var(--brand)', thresholds = [], height = 160, label = 'Grafik', fmt = (v) => v } = {}) {
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 26;
  if (!points.length) return `<p class="muted small">Belum ada data untuk rentang waktu ini.</p>`;
  const t0 = Date.parse(points[0].t), t1 = Date.parse(points[points.length - 1].t) || t0 + 1;
  const vals = points.map((p) => p.v).filter((v) => v !== null && v !== undefined);
  const lo = min ?? Math.floor(Math.min(...vals) - 1), hi = max ?? Math.ceil(Math.max(...vals) + 1);
  const x = (t) => L + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - T - B);
  // putus garis bila jeda > 40 menit (server mati)
  let d = '', prev = null;
  for (const p of points) {
    if (p.v === null || p.v === undefined) { prev = null; continue; }
    const gap = prev && Date.parse(p.t) - Date.parse(prev.t) > 40 * 60000;
    d += `${!prev || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    prev = p;
  }
  const ticks = [4, 5, 3, 6, 2].find((n) => Number.isInteger((hi - lo) / n)) || 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" />
      <text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--ink-2)">${esc(fmt(Number.isInteger(v) ? v : Math.round(v * 10) / 10))}</text>`;
  }
  const days = new Set();
  let xl = '';
  const span = t1 - t0;
  const step = span > 3 * 86400000 ? 86400000 : span > 86400000 ? 12 * 3600000 : 3 * 3600000;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    const dt = new Date(t);
    const lbl = step >= 86400000 ? `${dt.getDate()}/${dt.getMonth() + 1}` : `${String(dt.getHours()).padStart(2, '0')}.00`;
    if (days.has(lbl)) continue;
    days.add(lbl);
    const xx = L + ((t - t0) / Math.max(1, span)) * (W - L - R);
    xl += `<text x="${xx}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${lbl}</text>`;
  }
  const th = thresholds
    .filter((t) => t.v >= lo && t.v <= hi)
    .map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t.v)}" y2="${y(t.v)}" stroke="${t.color || 'var(--warn)'}" stroke-dasharray="5 4" stroke-width="1.5"/>
      <text x="${W - R}" y="${y(t.v) - 5}" text-anchor="end" font-size="11" font-weight="700" fill="${t.color || 'var(--warn-ink)'}">${esc(t.label)}</text>`)
    .join('');
  const last = [...points].reverse().find((p) => p.v !== null && p.v !== undefined);
  const lastDot = last ? `<circle cx="${x(last.t)}" cy="${y(last.v)}" r="4" fill="${color}"><title>${esc(fmt(last.v))}${unit} · ${new Date(last.t).toLocaleString('id-ID')}</title></circle>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}" style="display:block">${grid}${th}${xl}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${lastDot}</svg>`;
}

// Batang horizontal untuk sebaran (mis. murid per level).
export function barList(rows, { max, color = 'var(--brand)' } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.v));
  return `<div class="bars">${rows
    .map((r) => `<div class="bar-row"><span class="bar-k">${esc(r.k)}</span><span class="bar-track"><span class="bar-fill" style="width:${(r.v / m) * 100}%;background:${r.color || color}"></span></span><span class="bar-v">${esc(r.label ?? r.v)}</span></div>`)
    .join('')}</div>`;
}
