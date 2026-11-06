// Mengisi data contoh enam pekan untuk lima sekolah pilot, lalu menyinkronkannya ke pusat
// lewat jalur paket terenkripsi yang sama dengan sistem sungguhan.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from '../sekolah/db.js';
import { atomic } from '../sekolah/core.js';
import { applyAck } from '../sekolah/sync.js';
import { openPusatDb } from '../pusat/db.js';
import { ingestPacket } from '../pusat/ingest.js';
import { sealPacket, hashPassword } from '../shared/packet.js';
import { generateHistory } from './history.js';
import { SCHOOLS } from './provision.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(root, 'data');

const PROFIL = {
  'LTR-0001': { nStudents: 30, pendingConsent: 2, sessionRate: 0.9, volunteerRate: 0.88, outage: [12], openReport: 'Lampu indikator modul kadang berkedip merah walau baterai penuh.' },
  'LTR-0002': { nStudents: 26, pendingConsent: 0, sessionRate: 0.94, volunteerRate: 0.92, outage: [], abilityShift: 0.2 },
  'LTR-0003': { nStudents: 22, pendingConsent: 1, sessionRate: 0.85, volunteerRate: 0.8, outage: [5, 6], lastSignalDaysAgo: 4, weakBattery: true, openReport: 'Panel surya tertutup daun dan debu; baterai cepat habis.' },
  'LTR-0004': { nStudents: 34, pendingConsent: 3, sessionRate: 0.62, volunteerRate: 0.58, outage: [3, 17, 18, 25], hot: true },
  'LTR-0005': { nStudents: 24, pendingConsent: 0, sessionRate: 0.88, volunteerRate: 0.9, outage: [9, 20], abilityShift: -0.3 },
};

export function seed() {
  const pcfg = JSON.parse(fs.readFileSync(path.join(DATA, 'pusat', 'config.json'), 'utf8'));
  const accounts = JSON.parse(fs.readFileSync(path.join(DATA, 'akun.json'), 'utf8'));
  const pdb = openPusatDb(path.join(DATA, 'pusat'));
  if (pdb.prepare('SELECT COUNT(*) n FROM events').get().n > 0) {
    console.log('Pusat sudah berisi data. Lewati pengisian data contoh.');
    return;
  }
  const now = Date.now();
  for (const s of SCHOOLS) {
    const dir = s.live ? path.join(DATA, 'sekolah') : path.join(DATA, 'sekolah-lain', s.device_id);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    const db = openDb(dir);
    const ctx = { db, cfg };
    const prof = PROFIL[s.device_id];

    const users = [];
    const src = s.live
      ? Object.entries(accounts.sekolah).map(([u, a]) => ({ username: u, name: a.name, role: a.role, pw: a.pw }))
      : [
          { username: 'guru', name: 'Guru Kelas', role: 'guru', pw: crypto.randomBytes(9).toString('base64url') },
          { username: 'relawan', name: 'Relawan Kampus', role: 'relawan', pw: crypto.randomBytes(9).toString('base64url') },
        ];
    for (const u of src) {
      const user_id = crypto.randomUUID();
      const trained_at = cfg.school.program_start;
      db.prepare('INSERT INTO users(user_id, username, name, role, pass_hash, trained_at) VALUES (?,?,?,?,?,?)').run(user_id, u.username, u.name, u.role, hashPassword(u.pw), trained_at);
      users.push({ user_id, role: u.role, name: u.name, trained_at });
    }

    const t0 = Date.now();
    const res = atomic(db, () =>
      generateHistory(ctx, {
        seed: s.seed, days: 42, now, users: users.filter((u) => u.role !== 'admin'),
        nStudents: prof.nStudents, pendingConsent: prof.pendingConsent, sessionRate: prof.sessionRate, volunteerRate: prof.volunteerRate,
        outageDays: new Set(prof.outage), lastSignalDaysAgo: prof.lastSignalDaysAgo || 0, weakBattery: prof.weakBattery, hot: prof.hot,
        abilityShift: prof.abilityShift || 0, openReport: prof.openReport,
      })
    );

    // Sinkron: sekolah demo menyisakan kejadian hari ini agar ada yang "belum terkirim".
    const cutoff = new Date(s.live ? now - 20 * 3600000 : now).toISOString();
    let sent = 0;
    for (;;) {
      const rows = db.prepare('SELECT event_id, device_id, seq, type, ts, payload FROM events WHERE acked = 0 AND ts < ? ORDER BY seq LIMIT 4000').all(cutoff);
      if (!rows.length) break;
      const env = sealPacket({ deviceId: cfg.device_id, events: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) })), syncKeyHex: cfg.keys.sync_key_hex, privateKeyPem: cfg.keys.private_key_pem });
      const receipt = ingestPacket(pdb, env, { privateKeyPem: pcfg.private_key_pem, via: sent % 2 ? 'relawan' : 'otomatis' });
      applyAck(ctx, receipt.acked_event_ids);
      sent += rows.length;
    }
    const total = db.prepare('SELECT COUNT(*) n FROM events').get().n;
    console.log(`${s.name.padEnd(26)} ${String(res.students).padStart(2)} murid aktif, ${String(total).padStart(6)} kejadian, ${String(sent).padStart(6)} tersinkron (${Date.now() - t0} ms)`);
    db.close();
  }
  pdb.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) seed();
