import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../sekolah/db.js';
import { openPusatDb } from '../pusat/db.js';
import { generateKeypair, hashPassword } from '../shared/packet.js';

export function tmpdir(prefix = 'lentera-uji-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makePusat() {
  const dir = tmpdir('lentera-pusat-');
  const keys = generateKeypair();
  const cfg = { private_key_pem: keys.privateKeyPem, public_key_pem: keys.publicKeyPem };
  const db = openPusatDb(dir);
  return { dir, db, cfg };
}

export function makeSchool(pusat, deviceId = 'LTR-T' + crypto.randomInt(1000, 9999), opts = {}) {
  const dir = tmpdir('lentera-sekolah-');
  const keys = generateKeypair();
  const syncKey = crypto.randomBytes(32).toString('hex');
  const programStart = new Date(Date.now() - 50 * 86400000).toISOString().slice(0, 10);
  const cfg = {
    device_id: deviceId,
    installed_at: programStart,
    sw_version: '1.0.0-uji',
    fw_version: 'uji',
    school: { school_id: 'SCH-' + deviceId, name: opts.name || `SD Uji ${deviceId}`, region: 'Kab. Uji', tz_offset_min: 480, schedule_days: [2, 4], jam_mulai: '07:00', jam_selesai: '12:30', program_start: programStart },
    iot_key: 'kunci-uji',
    keys: { private_key_pem: keys.privateKeyPem, sync_key_hex: syncKey },
    pusat: { url: null, public_key_pem: pusat.cfg.public_key_pem },
  };
  pusat.db.prepare(`INSERT INTO devices(device_id, school_id, school_name, region, public_key_pem, sync_key_hex, program_start) VALUES (?,?,?,?,?,?,?)`).run(
    deviceId, cfg.school.school_id, cfg.school.name, 'Kab. Uji', keys.publicKeyPem, syncKey, programStart
  );
  const db = openDb(dir);
  return { dir, db, cfg, ctx: { db, cfg } };
}

export function addUser(db, role, username = role) {
  const user_id = crypto.randomUUID();
  const pw = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO users(user_id, username, name, role, pass_hash) VALUES (?,?,?,?,?)').run(user_id, username, `Uji ${role}`, role, hashPassword(pw));
  return { user_id, role, username, pw, name: `Uji ${role}` };
}
