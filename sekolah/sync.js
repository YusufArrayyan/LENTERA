// Sinkronisasi simpan-lalu-teruskan (F-3.1–F-3.3, PRD 8.3).
import { sealPacket, verifyUpdate, canonical } from '../shared/packet.js';
import { getMeta, setMeta } from './db.js';
import { atomic, emit } from './core.js';
import crypto from 'node:crypto';

export const PACKET_LIMIT = 4000;

export function pendingCount(ctx) {
  return ctx.db.prepare('SELECT COUNT(*) n FROM events WHERE acked = 0').get().n;
}

export function buildPacket(ctx, limit = PACKET_LIMIT) {
  const rows = ctx.db.prepare('SELECT event_id, device_id, seq, type, ts, payload FROM events WHERE acked = 0 ORDER BY seq LIMIT ?').all(limit);
  const events = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  const env = sealPacket({
    deviceId: ctx.cfg.device_id,
    events,
    syncKeyHex: ctx.cfg.keys.sync_key_hex,
    privateKeyPem: ctx.cfg.keys.private_key_pem,
    meta: { school_id: ctx.cfg.school.school_id, sw_version: ctx.cfg.sw_version || '1.0.0', sisa: pendingCount(ctx) - events.length },
  });
  return { env, count: events.length };
}

// Tanda terima dari pusat ditandatangani kunci pusat, sehingga ponsel relawan
// tidak bisa memalsukan status "sudah terkirim".
export function verifyReceipt(ctx, receipt) {
  if (!receipt || receipt.device_id !== ctx.cfg.device_id || !Array.isArray(receipt.acked_event_ids)) return false;
  return verifyUpdate(receipt, ctx.cfg.pusat.public_key_pem);
}

export function applyAck(ctx, ids) {
  const now = new Date().toISOString();
  let n = 0;
  atomic(ctx.db, () => {
    const st = ctx.db.prepare('UPDATE events SET acked = 1, acked_at = ? WHERE event_id = ? AND acked = 0');
    for (const id of ids) n += Number(st.run(now, id).changes);
    setMeta(ctx.db, 'last_ack', now);
  });
  return n;
}

export function applyReceipt(ctx, receipt, via) {
  if (!verifyReceipt(ctx, receipt)) {
    const e = new Error('Tanda terima tidak sah. Ulangi pengiriman dari ponsel relawan.');
    e.status = 400;
    e.code = 'tanda_terima_salah';
    throw e;
  }
  const n = applyAck(ctx, receipt.acked_event_ids);
  setMeta(ctx.db, 'last_sync', { at: new Date().toISOString(), via, events: n });
  const updates = Array.isArray(receipt.updates) ? receipt.updates : [];
  const applied = applyUpdates(ctx, updates);
  return { ditandai: n, pembaruan: applied };
}

// Pembaruan dari pusat: ambang, pengumuman, jadwal. Diverifikasi sebelum dipasang.
export function applyUpdates(ctx, updates) {
  let applied = 0;
  for (const u of updates) {
    if (!verifyUpdate(u, ctx.cfg.pusat.public_key_pem)) continue;
    if (u.target && u.target !== '*' && u.target !== ctx.cfg.device_id) continue;
    if (ctx.db.prepare('SELECT 1 FROM updates WHERE update_id = ?').get(u.update_id)) continue;
    atomic(ctx.db, () => {
      ctx.db.prepare('INSERT INTO updates(update_id, kind, payload, received_at, applied_at) VALUES (?,?,?,?,?)').run(
        u.update_id, u.kind, JSON.stringify(u.payload), new Date().toISOString(), new Date().toISOString()
      );
      if (u.kind === 'ambang') setMeta(ctx.db, 'thresholds', { ...(getMeta(ctx.db, 'thresholds', {}) || {}), ...u.payload });
      if (u.kind === 'pengumuman') setMeta(ctx.db, 'pengumuman', { teks: String(u.payload.teks || '').slice(0, 500), dari: u.payload.dari || 'Koordinator', at: u.created_at });
      if (u.kind === 'jadwal' && Array.isArray(u.payload.hari)) setMeta(ctx.db, 'jadwal', u.payload.hari);
      emit(ctx, 'update.applied', { update_id: u.update_id, kind: u.kind });
    });
    applied++;
  }
  if (updates.length) {
    const maxSince = updates.map((u) => u.created_at).filter(Boolean).sort().pop();
    if (maxSince) setMeta(ctx.db, 'updates_since', maxSince);
  }
  return applied;
}

// Pengiriman otomatis bila ada jalur internet ke pusat.
export async function pushToPusat(ctx, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const url = ctx.cfg.pusat?.url;
  if (!url) return { ok: false, alasan: 'Alamat pusat belum diatur.' };
  let total = 0;
  for (let round = 0; round < 50; round++) {
    const { env, count } = buildPacket(ctx);
    if (count === 0 && round > 0) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${url}/sync/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packet: env, since: getMeta(ctx.db, 'updates_since', null), via: 'otomatis' }),
        signal: ctl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      setMeta(ctx.db, 'last_sync_attempt', { at: new Date().toISOString(), ok: false, alasan: 'Pusat tidak terjangkau.' });
      return { ok: false, alasan: 'Pusat tidak terjangkau.', terkirim: total };
    }
    clearTimeout(timer);
    if (!res.ok) {
      setMeta(ctx.db, 'last_sync_attempt', { at: new Date().toISOString(), ok: false, alasan: `Pusat menolak (${res.status}).` });
      return { ok: false, alasan: `Pusat menolak paket (${res.status}).`, terkirim: total };
    }
    const receipt = await res.json();
    const r = applyReceipt(ctx, receipt, 'otomatis');
    total += r.ditandai;
    setMeta(ctx.db, 'last_sync_attempt', { at: new Date().toISOString(), ok: true });
    if (count < PACKET_LIMIT) break;
  }
  return { ok: true, terkirim: total };
}

export function syncSummary(ctx) {
  return {
    belum_terkirim: pendingCount(ctx),
    terakhir: getMeta(ctx.db, 'last_sync', null),
    percobaan_terakhir: getMeta(ctx.db, 'last_sync_attempt', null),
  };
}

export function packetDigest(env) {
  return crypto.createHash('sha256').update(canonical(env)).digest('hex').slice(0, 12);
}
