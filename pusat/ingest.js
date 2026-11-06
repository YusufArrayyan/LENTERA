// Penggabungan idempoten (F-3.3): kejadian dengan event_id yang sudah ada diabaikan.
import { openPacket, signUpdate, PacketError } from '../shared/packet.js';
import { ptx } from './db.js';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lookupDevice(db) {
  return (id) => {
    const d = db.prepare('SELECT public_key_pem, sync_key_hex FROM devices WHERE device_id = ?').get(id);
    return d ? { publicKeyPem: d.public_key_pem, syncKeyHex: d.sync_key_hex } : null;
  };
}

export function pendingUpdates(db, deviceId, since) {
  const rows = db
    .prepare(`SELECT signed FROM updates WHERE (target = '*' OR target = ?) AND created_at > ? ORDER BY created_at`)
    .all(deviceId, since || '1970-01-01');
  return rows.map((r) => JSON.parse(r.signed));
}

export function ingestPacket(db, env, { privateKeyPem, via = 'otomatis', since = null }) {
  const body = openPacket(env, lookupDevice(db));
  const now = new Date().toISOString();
  const acked = [];
  let fresh = 0;
  ptx(db, () => {
    const ins = db.prepare('INSERT OR IGNORE INTO events(event_id, device_id, seq, type, ts, payload, received_at, packet_id) VALUES (?,?,?,?,?,?,?,?)');
    for (const ev of body.events) {
      // Kejadian yang cacat ditolak satu per satu tanpa menggagalkan paket; tidak di-ack agar terlihat di sekolah.
      if (!ev || !ID_RE.test(ev.event_id) || ev.device_id !== body.device_id || typeof ev.type !== 'string' || !Number.isInteger(ev.seq)) continue;
      const r = ins.run(ev.event_id, ev.device_id, ev.seq, ev.type, ev.ts, JSON.stringify(ev.payload ?? {}), now, body.packet_id);
      fresh += Number(r.changes);
      acked.push(ev.event_id);
    }
    db.prepare('INSERT INTO sync_log(device_id, packet_id, received_at, n_events, n_new, via) VALUES (?,?,?,?,?,?)').run(
      body.device_id, body.packet_id, now, body.events.length, fresh, via
    );
    if (body.meta?.sw_version) db.prepare('UPDATE devices SET sw_version = ? WHERE device_id = ?').run(body.meta.sw_version, body.device_id);
  });
  const receipt = signUpdate(
    {
      device_id: body.device_id,
      packet_id: body.packet_id,
      acked_event_ids: acked,
      received_at: now,
      baru: fresh,
      updates: pendingUpdates(db, body.device_id, since),
    },
    privateKeyPem
  );
  return receipt;
}

export { PacketError };
