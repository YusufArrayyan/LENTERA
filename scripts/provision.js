// Penyiapan: kunci pusat, kunci tiap kotak, konfigurasi sekolah, akun awal, dan data contoh.
// Pakai: node scripts/provision.js [--ulang]
//   --ulang  hapus folder data lalu buat ulang dari awal
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateKeypair, hashPassword } from '../shared/packet.js';
import { openPusatDb } from '../pusat/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(root, 'data');

export const SCHOOLS = [
  { device_id: 'LTR-0001', school_id: 'SCH-001', name: 'SD Negeri Bukit Harapan', region: 'Kab. Contoh Timur', region_code: '53.99.01', seed: 7, live: true },
  { device_id: 'LTR-0002', school_id: 'SCH-002', name: 'SD Inpres Pantai Batu', region: 'Kab. Contoh Timur', region_code: '53.99.02', seed: 11 },
  { device_id: 'LTR-0003', school_id: 'SCH-003', name: 'SD Negeri Lembah Damai', region: 'Kab. Contoh Timur', region_code: '53.99.03', seed: 13 },
  { device_id: 'LTR-0004', school_id: 'SCH-004', name: 'SD Katolik Tunas Pagi', region: 'Kab. Contoh Barat', region_code: '53.98.01', seed: 17 },
  { device_id: 'LTR-0005', school_id: 'SCH-005', name: 'SD Negeri Air Jernih', region: 'Kab. Contoh Barat', region_code: '53.98.02', seed: 19 },
];

function word(n = 4) {
  const a = 'bcdfghjkmnprstvz', v = 'aiueo';
  let s = '';
  for (let i = 0; i < n; i++) s += a[crypto.randomInt(a.length)] + v[crypto.randomInt(v.length)];
  return s;
}
const demoPassword = () => `${word(2)}-${word(2)}-${crypto.randomInt(10, 99)}`;

export function provision({ ulang = false } = {}) {
  if (fs.existsSync(path.join(DATA, 'pusat', 'config.json')) && !ulang) {
    console.log('Data sudah disiapkan sebelumnya. Pakai "--ulang" untuk membuat ulang dari awal.');
    return false;
  }
  if (ulang && fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(DATA, 'pusat'), { recursive: true });

  const pusatKeys = generateKeypair();
  fs.writeFileSync(path.join(DATA, 'pusat', 'config.json'), JSON.stringify({ private_key_pem: pusatKeys.privateKeyPem, public_key_pem: pusatKeys.publicKeyPem }, null, 2));

  const pdb = openPusatDb(path.join(DATA, 'pusat'));
  const programStart = new Date(Date.now() - 43 * 86400000).toISOString().slice(0, 10);
  const accounts = { sekolah: {}, pusat: {} };

  for (const s of SCHOOLS) {
    const keys = generateKeypair();
    const syncKey = crypto.randomBytes(32).toString('hex');
    const dir = s.live ? path.join(DATA, 'sekolah') : path.join(DATA, 'sekolah-lain', s.device_id);
    fs.mkdirSync(dir, { recursive: true });
    const cfg = {
      device_id: s.device_id,
      serial: `MPC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      installed_at: programStart,
      sw_version: '1.0.0',
      fw_version: 'esp32-1.0.0',
      school: {
        school_id: s.school_id, name: s.name, region: s.region, tz_offset_min: 480,
        schedule_days: [2, 4], jam_mulai: '07:00', jam_selesai: '12:30', program_start: programStart,
      },
      wifi: { ssid: `LENTERA-${s.school_id.slice(-3)}` },
      kolibri_url: process.env.KOLIBRI_URL || 'http://lentera.local:8000',
      iot_key: crypto.randomBytes(12).toString('hex'),
      keys: { private_key_pem: keys.privateKeyPem, sync_key_hex: syncKey },
      pusat: { url: process.env.PUSAT_URL || 'http://localhost:9090', public_key_pem: pusatKeys.publicKeyPem },
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));
    pdb.prepare(`INSERT INTO devices(device_id, school_id, school_name, region, region_code, public_key_pem, sync_key_hex, serial, installed_at, sw_version, fw_version, schedule_days, tz_offset_min, jam_mulai, jam_selesai, program_start)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      s.device_id, s.school_id, s.name, s.region, s.region_code, keys.publicKeyPem, syncKey, cfg.serial, programStart, '1.0.0', 'esp32-1.0.0', '[2,4]', 480, '07:00', '12:30', programStart
    );
  }

  for (const [username, name, role] of [
    ['koordinator', 'Agnes Wulandari', 'koordinator'],
    ['dinas', 'Hendrik Bria', 'dinas'],
    ['admin', 'Admin Pusat', 'admin'],
  ]) {
    const pw = demoPassword();
    accounts.pusat[username] = { pw, role };
    pdb.prepare('INSERT INTO users(user_id, username, name, role, pass_hash) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), username, name, role, hashPassword(pw));
  }
  pdb.close();

  for (const [username, name, role] of [
    ['guru', 'Ratna Dewi', 'guru'],
    ['relawan', 'Dimas Prasetyo', 'relawan'],
    ['admin', 'Admin Sekolah', 'admin'],
  ]) accounts.sekolah[username] = { pw: demoPassword(), role, name };

  fs.writeFileSync(path.join(DATA, 'akun.json'), JSON.stringify(accounts, null, 2));
  const live = SCHOOLS.find((s) => s.live);
  const iotKey = JSON.parse(fs.readFileSync(path.join(DATA, 'sekolah', 'config.json'), 'utf8')).iot_key;
  const txt = [
    'AKUN DEMO LENTERA (hanya untuk uji coba; ganti sebelum pilot)',
    '',
    `Server sekolah: ${live.name}  ->  http://localhost:8080`,
    ...Object.entries(accounts.sekolah).map(([u, a]) => `  ${a.role.padEnd(12)} nama pengguna: ${u.padEnd(12)} kata sandi: ${a.pw}`),
    '  murid        pakai kode di kartu (lihat Guru > Murid > Cetak kartu QR)',
    '',
    'Dasbor pusat  ->  http://localhost:9090',
    ...Object.entries(accounts.pusat).map(([u, a]) => `  ${a.role.padEnd(12)} nama pengguna: ${u.padEnd(12)} kata sandi: ${a.pw}`),
    '',
    `Kunci modul IoT ${live.device_id}: ${iotKey}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DATA, 'AKUN-DEMO.txt'), txt);
  console.log('Kunci dan konfigurasi dibuat di folder data/. Akun demo: data/AKUN-DEMO.txt');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  provision({ ulang: process.argv.includes('--ulang') });
}
