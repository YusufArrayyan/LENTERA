// Perhitungan metrik dasbor dari log kejadian pusat (F-3.4, F-3.5, bagian 13 PRD).
// Tidak ada fungsi di berkas ini yang mengembalikan student_code.
import { LEVELS } from '../shared/numerasi.js';

const DAY = 86400000;
const SLOT_MIN = 5;
export const INACTIVE_HOURS = 72;

const hm = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
};

function parse(rows) {
  return rows.map((r) => ({ ...r, p: JSON.parse(r.payload) }));
}

function evs(db, deviceId, types, sinceIso = '1970-01-01') {
  const ph = types.map(() => '?').join(',');
  return parse(db.prepare(`SELECT event_id, type, ts, payload FROM events WHERE device_id = ? AND type IN (${ph}) AND ts >= ? ORDER BY ts, seq`).all(deviceId, ...types, sinceIso));
}

function withdrawnCodes(db, deviceId) {
  return new Set(evs(db, deviceId, ['student.withdrawn']).map((e) => e.p.student_code));
}

// Waktu aktif jam sekolah: slot 5 menit pada hari dan jam sekolah yang punya detak.
export function uptime(db, dev, { days = 28, until = Date.now() } = {}) {
  const tz = dev.tz_offset_min;
  const start = hm(dev.jam_mulai), end = hm(dev.jam_selesai);
  const fromMs = Math.max(until - days * DAY, dev.program_start ? Date.parse(dev.program_start) : 0);
  const hb = db
    .prepare(`SELECT ts FROM events WHERE device_id = ? AND type IN ('server.heartbeat','server.boot') AND ts >= ? AND ts <= ?`)
    .all(dev.device_id, new Date(fromMs).toISOString(), new Date(until).toISOString());
  const filled = new Set();
  for (const r of hb) filled.add(Math.floor(Date.parse(r.ts) / (SLOT_MIN * 60000)));
  let expected = 0, got = 0;
  const firstLocalDay = Math.floor((fromMs + tz * 60000) / DAY);
  const lastLocalDay = Math.floor((until + tz * 60000) / DAY);
  for (let d = firstLocalDay; d <= lastLocalDay; d++) {
    const dow = new Date(d * DAY).getUTCDay();
    if (dow === 0) continue; // Minggu libur; Senin–Sabtu hari sekolah
    for (let m = start; m < end; m += SLOT_MIN) {
      const utcMs = d * DAY + m * 60000 - tz * 60000;
      if (utcMs < fromMs || utcMs + SLOT_MIN * 60000 > until) continue;
      expected++;
      if (filled.has(Math.floor(utcMs / (SLOT_MIN * 60000)))) got++;
    }
  }
  return { persen: expected ? Math.round((got / expected) * 1000) / 10 : null, slot_diharapkan: expected, slot_terisi: got };
}

function lastSignal(db, deviceId) {
  return db.prepare(`SELECT MAX(ts) ts FROM events WHERE device_id = ? AND type IN ('server.heartbeat','server.boot','telemetry.reading')`).get(deviceId).ts;
}

function lastSync(db, deviceId) {
  return db.prepare('SELECT MAX(received_at) t FROM sync_log WHERE device_id = ?').get(deviceId).t;
}

function latestTelemetry(db, deviceId) {
  const r = db.prepare(`SELECT ts, payload FROM events WHERE device_id = ? AND type = 'telemetry.reading' ORDER BY ts DESC LIMIT 1`).get(deviceId);
  return r ? { ts: r.ts, ...JSON.parse(r.payload) } : null;
}

function activeAlerts(db, deviceId) {
  const state = new Map();
  for (const e of evs(db, deviceId, ['device.alert'])) {
    if (e.p.level === 'normal') state.delete(e.p.kind);
    else state.set(e.p.kind, { jenis: e.p.kind, level: e.p.level, nilai: e.p.value, sejak: e.ts, pesan: e.p.message });
  }
  return [...state.values()];
}

function groupsState(db, deviceId) {
  const g = new Map();
  for (const e of evs(db, deviceId, ['group.formed', 'group.archived'])) {
    if (e.type === 'group.formed') g.set(e.p.group_id, { group_id: e.p.group_id, level: e.p.level, label: e.p.label, active: true });
    else if (g.has(e.p.group_id)) g.get(e.p.group_id).active = false;
  }
  return g;
}

