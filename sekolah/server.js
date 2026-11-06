// Layanan LENTERA di server sekolah (mini-PC). Berjalan tanpa internet.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRouter, startServer, serveStatic, readJson, parseCookies, HttpError, send, loadTls } from '../shared/http.js';
import { verifyPassword, newToken } from '../shared/packet.js';
import { openDb, getMeta } from './db.js';
import * as core from './core.js';
import * as sync from './sync.js';
import { cariKatalog, ALAT_PERAGA, LEVELS, levelInfo } from '../shared/numerasi.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export function loadConfig(dataDir) {
  const file = path.join(dataDir, 'config.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Konfigurasi ${file} belum ada. Jalankan "npm run siapkan" lebih dulu.`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const TOKEN_HOURS = { murid: 8, guru: 24 * 14, relawan: 24 * 14, admin: 12 };

export function createApp({ dataDir, cfg }) {
  const db = openDb(dataDir);
  const ctx = { db, cfg };
  const router = createRouter();
  const loginAttempts = new Map();

  // ---------- autentikasi ----------
  function issueToken(res, { user_id = null, role, student_code = null }) {
    const token = newToken();
    const now = Date.now();
    db.prepare('INSERT INTO auth_tokens(token, user_id, role, student_code, created_at, expires_at) VALUES (?,?,?,?,?,?)').run(
      token, user_id, role, student_code, new Date(now).toISOString(), new Date(now + TOKEN_HOURS[role] * 3600000).toISOString()
    );
    res.setHeader('Set-Cookie', `ltr=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_HOURS[role] * 3600}`);
    return token;
  }

  function who(req) {
    if (req._who !== undefined) return req._who;
    const token = parseCookies(req).ltr || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let w = null;
    if (token) {
      const row = db.prepare('SELECT * FROM auth_tokens WHERE token = ? AND expires_at > ?').get(token, new Date().toISOString());
      if (row) {
        if (row.user_id) {
          const u = db.prepare('SELECT user_id, username, name, role, active FROM users WHERE user_id = ?').get(row.user_id);
          if (u && u.active) w = { ...u, token };
        } else if (row.student_code) {
          w = { role: 'murid', student_code: row.student_code, token };
        }
      }
    }
    req._who = w;
    return w;
  }

  const need = (...roles) => (req) => {
    const w = who(req);
    if (!w) throw new HttpError(401, 'Sesi masuk sudah habis. Masuk lagi untuk melanjutkan.', 'belum_masuk');
    if (roles.length && !roles.includes(w.role)) throw new HttpError(403, 'Akun ini tidak punya akses ke bagian tersebut.', 'tanpa_akses');
  };
  const staff = need('guru', 'relawan', 'admin');
  const guruAdmin = need('guru', 'admin');

  function throttle(req) {
    const ip = req.socket.remoteAddress || 'x';
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { n: 0, t: now };
    if (now - rec.t > 10 * 60000) Object.assign(rec, { n: 0, t: now });
    rec.n++;
    loginAttempts.set(ip, rec);
    if (rec.n > 30) throw new HttpError(429, 'Terlalu banyak percobaan masuk. Tunggu 10 menit, lalu coba lagi.', 'terlalu_sering');
  }

  router.post('/auth/login', async (req, res) => {
    throttle(req);
    const body = await readJson(req);
    if (body.kode !== undefined) {
      const code = core.normalizeCode(body.kode);
      if (!code) throw new HttpError(400, 'Kode terdiri dari 6 huruf dan angka, misalnya KJ7-M4P.', 'kode_format');
      const st = db.prepare('SELECT status FROM students WHERE student_code = ?').get(code);
      if (!st || st.status === 'ditarik') throw new HttpError(404, 'Kode ini tidak terdaftar. Cek lagi kartumu atau tanyakan ke guru.', 'kode_tidak_ada');
      if (st.status !== 'aktif') throw new HttpError(403, 'Kartumu belum aktif. Minta guru mengaktifkannya.', 'belum_aktif');
      issueToken(res, { role: 'murid', student_code: code });
      core.audit(ctx, { role: 'murid', student_code: code }, 'masuk', code);
      return { peran: 'murid', kode: code, ke: '/murid' };
    }
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(body.username || '').trim().toLowerCase());
    if (!u || !verifyPassword(String(body.password || ''), u.pass_hash)) {
      throw new HttpError(401, 'Nama pengguna atau kata sandi salah. Coba lagi.', 'sandi_salah');
    }
    issueToken(res, { user_id: u.user_id, role: u.role });
    core.audit(ctx, u, 'masuk', u.username);
    return { peran: u.role, nama: u.name, ke: u.role === 'relawan' ? '/relawan' : '/guru' };
  });

  router.post('/auth/logout', (req, res) => {
    const w = who(req);
    if (w) db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(w.token);
    res.setHeader('Set-Cookie', 'ltr=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { keluar: true };
  });

  router.get('/auth/me', (req) => {
    const w = who(req);
    if (!w) throw new HttpError(401, 'Belum masuk.', 'belum_masuk');
    const { token, ...rest } = w;
    return rest;
  });

  router.get('/api/info', () => ({
    sekolah: cfg.school.name,
    wilayah: cfg.school.region,
    device_id: cfg.device_id,
    wifi: cfg.wifi?.ssid || null,
    kolibri_url: cfg.kolibri_url || null,
    levels: LEVELS,
  }));

  router.get('/health', () => ({ ok: true, t: new Date().toISOString() }));

  // ---------- murid ----------
  function sameStudent(req) {
    const w = who(req);
    const code = core.normalizeCode(req.params.code);
    if (!code) throw new HttpError(400, 'Kode murid tidak sah.', 'kode_format');
    if (w.role === 'murid' && w.student_code !== code) throw new HttpError(403, 'Kamu hanya bisa membuka latihanmu sendiri.', 'tanpa_akses');
    return code;
  }

  router.get('/student/:code/next-activity', need('murid', 'guru', 'admin'), (req) => core.nextActivity(ctx, sameStudent(req)));
  router.post('/student/:code/answers', need('murid'), async (req) => core.submitAnswer(ctx, sameStudent(req), await readJson(req)));

  // ---------- data murid (guru) ----------
  router.get('/students', guruAdmin, (req) => {
    core.audit(ctx, who(req), 'lihat_daftar_murid');
    return db.prepare(`
      SELECT s.student_code, i.name, i.class_grade, s.status, s.level, s.group_id, g.label group_label, s.last_assessed_at, s.reassess_open,
             c.given_at consent_at, c.form_version, c.giver_relation
      FROM students s
      LEFT JOIN student_identity i ON i.student_code = s.student_code
      LEFT JOIN groups g ON g.group_id = s.group_id
      LEFT JOIN consent c ON c.student_code = s.student_code
      WHERE s.status != 'ditarik'
      ORDER BY i.class_grade, i.name`).all();
  });

  router.post('/students', guruAdmin, async (req) => {
    const b = await readJson(req);
    const code = core.enrollStudent(ctx, b);
    core.audit(ctx, who(req), 'tambah_murid', code);
    return { student_code: code };
  });

  router.post('/students/:code/consent', guruAdmin, async (req) => {
    const code = core.normalizeCode(req.params.code);
    core.recordConsent(ctx, code, await readJson(req));
    core.audit(ctx, who(req), 'catat_persetujuan', code);
    return { ok: true };
  });

  router.post('/students/:code/activate', guruAdmin, (req) => {
    const code = core.normalizeCode(req.params.code);
    core.activateStudent(ctx, code);
    core.audit(ctx, who(req), 'aktifkan_murid', code);
    return { ok: true };
  });

  router.post('/students/:code/withdraw', guruAdmin, async (req) => {
    const code = core.normalizeCode(req.params.code);
    const b = await readJson(req);
    core.withdrawStudent(ctx, code, b.alasan);
    core.audit(ctx, who(req), 'tarik_data_murid', code);
    return { ok: true };
  });

  router.get('/students/cards', guruAdmin, (req) => {
    const codes = String(req.query.kode || '').split(',').map(core.normalizeCode).filter(Boolean);
    core.audit(ctx, who(req), 'cetak_kartu', codes.join(',') || 'semua');
    const base = `SELECT s.student_code, i.name, i.class_grade, s.status FROM students s JOIN student_identity i ON i.student_code = s.student_code WHERE s.status != 'ditarik'`;
    const rows = codes.length
      ? db.prepare(`${base} AND s.student_code IN (${codes.map(() => '?').join(',')}) ORDER BY i.class_grade, i.name`).all(...codes)
      : db.prepare(`${base} ORDER BY i.class_grade, i.name`).all();
    return { sekolah: cfg.school.name, kartu: rows };
  });

  // ---------- kelompok ----------
  router.get('/groups', staff, (req) => {
    const w = who(req);
    core.audit(ctx, w, 'lihat_kelompok');
    const groups = db.prepare('SELECT * FROM groups WHERE active = 1 ORDER BY level, label').all();
    const members = db.prepare(`
      SELECT s.student_code, i.name, i.class_grade, s.level, s.group_id, s.reassess_open, s.last_assessed_at,
             p.sub, p.total, p.correct, p.siap_naik
      FROM students s LEFT JOIN student_identity i ON i.student_code = s.student_code
      LEFT JOIN practice_state p ON p.student_code = s.student_code
      WHERE s.status = 'aktif' ORDER BY i.name`).all();
    const ungrouped = members.filter((m) => !m.group_id);
    return {
      levels: LEVELS,
      maks_per_kelompok: core.GROUP_MAX,
      kelompok: groups.map((g) => ({
        ...g,
        nama_level: levelInfo(g.level).nama,
        anggota: members.filter((m) => m.group_id === g.group_id),
        sesi_terbuka: db.prepare('SELECT session_id, started_at, facilitator_role FROM lsessions WHERE group_id = ? AND ended_at IS NULL').get(g.group_id) || null,
      })),
      belum_berkelompok: ungrouped,
      asesmen_ulang_jatuh_tempo: members.filter((m) => m.last_assessed_at && Date.now() - Date.parse(m.last_assessed_at) >= core.REASSESS_DAYS * 86400000).length,
      perlu_pengelompokan_ulang: members.filter((m) => m.group_id && m.level && groups.find((g) => g.group_id === m.group_id)?.level !== m.level).length,
    };
  });

  router.post('/groups', guruAdmin, async (req) => ({ group_id: core.createGroup(ctx, (await readJson(req)).level) }));
  router.post('/groups/reassign', guruAdmin, async (req) => {
    const b = await readJson(req);
    core.reassignManual(ctx, core.normalizeCode(b.student_code), b.group_id, who(req));
    core.audit(ctx, who(req), 'pindah_kelompok', b.student_code);
    return { ok: true };
  });
  router.post('/groups/regroup', guruAdmin, (req) => ({ dipindah: core.regroup(ctx, who(req)) }));
  router.post('/groups/reassess', guruAdmin, async (req) => ({ murid: core.openReassessment(ctx, await readJson(req), who(req)) }));

  // ---------- sesi ----------
  router.get('/sessions', staff, (req) => {
    const days = Math.min(60, Math.max(1, Number(req.query.hari) || 7));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = db.prepare(`
      SELECT l.*, g.label group_label, g.level, u.name facilitator_name,
        (SELECT COUNT(*) FROM attendance a WHERE a.session_id = l.session_id AND a.present = 1) hadir
      FROM lsessions l JOIN groups g ON g.group_id = l.group_id LEFT JOIN users u ON u.user_id = l.facilitator_id
      WHERE l.started_at >= ? OR l.ended_at IS NULL ORDER BY l.started_at DESC`).all(since);
    return rows;
  });

  router.post('/sessions', staff, async (req) => core.startSession(ctx, await readJson(req), who(req)));

  router.patch('/sessions/:id', staff, async (req) => {
    const b = await readJson(req);
    if (Array.isArray(b.hadir)) core.setAttendance(ctx, req.params.id, b.hadir);
    if (b.tutup) return core.closeSession(ctx, req.params.id, b.tutup);
    return db.prepare('SELECT * FROM lsessions WHERE session_id = ?').get(req.params.id);
  });

  router.get('/sessions/:id', staff, (req) => {
    const s = db.prepare('SELECT l.*, g.label group_label, g.level FROM lsessions l JOIN groups g ON g.group_id = l.group_id WHERE session_id = ?').get(req.params.id);
    if (!s) throw new HttpError(404, 'Sesi tidak ditemukan.', 'sesi_tidak_ada');
    const anggota = db.prepare(`
      SELECT s.student_code, i.name, COALESCE(a.present, 0) present,
        (SELECT COUNT(*) FROM answers x WHERE x.student_code = s.student_code AND x.ts >= ?) dijawab,
        (SELECT SUM(correct) FROM answers x WHERE x.student_code = s.student_code AND x.ts >= ?) benar
      FROM students s LEFT JOIN student_identity i ON i.student_code = s.student_code
      LEFT JOIN attendance a ON a.session_id = ? AND a.student_code = s.student_code
      WHERE s.group_id = ? AND s.status = 'aktif' ORDER BY i.name`).all(s.started_at, s.started_at, s.session_id, s.group_id);
    core.audit(ctx, who(req), 'lihat_sesi', s.session_id);
    return { ...s, anggota, alat_peraga: ALAT_PERAGA.find((a) => a.level === s.level) || null };
  });

  // ---------- perangkat ----------
  function deviceStatus() {
    const last = db.prepare('SELECT * FROM telemetry ORDER BY ts DESC LIMIT 1').get();
    const t = core.thresholds(ctx);
    const iotAgeMin = last ? Math.round((Date.now() - Date.parse(last.ts)) / 60000) : null;
    const today = core.localParts(new Date(), cfg.school.tz_offset_min ?? 480).dateStr;
    const tz = cfg.school.tz_offset_min ?? 480;
    const dayStart = new Date(Date.parse(today + 'T00:00:00Z') - tz * 60000).toISOString();
    const sesiHariIni = db.prepare(`
      SELECT l.session_id, l.started_at, l.ended_at, l.duration_min, g.label group_label, u.name facilitator_name, l.facilitator_role
      FROM lsessions l JOIN groups g ON g.group_id = l.group_id LEFT JOIN users u ON u.user_id = l.facilitator_id
      WHERE l.started_at >= ? ORDER BY l.started_at`).all(dayStart);
    const jadwal = getMeta(db, 'jadwal', null) || cfg.school.schedule_days || [2, 4];
    const hariIni = core.localParts(new Date(), tz).day;
    return {
      device_id: cfg.device_id,
      sekolah: cfg.school.name,
      server: { aktif: true, sejak: new Date(startedAt).toISOString(), waktu_aktif_hari_ini: core.uptimeToday(ctx) },
      iot: last
        ? {
            terakhir: last.ts,
            menit_lalu: iotAgeMin,
            hilang: iotAgeMin > t.iot_hilang_menit,
            baterai_pct: last.battery_pct,
            tegangan: last.voltage,
            arus: last.current,
            suhu: last.temp,
            kelembapan: last.humidity,
            sumber_daya: last.power_source,
          }
        : null,
      peringatan: db.prepare('SELECT kind jenis, level, value nilai, since sejak, message pesan FROM alerts ORDER BY CASE level WHEN \'kritis\' THEN 0 ELSE 1 END').all(),
      sesi_hari_ini: sesiHariIni,
      hari_sesi: jadwal,
      jadwal_sesi_hari_ini: jadwal.includes(hariIni),
      sinkron: sync.syncSummary(ctx),
      pengumuman: getMeta(db, 'pengumuman', null),
      laporan_terbuka: db.prepare(`SELECT COUNT(*) n FROM reports WHERE status = 'terbuka'`).get().n,
    };
  }

  router.get('/device/status', staff, () => deviceStatus());

  router.get('/device/telemetry', staff, (req) => {
    const hours = Math.min(168, Math.max(1, Number(req.query.jam) || 24));
    return db.prepare('SELECT ts, voltage, battery_pct, temp, humidity, power_source FROM telemetry WHERE ts >= ? ORDER BY ts').all(new Date(Date.now() - hours * 3600000).toISOString());
  });

  // Halaman QR perangkat dapat dibuka siapa pun di Wi-Fi sekolah; tidak memuat data murid.
  router.get('/device/:id/history', (req) => {
    if (req.params.id !== cfg.device_id) throw new HttpError(404, 'Kotak dengan ID ini bukan milik server sekolah ini.', 'perangkat_asing');
    return {
      device_id: cfg.device_id,
      sekolah: cfg.school.name,
      dipasang: cfg.installed_at,
      versi_perangkat_lunak: cfg.sw_version,
      versi_firmware: cfg.fw_version,
      laporan: db.prepare('SELECT report_id, description, status, created_at, resolved_at, resolution, photo IS NOT NULL ada_foto FROM reports ORDER BY created_at DESC LIMIT 50').all(),
      masuk: !!who(req),
    };
  });

  router.get('/device/reports/:id/photo', staff, (req, res) => {
    const r = db.prepare('SELECT photo FROM reports WHERE report_id = ?').get(req.params.id);
    if (!r?.photo) throw new HttpError(404, 'Laporan ini tidak punya foto.', 'tanpa_foto');
    const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(r.photo);
    res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=3600' });
    res.end(Buffer.from(m[2], 'base64'));
  });

  router.post('/device/reports', async (req) => {
    const b = await readJson(req);
    if (b.device_id && b.device_id !== cfg.device_id) throw new HttpError(404, 'Kotak dengan ID ini bukan milik server sekolah ini.', 'perangkat_asing');
    const id = core.fileReport(ctx, b, who(req));
    return { report_id: id };
  });

  router.post('/device/reports/:id/resolve', staff, async (req) => {
    const b = await readJson(req);
    const r = db.prepare('SELECT * FROM reports WHERE report_id = ?').get(req.params.id);
    if (!r) throw new HttpError(404, 'Laporan tidak ditemukan.', 'laporan_tidak_ada');
    if (r.status !== 'selesai') core.emit(ctx, 'report.resolved', { report_id: r.report_id, resolution: String(b.tindakan || '').slice(0, 500) || 'Sudah ditangani' });
    return { ok: true };
  });

  // Dipakai modul IoT (HTTP). Jalur MQTT diteruskan oleh iot/mqtt-bridge.js ke endpoint yang sama.
  router.post('/ingest/telemetry', async (req) => {
    if (cfg.iot_key && req.headers['x-lentera-key'] !== cfg.iot_key) throw new HttpError(401, 'Kunci modul IoT salah.', 'kunci_iot');
    return core.ingestTelemetry(ctx, await readJson(req));
  });

  // ---------- sinkronisasi ----------
  router.get('/sync/status', staff, () => sync.syncSummary(ctx));
  router.get('/sync/paket', staff, (req) => {
    const { env, count } = sync.buildPacket(ctx);
    core.audit(ctx, who(req), 'ambil_paket_sinkron', `${count} kejadian`);
    return { packet: env, jumlah: count, pusat_url: cfg.pusat?.url || null, sekolah: cfg.school.name, since: getMeta(db, 'updates_since', null) };
  });
  router.post('/sync/ack', staff, async (req) => {
    const b = await readJson(req);
    const r = sync.applyReceipt(ctx, b.receipt, 'relawan');
    core.audit(ctx, who(req), 'serahkan_tanda_terima', `${r.ditandai} kejadian`);
    return r;
  });
  router.post('/sync/now', guruAdmin, async () => sync.pushToPusat(ctx));

  // ---------- konten dan laporan ----------
  router.get('/konten', staff, (req) => ({ hasil: cariKatalog(req.query.q), kolibri_url: cfg.kolibri_url || null }));
  router.get('/alat-peraga', staff, () => ALAT_PERAGA);

  router.get('/laporan/kelompok', guruAdmin, (req) => {
    core.audit(ctx, who(req), 'lihat_laporan_kelompok');
    const groups = db.prepare('SELECT * FROM groups WHERE active = 1 ORDER BY level, label').all();
    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    return {
      sekolah: cfg.school.name,
      dibuat: new Date().toISOString(),
      kelompok: groups.map((g) => {
        const m = db.prepare(`
          SELECT s.student_code, i.name, s.level, p.sub,
            (SELECT COUNT(*) FROM answers a WHERE a.student_code = s.student_code AND a.activity = 'latihan' AND a.ts >= ?) dijawab,
            (SELECT COALESCE(SUM(correct),0) FROM answers a WHERE a.student_code = s.student_code AND a.activity = 'latihan' AND a.ts >= ?) benar,
            (SELECT level_result FROM diag d WHERE d.student_code = s.student_code AND d.finished_at IS NOT NULL ORDER BY d.finished_at ASC LIMIT 1) level_awal
          FROM students s LEFT JOIN student_identity i ON i.student_code = s.student_code
          LEFT JOIN practice_state p ON p.student_code = s.student_code
          WHERE s.group_id = ? AND s.status = 'aktif' ORDER BY i.name`).all(since, since, g.group_id);
        const sesi = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(duration_min),0) menit FROM lsessions WHERE group_id = ? AND ended_at IS NOT NULL AND started_at >= ?').get(g.group_id, since);
        return { ...g, nama_level: levelInfo(g.level).nama, anggota: m, sesi_28_hari: sesi };
      }),
    };
  });

  router.get('/audit', need('admin'), () => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 300').all());

  // Halaman QR perangkat
  router.get('/perangkat/:id', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    fs.createReadStream(path.join(here, 'public', 'perangkat.html')).pipe(res);
  });

  const statics = serveStatic([
    { prefix: '/ui/', dir: path.join(root, 'ui') },
    { prefix: '/', dir: path.join(here, 'public') },
  ]);

  // ---------- tugas latar ----------
  const startedAt = Date.now();
  const bootId = crypto.randomUUID();
  core.emit(ctx, 'server.boot', { boot_id: bootId, sw_version: cfg.sw_version });
  const timers = [];
  const hbMs = (Number(process.env.HEARTBEAT_DETIK) || core.HEARTBEAT_MIN * 60) * 1000;
  timers.push(setInterval(() => {
    try {
      core.heartbeat(ctx, bootId, startedAt);
      // F-2.7: modul IoT boleh mati; pembelajaran tetap jalan, guru diberi tahu.
      const last = db.prepare('SELECT ts FROM telemetry ORDER BY ts DESC LIMIT 1').get();
      const t = core.thresholds(ctx);
      const lost = !last || Date.now() - Date.parse(last.ts) > t.iot_hilang_menit * 60000;
      const cur = db.prepare(`SELECT level FROM alerts WHERE kind = 'iot'`).get();
      if (lost && !cur) core.emit(ctx, 'device.alert', { kind: 'iot', level: 'waspada', value: null, message: 'Modul pemantau tidak mengirim data. Belajar tetap bisa jalan; minta relawan memeriksa kabel modul.' });
      if (!lost && cur) core.emit(ctx, 'device.alert', { kind: 'iot', level: 'normal', value: null, message: '' });
    } catch (e) {
      console.error('detak gagal', e);
    }
  }, hbMs));
  if (cfg.pusat?.url && process.env.SINKRON_OTOMATIS !== '0') {
    const syncMs = (Number(process.env.SINKRON_MENIT) || 10) * 60000;
    timers.push(setInterval(() => sync.pushToPusat(ctx).catch(() => {}), syncMs));
    timers.push(setTimeout(() => sync.pushToPusat(ctx).catch(() => {}), 5000));
  }

  return { router, statics, ctx, close: () => timers.forEach(clearInterval) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.LENTERA_DATA || path.join(root, 'data', 'sekolah'));
  const cfg = loadConfig(dataDir);
  const app = createApp({ dataDir, cfg });
  const port = Number(process.env.PORT) || 8080;
  const tls = loadTls();
  await startServer({ router: app.router, statics: app.statics, port, tls });
  console.log(`LENTERA sekolah (${cfg.school.name}) siap di ${tls ? 'https' : 'http'}://localhost:${port}`);
}
