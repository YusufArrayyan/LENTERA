// Layanan pusat (kampus/dinas): penerima paket sinkron, dasbor, distribusi pembaruan.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRouter, startServer, serveStatic, readJson, parseCookies, HttpError, loadTls } from '../shared/http.js';
import { verifyPassword, newToken, signUpdate } from '../shared/packet.js';
import { openPusatDb } from './db.js';
import { ingestPacket, pendingUpdates, PacketError } from './ingest.js';
import * as M from './metrics.js';
import { LEVELS } from '../shared/numerasi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export function createPusat({ dataDir, cfg }) {
  const db = openPusatDb(dataDir);
  const router = createRouter();

  function who(req) {
    if (req._who !== undefined) return req._who;
    const token = parseCookies(req).ltp || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let w = null;
    if (token) {
      const row = db.prepare('SELECT u.user_id, u.username, u.name, u.role FROM auth_tokens t JOIN users u ON u.user_id = t.user_id WHERE t.token = ? AND t.expires_at > ?').get(token, new Date().toISOString());
      if (row) w = { ...row, token };
    }
    req._who = w;
    return w;
  }
  const need = (...roles) => (req) => {
    const w = who(req);
    if (!w) throw new HttpError(401, 'Sesi masuk sudah habis. Masuk lagi untuk melanjutkan.', 'belum_masuk');
    if (roles.length && !roles.includes(w.role)) throw new HttpError(403, 'Akun ini tidak punya akses ke bagian tersebut.', 'tanpa_akses');
  };
  const anyUser = need('koordinator', 'dinas', 'admin');
  const koor = need('koordinator', 'admin');
  const audit = (req, action, target) =>
    db.prepare('INSERT INTO audit(ts, user_id, role, action, target) VALUES (?,?,?,?,?)').run(new Date().toISOString(), who(req)?.user_id, who(req)?.role, action, target || null);

  const devices = () => db.prepare('SELECT * FROM devices ORDER BY school_name').all();
  const device = (id) => {
    const d = db.prepare('SELECT * FROM devices WHERE device_id = ? OR school_id = ?').get(id, id);
    if (!d) throw new HttpError(404, 'Sekolah atau kotak tidak ditemukan.', 'tidak_ada');
    return d;
  };

  // ---------- auth ----------
  router.post('/auth/login', async (req, res) => {
    const b = await readJson(req);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(b.username || '').trim().toLowerCase());
    if (!u || !verifyPassword(String(b.password || ''), u.pass_hash)) throw new HttpError(401, 'Nama pengguna atau kata sandi salah. Coba lagi.', 'sandi_salah');
    const token = newToken();
    db.prepare('INSERT INTO auth_tokens(token, user_id, expires_at) VALUES (?,?,?)').run(token, u.user_id, new Date(Date.now() + 12 * 3600000).toISOString());
    res.setHeader('Set-Cookie', `ltp=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`);
    req._who = { ...u, token };
    audit(req, 'masuk');
    return { peran: u.role, nama: u.name };
  });
  router.post('/auth/logout', (req, res) => {
    const w = who(req);
    if (w) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(w.token);
    res.setHeader('Set-Cookie', 'ltp=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { keluar: true };
  });
  router.get('/auth/me', (req) => {
    const w = who(req);
    if (!w) throw new HttpError(401, 'Belum masuk.', 'belum_masuk');
    const { token, pass_hash, ...rest } = w;
    return rest;
  });

  // ---------- sinkronisasi ----------
  router.post('/sync/upload', async (req) => {
    const b = await readJson(req);
    const env = b.packet || b;
    try {
      return ingestPacket(db, env, { privateKeyPem: cfg.private_key_pem, via: b.via === 'relawan' ? 'relawan' : 'otomatis', since: b.since || null });
    } catch (e) {
      if (e instanceof PacketError) throw new HttpError(400, e.message, e.code);
      throw e;
    }
  });

  router.get('/sync/download', (req) => {
    device(req.query.device_id);
    return { updates: pendingUpdates(db, req.query.device_id, req.query.since) };
  });

  router.get('/sync/public-key', () => ({ public_key_pem: cfg.public_key_pem }));

  // ---------- dasbor ----------
  // Petugas dinas hanya menerima agregat sekolah (F-3.5, US-6). Koordinator mendapat
  // tambahan rincian perangkat. Tidak ada respons yang memuat student_code.
  function dinasView(s) {
    return {
      school_id: s.school_id,
      device_id: s.device_id,
      sekolah: s.sekolah,
      wilayah: s.wilayah,
      kode_wilayah: s.kode_wilayah,
      pembanding: s.pembanding,
      status: s.status,
      detak_terakhir: s.detak_terakhir,
      sinkron_terakhir: s.sinkron_terakhir,
      waktu_aktif_persen: s.waktu_aktif.persen,
      baterai_pct: s.baterai_pct,
      sesi: s.sesi,
      numerasi: s.numerasi,
    };
  }

  router.get('/dashboard/schools', anyUser, (req) => {
    const w = who(req);
    audit(req, 'lihat_dasbor');
    const list = devices().map((d) => M.schoolSummary(db, d));
    return {
      peran: w.role,
      dibuat: new Date().toISOString(),
      ambang: { waktu_aktif: 90, sesi_terlaksana: 80, relawan_hadir: 85, tidak_aktif_jam: M.INACTIVE_HOURS },
      levels: LEVELS,
      sekolah: w.role === 'dinas' ? list.map(dinasView) : list,
    };
  });

  router.get('/dashboard/schools/:id/metrics', anyUser, (req) => {
    const d = device(req.params.id);
    audit(req, 'lihat_metrik_sekolah', d.school_id);
    const s = M.schoolSummary(db, d);
    return who(req).role === 'dinas' ? dinasView(s) : s;
  });

  router.get('/dashboard/devices/:id/health', koor, (req) => {
    const d = device(req.params.id);
    audit(req, 'lihat_kesehatan_kotak', d.device_id);
    return M.deviceHealth(db, d, Math.min(168, Number(req.query.jam) || 72));
  });

  router.get('/dashboard/notifications', koor, () =>
    db.prepare('SELECT n.*, d.school_name sekolah FROM notifications n JOIN devices d ON d.device_id = n.device_id ORDER BY n.created_at DESC LIMIT 50').all()
  );

  // ---------- pembaruan (F-3.6) ----------
  router.get('/updates', koor, () => db.prepare('SELECT update_id, kind, target, created_at, created_by, signed FROM updates ORDER BY created_at DESC LIMIT 50').all().map((u) => ({ ...u, payload: JSON.parse(u.signed).payload, signed: undefined })));

  router.post('/updates', koor, async (req) => {
    const b = await readJson(req);
    const kinds = { pengumuman: true, ambang: true, jadwal: true };
    if (!kinds[b.kind]) throw new HttpError(400, 'Jenis pembaruan harus pengumuman, ambang, atau jadwal.', 'jenis_salah');
    const target = b.target === '*' || !b.target ? '*' : device(b.target).device_id;
    let payload = b.payload || {};
    if (b.kind === 'pengumuman') {
      const teks = String(payload.teks || '').trim();
      if (teks.length < 3) throw new HttpError(400, 'Tulis isi pengumuman.', 'teks_kosong');
      payload = { teks: teks.slice(0, 500), dari: who(req).name };
    }
    if (b.kind === 'ambang') {
      const allowed = ['baterai_waspada_pct', 'baterai_kritis_pct', 'suhu_waspada_c', 'suhu_kritis_c', 'lembap_waspada_pct', 'iot_hilang_menit'];
      payload = Object.fromEntries(Object.entries(payload).filter(([k, v]) => allowed.includes(k) && Number.isFinite(+v)).map(([k, v]) => [k, +v]));
      if (!Object.keys(payload).length) throw new HttpError(400, 'Isi minimal satu nilai ambang.', 'ambang_kosong');
    }
    if (b.kind === 'jadwal') {
      const hari = (payload.hari || []).map(Number).filter((h) => h >= 1 && h <= 6);
      if (!hari.length) throw new HttpError(400, 'Pilih minimal satu hari sesi.', 'jadwal_kosong');
      payload = { hari };
    }
    const update = { update_id: crypto.randomUUID(), kind: b.kind, target, payload, created_at: new Date().toISOString() };
    const signed = signUpdate(update, cfg.private_key_pem);
    db.prepare('INSERT INTO updates(update_id, kind, target, created_at, created_by, signed) VALUES (?,?,?,?,?,?)').run(update.update_id, update.kind, target, update.created_at, who(req).user_id, JSON.stringify(signed));
    if (b.kind === 'jadwal') {
      if (target === '*') db.prepare('UPDATE devices SET schedule_days = ?').run(JSON.stringify(payload.hari));
      else db.prepare('UPDATE devices SET schedule_days = ? WHERE device_id = ?').run(JSON.stringify(payload.hari), target);
    }
    audit(req, 'terbitkan_pembaruan', `${b.kind}:${target}`);
    return { update_id: update.update_id };
  });

  // ---------- laporan semester (F-3.7) ----------
  router.get('/reports/semester', anyUser, (req, res) => {
    audit(req, 'ekspor_laporan', req.query.format || 'json');
    const rows = devices().map((d) => dinasView(M.schoolSummary(db, d)));
    if (req.query.format === 'csv') {
      const head = ['sekolah', 'wilayah', 'kelompok', 'status', 'waktu_aktif_persen', 'sesi_terjadwal', 'sesi_terlaksana', 'persen_terlaksana', 'persen_relawan_hadir', 'murid_terdiagnosis', 'rata_level_awal', 'rata_level_kini', 'rata_skor_awal_persen', 'rata_skor_kini_persen', 'persen_naik_level', 'sinkron_terakhir'];
      const esc = (v) => (v === null || v === undefined ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const lines = [head.join(',')].concat(
        rows.map((r) =>
          [r.sekolah, r.wilayah, r.pembanding ? 'pembanding' : 'LENTERA', r.status, r.waktu_aktif_persen, r.sesi.terjadwal, r.sesi.terlaksana, r.sesi.persen_terlaksana, r.sesi.persen_relawan_hadir,
            r.numerasi.murid_terdiagnosis, r.numerasi.rata_level_awal, r.numerasi.rata_level_kini, r.numerasi.rata_skor_awal_persen, r.numerasi.rata_skor_kini_persen, r.numerasi.persen_naik_level, r.sinkron_terakhir]
            .map(esc).join(',')
        )
      );
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="laporan-lentera-${new Date().toISOString().slice(0, 10)}.csv"`,
      });
      res.end(String.fromCharCode(0xfeff) + lines.join('\r\n'));
      return;
    }
    return { dibuat: new Date().toISOString(), sekolah: rows };
  });

  router.get('/audit', need('admin'), () => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all());

  const statics = serveStatic([
    { prefix: '/ui/', dir: path.join(root, 'ui') },
    { prefix: '/', dir: path.join(here, 'public') },
  ]);

  // F-3.8: catat notifikasi saat kotak tidak aktif > 72 jam; kirim ke webhook bila diatur.
  async function checkInactive() {
    for (const { d, sig } of M.inactiveDevices(db)) {
      const hours = Math.round((Date.now() - Date.parse(sig)) / 3600000);
      const msg = `${d.school_name}: kotak ${d.device_id} tidak mengirim detak selama ${hours} jam (terakhir ${sig.slice(0, 16).replace('T', ' ')} UTC).`;
      const r = db.prepare('INSERT OR IGNORE INTO notifications(device_id, kind, ref, created_at, message) VALUES (?,?,?,?,?)').run(d.device_id, 'tidak_aktif_72_jam', sig, new Date().toISOString(), msg);
      if (r.changes && process.env.NOTIFY_WEBHOOK) {
        try {
          await fetch(process.env.NOTIFY_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: msg }) });
          db.prepare('UPDATE notifications SET delivered = 1 WHERE device_id = ? AND kind = ? AND ref = ?').run(d.device_id, 'tidak_aktif_72_jam', sig);
        } catch {}
      }
    }
  }
  checkInactive();
  const timer = setInterval(checkInactive, 30 * 60000);

  return { router, statics, db, close: () => clearInterval(timer), checkInactive };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.LENTERA_PUSAT_DATA || path.join(root, 'data', 'pusat'));
  const cfgFile = path.join(dataDir, 'config.json');
  if (!fs.existsSync(cfgFile)) {
    console.error(`Konfigurasi ${cfgFile} belum ada. Jalankan "npm run siapkan" lebih dulu.`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const app = createPusat({ dataDir, cfg });
  const port = Number(process.env.PORT) || 9090;
  const tls = loadTls();
  await startServer({ router: app.router, statics: app.statics, port, cors: ['/sync/'], tls });
  console.log(`LENTERA pusat siap di ${tls ? 'https' : 'http'}://localhost:${port}`);
}