function countScheduledDays(dev, fromMs, untilMs) {
  const days = JSON.parse(dev.schedule_days || '[2,4]');
  const tz = dev.tz_offset_min;
  let n = 0;
  for (let d = Math.floor((fromMs + tz * 60000) / DAY); d <= Math.floor((untilMs + tz * 60000) / DAY); d++) {
    if (days.includes(new Date(d * DAY).getUTCDay())) n++;
  }
  return n;
}

export function sessions(db, dev, { days = 28, until = Date.now() } = {}) {
  const fromMs = Math.max(until - days * DAY, dev.program_start ? Date.parse(dev.program_start) : 0);
  const fromIso = new Date(fromMs).toISOString();
  const closed = evs(db, dev.device_id, ['session.closed']).filter((e) => e.p.ended_at >= fromIso);
  const started = new Map(evs(db, dev.device_id, ['session.started']).map((e) => [e.p.session_id, e.p]));
  const groups = [...groupsState(db, dev.device_id).values()].filter((g) => g.active);
  // Asumsi: tiap kelompok aktif dijadwalkan satu sesi pada setiap hari sesi (2 sesi/pekan).
  const planned = countScheduledDays(dev, fromMs, until) * groups.length;
  const done = closed.length;
  const withVolunteer = closed.filter((e) => e.p.volunteer_present).length;
  const minutes = closed.reduce((s, e) => s + (e.p.duration_min || 0), 0);
  return {
    terjadwal: planned,
    terlaksana: done,
    persen_terlaksana: planned ? Math.min(100, Math.round((done / planned) * 1000) / 10) : null,
    persen_relawan_hadir: done ? Math.round((withVolunteer / done) * 1000) / 10 : null,
    rata_menit: done ? Math.round(minutes / done) : null,
    oleh_relawan: closed.filter((e) => started.get(e.p.session_id)?.facilitator_role === 'relawan').length,
    kelompok_aktif: groups.length,
  };
}

// Numerasi: level awal (diagnostik pertama) vs level terkini, hanya agregat.
export function numeracy(db, dev) {
  const out = withdrawnCodes(db, dev.device_id);
  const first = new Map(), last = new Map();
  for (const e of evs(db, dev.device_id, ['diagnostic.finished'])) {
    const c = e.p.student_code;
    if (out.has(c)) continue;
    if (!first.has(c)) first.set(c, e.p);
    last.set(c, e.p);
  }
  const n = first.size;
  const dist = Object.fromEntries(LEVELS.map((l) => [l.level, 0]));
  let sumFirst = 0, sumLast = 0, naik = 0, reassessed = 0, sumScoreFirst = 0, sumScoreLast = 0;
  for (const [c, f] of first) {
    const l = last.get(c);
    sumFirst += f.level;
    sumLast += l.level;
    sumScoreFirst += f.total ? f.score / f.total : 0;
    sumScoreLast += l.total ? l.score / l.total : 0;
    dist[l.level] = (dist[l.level] || 0) + 1;
    if (l !== f) reassessed++;
    if (l.level > f.level) naik++;
  }
  const answered = evs(db, dev.device_id, ['answer.submitted'], new Date(Date.now() - 28 * DAY).toISOString()).filter((e) => !out.has(e.p.student_code));
  const groupsLevel = {};
  for (const g of groupsState(db, dev.device_id).values()) if (g.active) groupsLevel[g.level] = (groupsLevel[g.level] || 0) + 1;
  return {
    murid_terdiagnosis: n,
    murid_diases_ulang: reassessed,
    rata_level_awal: n ? Math.round((sumFirst / n) * 100) / 100 : null,
    rata_level_kini: n ? Math.round((sumLast / n) * 100) / 100 : null,
    rata_skor_awal_persen: n ? Math.round((sumScoreFirst / n) * 1000) / 10 : null,
    rata_skor_kini_persen: n ? Math.round((sumScoreLast / n) * 1000) / 10 : null,
    persen_naik_level: reassessed ? Math.round((naik / reassessed) * 1000) / 10 : null,
    sebaran_level_kini: dist,
    kelompok_per_level: groupsLevel,
    jawaban_28_hari: answered.length,
    persen_benar_28_hari: answered.length ? Math.round((answered.filter((e) => e.p.correct).length / answered.length) * 1000) / 10 : null,
  };
}

export function statusColor(lastSignalIso, now = Date.now()) {
  if (!lastSignalIso) return 'abu';
  const h = (now - Date.parse(lastSignalIso)) / 3600000;
  if (h > INACTIVE_HOURS) return 'merah';
  if (h > 24) return 'kuning';
  return 'hijau';
}

export function schoolSummary(db, dev) {
  const sig = lastSignal(db, dev.device_id);
  const tel = latestTelemetry(db, dev.device_id);
  const reportsOpen = openReports(db, dev.device_id).length;
  return {
    school_id: dev.school_id,
    device_id: dev.device_id,
    sekolah: dev.school_name,
    wilayah: dev.region,
    kode_wilayah: dev.region_code,
    pembanding: !!dev.pembanding,
    status: statusColor(sig),
    detak_terakhir: sig,
    sinkron_terakhir: lastSync(db, dev.device_id),
    waktu_aktif: uptime(db, dev),
    baterai_pct: tel?.battery_pct ?? null,
    suhu: tel?.temp ?? null,
    sesi: sessions(db, dev),
    numerasi: numeracy(db, dev),
    peringatan: activeAlerts(db, dev.device_id),
    laporan_terbuka: reportsOpen,
  };
}

export function openReports(db, deviceId) {
  const map = new Map();
  for (const e of evs(db, deviceId, ['report.filed', 'report.resolved'])) {
    if (e.type === 'report.filed') map.set(e.p.report_id, { report_id: e.p.report_id, deskripsi: e.p.description, pelapor: String(e.p.reporter || '').split(':')[0], dibuat: e.ts, ada_foto: !!e.p.photo, status: 'terbuka' });
    else if (map.has(e.p.report_id)) Object.assign(map.get(e.p.report_id), { status: 'selesai', tindakan: e.p.resolution, selesai: e.ts });
  }
  return [...map.values()].filter((r) => r.status === 'terbuka');
}

export function deviceHealth(db, dev, hours = 72) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const tel = evs(db, dev.device_id, ['telemetry.reading'], since).map((e) => ({
    ts: e.p.measured_at || e.ts, baterai: e.p.battery_pct, tegangan: e.p.voltage, suhu: e.p.temp, lembap: e.p.humidity, sumber: e.p.power_source,
  }));
  const boots = evs(db, dev.device_id, ['server.boot'], new Date(Date.now() - 28 * DAY).toISOString()).map((e) => e.ts);
  const allReports = new Map();
  for (const e of evs(db, dev.device_id, ['report.filed', 'report.resolved'])) {
    if (e.type === 'report.filed') allReports.set(e.p.report_id, { report_id: e.p.report_id, deskripsi: e.p.description, pelapor: String(e.p.reporter || '').split(':')[0], dibuat: e.ts, ada_foto: !!e.p.photo, status: 'terbuka' });
    else if (allReports.has(e.p.report_id)) Object.assign(allReports.get(e.p.report_id), { status: 'selesai', tindakan: e.p.resolution, selesai: e.ts });
  }
  return {
    device_id: dev.device_id,
    sekolah: dev.school_name,
    serial: dev.serial,
    dipasang: dev.installed_at,
    versi_perangkat_lunak: dev.sw_version,
    versi_firmware: dev.fw_version,
    status: statusColor(lastSignal(db, dev.device_id)),
    detak_terakhir: lastSignal(db, dev.device_id),
    sinkron_terakhir: lastSync(db, dev.device_id),
    waktu_aktif_7_hari: uptime(db, dev, { days: 7 }),
    waktu_aktif_28_hari: uptime(db, dev, { days: 28 }),
    telemetri: tel,
    nyala_ulang_28_hari: boots.length,
    peringatan: activeAlerts(db, dev.device_id),
    laporan: [...allReports.values()].sort((a, b) => (a.dibuat < b.dibuat ? 1 : -1)),
    riwayat_sinkron: db.prepare('SELECT received_at, n_events, n_new, via FROM sync_log WHERE device_id = ? ORDER BY id DESC LIMIT 10').all(dev.device_id),
  };
}

export function inactiveDevices(db, now = Date.now()) {
  return db
    .prepare('SELECT * FROM devices')
    .all()
    .map((d) => ({ d, sig: lastSignal(db, d.device_id) }))
    .filter(({ sig }) => sig && now - Date.parse(sig) > INACTIVE_HOURS * 3600000);
}
