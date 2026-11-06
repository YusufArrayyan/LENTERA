// Inti layanan LENTERA di server sekolah: penulisan kejadian, proyeksi, dan aturan domain.
import crypto from 'node:crypto';
import { tx, getMeta, setMeta } from './db.js';
import { HttpError } from '../shared/http.js';
import {
  getItem, publicItem, checkAnswer, diagnosticStep, adaptStep, randomItemId, levelInfo, LEVELS, MAX_LEVEL,
} from '../shared/numerasi.js';

export const GROUP_MAX = 15; // NF-1: satu kelompok = maksimal 15 tablet bersamaan
export const REASSESS_DAYS = 28;
export const HEARTBEAT_MIN = 5;
export const DEFAULT_THRESHOLDS = {
  // Asumsi rancangan; dikalibrasi di laboratorium (PRD bagian 16).
  baterai_waspada_pct: 30,
  baterai_kritis_pct: 15,
  suhu_waspada_c: 40,
  suhu_kritis_c: 45,
  lembap_waspada_pct: 85,
  iot_hilang_menit: 20,
};

const nowIso = () => new Date().toISOString();

// ---------- Penulisan kejadian ----------
let depth = 0;
export function atomic(db, fn) {
  if (depth > 0) return fn();
  depth++;
  try {
    return tx(db, fn);
  } finally {
    depth--;
  }
}

export function emit(ctx, type, payload, opts = {}) {
  const { db, cfg } = ctx;
  return atomic(db, () => {
    const event_id = opts.event_id || crypto.randomUUID();
    if (db.prepare('SELECT 1 FROM events WHERE event_id = ?').get(event_id)) return { event_id, duplicate: true };
    const seq = getMeta(db, 'seq', 0) + 1;
    setMeta(db, 'seq', seq);
    const ev = { event_id, device_id: cfg.device_id, seq, type, ts: opts.ts || nowIso(), payload };
    db.prepare('INSERT INTO events(event_id, device_id, seq, type, ts, payload) VALUES (?,?,?,?,?,?)').run(
      ev.event_id, ev.device_id, ev.seq, ev.type, ev.ts, JSON.stringify(payload)
    );
    applyEvent(db, ev);
    return { ...ev, duplicate: false };
  });
}

export function applyEvent(db, ev) {
  const p = ev.payload;
  switch (ev.type) {
    case 'student.enrolled':
      db.prepare(`INSERT OR IGNORE INTO students(student_code, grade, status, enrolled_at) VALUES (?,?, 'menunggu_persetujuan', ?)`).run(p.student_code, p.grade, ev.ts);
      break;
    case 'consent.recorded':
      db.prepare('INSERT OR REPLACE INTO consent(student_code, given_at, form_version, giver_relation) VALUES (?,?,?,?)').run(p.student_code, p.given_at, p.form_version, p.giver_relation);
      break;
    case 'student.activated':
      db.prepare(`UPDATE students SET status = 'aktif' WHERE student_code = ?`).run(p.student_code);
      break;
    case 'student.withdrawn':
      db.prepare(`UPDATE students SET status = 'ditarik', group_id = NULL WHERE student_code = ?`).run(p.student_code);
      db.prepare('DELETE FROM answers WHERE student_code = ?').run(p.student_code);
      db.prepare('DELETE FROM practice_state WHERE student_code = ?').run(p.student_code);
      db.prepare('DELETE FROM consent WHERE student_code = ?').run(p.student_code);
      break;
    case 'diagnostic.started':
      db.prepare('INSERT OR IGNORE INTO diag(attempt_id, student_code, kind, siklus, started_at) VALUES (?,?,?,?,?)').run(p.attempt_id, p.student_code, p.kind, p.siklus || 0, ev.ts);
      break;
    case 'answer.submitted':
      db.prepare('INSERT OR IGNORE INTO answers(event_id, student_code, attempt_id, activity, item_id, level, sub, response, correct, ms, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        ev.event_id, p.student_code, p.attempt_id || null, p.activity, p.item_id, p.level, p.sub, String(p.response), p.correct ? 1 : 0, p.ms ?? null, ev.ts
      );
      break;
    case 'diagnostic.finished':
      db.prepare('UPDATE diag SET finished_at = ?, level_result = ?, score = ?, total = ? WHERE attempt_id = ?').run(ev.ts, p.level, p.score, p.total, p.attempt_id);
      db.prepare('UPDATE students SET level = ?, last_assessed_at = ?, reassess_open = 0, siklus = ? WHERE student_code = ?').run(p.level, ev.ts, p.siklus || 0, p.student_code);
      db.prepare(`INSERT INTO practice_state(student_code, level, sub) VALUES (?, ?, 1)
        ON CONFLICT(student_code) DO UPDATE SET level = excluded.level, sub = 1, streak = 0, wrong_streak = 0, siap_naik = 0, current_item = NULL`).run(p.student_code, p.level);
      break;
    case 'practice.state':
      db.prepare(`INSERT INTO practice_state(student_code, level, sub, streak, wrong_streak, total, correct, siap_naik, current_item) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(student_code) DO UPDATE SET level=excluded.level, sub=excluded.sub, streak=excluded.streak, wrong_streak=excluded.wrong_streak,
        total=excluded.total, correct=excluded.correct, siap_naik=excluded.siap_naik, current_item=excluded.current_item`).run(
        p.student_code, p.level, p.sub, p.streak, p.wrong_streak, p.total, p.correct, p.siap_naik ? 1 : 0, p.current_item || null
      );
      break;
    case 'reassessment.opened':
      for (const code of p.student_codes) db.prepare(`UPDATE students SET reassess_open = 1 WHERE student_code = ? AND status = 'aktif'`).run(code);
      break;
    case 'group.formed':
      db.prepare('INSERT OR IGNORE INTO groups(group_id, level, label, cycle, created_at) VALUES (?,?,?,?,?)').run(p.group_id, p.level, p.label, p.cycle || 1, ev.ts);
      break;
    case 'group.assigned':
      db.prepare('UPDATE students SET group_id = ? WHERE student_code = ?').run(p.group_id, p.student_code);
      break;
    case 'group.archived':
      db.prepare('UPDATE groups SET active = 0 WHERE group_id = ?').run(p.group_id);
      break;
    case 'session.started':
      db.prepare('INSERT OR IGNORE INTO lsessions(session_id, group_id, facilitator_id, facilitator_role, started_at) VALUES (?,?,?,?,?)').run(
        p.session_id, p.group_id, p.facilitator_id, p.facilitator_role, p.started_at || ev.ts
      );
      break;
    case 'session.attendance':
      db.prepare('INSERT OR REPLACE INTO attendance(session_id, student_code, present) VALUES (?,?,?)').run(p.session_id, p.student_code, p.present ? 1 : 0);
      break;
    case 'session.closed':
      db.prepare('UPDATE lsessions SET ended_at = ?, duration_min = ?, notes = ?, volunteer_present = ?, students_finished = ? WHERE session_id = ?').run(
        p.ended_at, p.duration_min, p.notes || '', p.volunteer_present ? 1 : 0, p.students_finished ?? null, p.session_id
      );
      break;
    case 'telemetry.reading':
      db.prepare('INSERT OR IGNORE INTO telemetry(event_id, ts, module_id, voltage, current, battery_pct, temp, humidity, power_source) VALUES (?,?,?,?,?,?,?,?,?)').run(
        ev.event_id, p.measured_at || ev.ts, p.module_id, p.voltage, p.current, p.battery_pct, p.temp, p.humidity, p.power_source
      );
      break;
    case 'device.alert':
      if (p.level === 'normal') db.prepare('DELETE FROM alerts WHERE kind = ?').run(p.kind);
      else db.prepare('INSERT OR REPLACE INTO alerts(kind, level, value, since, message) VALUES (?,?,?,?,?)').run(p.kind, p.level, p.value, ev.ts, p.message);
      break;
    case 'report.filed':
      db.prepare(`INSERT OR IGNORE INTO reports(report_id, device_id, reporter, description, photo, status, created_at) VALUES (?,?,?,?,?, 'terbuka', ?)`).run(
        p.report_id, p.device_id, p.reporter, p.description, p.photo || null, ev.ts
      );
      break;
    case 'report.resolved':
      db.prepare(`UPDATE reports SET status = 'selesai', resolved_at = ?, resolution = ? WHERE report_id = ?`).run(ev.ts, p.resolution, p.report_id);
      break;
    default:
      break; // server.boot, server.heartbeat, user.registered, update.applied, dsb. cukup ada di log
  }
}

// ---------- Audit (F-4.4) ----------
export function audit(ctx, who, action, target) {
  ctx.db.prepare('INSERT INTO audit(ts, user_id, role, action, target) VALUES (?,?,?,?,?)').run(nowIso(), who?.user_id || who?.student_code || null, who?.role || null, action, target || null);
}

// ---------- Murid ----------
const CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY34679';
export function newStudentCode(db) {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const s = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `${s.slice(0, 3)}-${s.slice(3)}`;
    if (!db.prepare('SELECT 1 FROM students WHERE student_code = ?').get(code)) return code;
  }
}
export function normalizeCode(c) {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6 ? `${s.slice(0, 3)}-${s.slice(3)}` : null;
}

export function enrollStudent(ctx, { name, grade }) {
  const n = String(name || '').trim();
  const g = Number(grade);
  if (n.length < 2) throw new HttpError(400, 'Tulis nama murid, minimal 2 huruf.', 'nama_kosong');
  if (!(g >= 1 && g <= 6)) throw new HttpError(400, 'Pilih kelas I sampai VI.', 'kelas_salah');
  return atomic(ctx.db, () => {
    const code = newStudentCode(ctx.db);
    ctx.db.prepare('INSERT INTO student_identity(student_code, name, class_grade, created_at) VALUES (?,?,?,?)').run(code, n, g, nowIso());
    emit(ctx, 'student.enrolled', { student_code: code, grade: g });
    return code;
  });
}

export function recordConsent(ctx, code, { given_at, form_version, giver_relation }) {
  const st = ctx.db.prepare('SELECT * FROM students WHERE student_code = ?').get(code);
  if (!st || st.status === 'ditarik') throw new HttpError(404, 'Murid dengan kode ini tidak ditemukan.', 'murid_tidak_ada');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(given_at || ''))) throw new HttpError(400, 'Isi tanggal persetujuan sesuai formulir.', 'tanggal_salah');
  if (!String(form_version || '').trim()) throw new HttpError(400, 'Isi versi formulir yang ditandatangani.', 'versi_kosong');
  if (!['Ibu', 'Ayah', 'Wali'].includes(giver_relation)) throw new HttpError(400, 'Pilih siapa yang menandatangani: Ibu, Ayah, atau Wali.', 'pemberi_salah');
  emit(ctx, 'consent.recorded', { student_code: code, given_at, form_version: String(form_version).trim(), giver_relation });
}

export function activateStudent(ctx, code) {
  const st = ctx.db.prepare('SELECT * FROM students WHERE student_code = ?').get(code);
  if (!st || st.status === 'ditarik') throw new HttpError(404, 'Murid dengan kode ini tidak ditemukan.', 'murid_tidak_ada');
  // US-7: murid tanpa catatan persetujuan tidak dapat diaktifkan.
  if (!ctx.db.prepare('SELECT 1 FROM consent WHERE student_code = ?').get(code)) {
    throw new HttpError(409, 'Murid belum bisa diaktifkan. Catat dulu persetujuan tertulis orang tua atau wali.', 'belum_ada_persetujuan');
  }
  if (st.status !== 'aktif') emit(ctx, 'student.activated', { student_code: code });
}

export function withdrawStudent(ctx, code, reason) {
  const st = ctx.db.prepare('SELECT * FROM students WHERE student_code = ?').get(code);
  if (!st || st.status === 'ditarik') throw new HttpError(404, 'Murid dengan kode ini tidak ditemukan.', 'murid_tidak_ada');
  atomic(ctx.db, () => {
    ctx.db.prepare('DELETE FROM student_identity WHERE student_code = ?').run(code);
    emit(ctx, 'student.withdrawn', { student_code: code, reason: reason === 'permintaan_ortu' ? 'permintaan_ortu' : 'lainnya' });
  });
}

// ---------- Kelompok ----------
const LETTERS = 'ABCDEFGH';
function groupLabel(level, idx) {
  return `${levelInfo(level).nama} ${LETTERS[idx] || idx + 1}`;
}

export function assignToLevelGroup(ctx, code, level, reason = 'otomatis', by = null) {
  const db = ctx.db;
  return atomic(db, () => {
    const groups = db.prepare('SELECT g.group_id, (SELECT COUNT(*) FROM students s WHERE s.group_id = g.group_id AND s.status = \'aktif\') n FROM groups g WHERE g.active = 1 AND g.level = ? ORDER BY g.created_at').all(level);
    let target = groups.find((g) => g.n < GROUP_MAX);
    if (!target) {
      const group_id = crypto.randomUUID();
      const idx = db.prepare('SELECT COUNT(*) n FROM groups WHERE level = ?').get(level).n;
      emit(ctx, 'group.formed', { group_id, level, label: groupLabel(level, idx), cycle: 1 });
      target = { group_id };
    }
    const cur = db.prepare('SELECT group_id FROM students WHERE student_code = ?').get(code);
    if (cur?.group_id !== target.group_id) emit(ctx, 'group.assigned', { student_code: code, group_id: target.group_id, reason, by });
    return target.group_id;
  });
}

export function reassignManual(ctx, code, group_id, user) {
  const g = ctx.db.prepare('SELECT * FROM groups WHERE group_id = ? AND active = 1').get(group_id);
  if (!g) throw new HttpError(404, 'Kelompok tujuan tidak ditemukan.', 'kelompok_tidak_ada');
  const st = ctx.db.prepare(`SELECT * FROM students WHERE student_code = ? AND status = 'aktif'`).get(code);
  if (!st) throw new HttpError(404, 'Murid aktif dengan kode ini tidak ditemukan.', 'murid_tidak_ada');
  const n = ctx.db.prepare(`SELECT COUNT(*) n FROM students WHERE group_id = ? AND status = 'aktif'`).get(group_id).n;
  if (n >= GROUP_MAX && st.group_id !== group_id) throw new HttpError(409, `Kelompok ${g.label} sudah berisi ${GROUP_MAX} murid. Pilih kelompok lain atau buat kelompok baru.`, 'kelompok_penuh');
  emit(ctx, 'group.assigned', { student_code: code, group_id, reason: 'manual', by: user.user_id });
}

export function createGroup(ctx, level) {
  const l = Number(level);
  if (!levelInfo(l)) throw new HttpError(400, 'Pilih level 1 sampai 5.', 'level_salah');
  const group_id = crypto.randomUUID();
  const idx = ctx.db.prepare('SELECT COUNT(*) n FROM groups WHERE level = ?').get(l).n;
  emit(ctx, 'group.formed', { group_id, level: l, label: groupLabel(l, idx), cycle: 1 });
  return group_id;
}

// Setelah asesmen ulang: pindahkan murid yang levelnya berubah ke kelompok level barunya.
export function regroup(ctx, user) {
  const db = ctx.db;
  return atomic(db, () => {
    const rows = db.prepare(`SELECT s.student_code, s.level, g.level glevel FROM students s LEFT JOIN groups g ON g.group_id = s.group_id WHERE s.status = 'aktif' AND s.level IS NOT NULL`).all();
    let moved = 0;
    for (const r of rows) {
      if (r.glevel !== r.level) {
        assignToLevelGroup(ctx, r.student_code, r.level, 'asesmen_ulang', user?.user_id);
        moved++;
      }
    }
    // Arsipkan kelompok kosong
    for (const g of db.prepare(`SELECT group_id FROM groups g WHERE active = 1 AND NOT EXISTS (SELECT 1 FROM students s WHERE s.group_id = g.group_id AND s.status = 'aktif')`).all()) {
      emit(ctx, 'group.archived', { group_id: g.group_id });
    }
    return moved;
  });
}

export function openReassessment(ctx, { group_id }, user) {
  const codes = ctx.db
    .prepare(`SELECT student_code FROM students WHERE status = 'aktif' AND last_assessed_at IS NOT NULL ${group_id ? 'AND group_id = ?' : ''}`)
    .all(...(group_id ? [group_id] : []))
    .map((r) => r.student_code);
  if (!codes.length) throw new HttpError(409, 'Belum ada murid yang pernah ikut diagnostik di kelompok ini.', 'tidak_ada_murid');
  emit(ctx, 'reassessment.opened', { group_id: group_id || null, student_codes: codes, by: user.user_id });
  return codes.length;
}

// ---------- Aktivitas murid ----------
function isReassessDue(st) {
  if (!st.last_assessed_at) return false;
  return Date.now() - Date.parse(st.last_assessed_at) >= REASSESS_DAYS * 86400000;
}

function openAttempt(ctx, st) {
  const db = ctx.db;
  const open = db.prepare('SELECT * FROM diag WHERE student_code = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1').get(st.student_code);
  if (open) return open;
  const first = !st.last_assessed_at;
  const attempt_id = crypto.randomUUID();
  const siklus = first ? 0 : (st.siklus || 0) + 1;
  emit(ctx, 'diagnostic.started', { attempt_id, student_code: st.student_code, kind: first ? 'awal' : 'ulang', siklus });
  return db.prepare('SELECT * FROM diag WHERE attempt_id = ?').get(attempt_id);
}

function diagState(ctx, attempt) {
  const answers = ctx.db.prepare('SELECT level, correct FROM answers WHERE attempt_id = ? ORDER BY ts, rowid').all(attempt.attempt_id).map((a) => ({ level: a.level, correct: !!a.correct }));
  return diagnosticStep(answers, attempt.siklus);
}

function studentForActivity(ctx, code) {
  const st = ctx.db.prepare('SELECT * FROM students WHERE student_code = ?').get(code);
  if (!st || st.status === 'ditarik') throw new HttpError(404, 'Kode ini tidak terdaftar. Tanyakan kartumu ke guru.', 'murid_tidak_ada');
  if (st.status !== 'aktif') throw new HttpError(403, 'Kartumu belum aktif. Minta guru mengaktifkannya.', 'belum_aktif');
  return st;
}

export function nextActivity(ctx, code) {
  const db = ctx.db;
  const st = studentForActivity(ctx, code);
  return atomic(db, () => {
    if (!st.last_assessed_at || st.reassess_open || isReassessDue(st)) {
      const attempt = openAttempt(ctx, st);
      const step = diagState(ctx, attempt);
      if (!step.selesai) {
        const item = getItem(step.nextItemId);
        return {
          mode: 'diagnostik',
          jenis: attempt.kind,
          attempt_id: attempt.attempt_id,
          nomor: step.total + 1,
          item: publicItem(item),
        };
      }
      finishDiagnostic(ctx, st, attempt, step);
      return nextActivity(ctx, code);
    }
    let ps = db.prepare('SELECT * FROM practice_state WHERE student_code = ?').get(code);
    if (!ps) ps = { student_code: code, level: st.level || 1, sub: 1, streak: 0, wrong_streak: 0, total: 0, correct: 0, siap_naik: 0 };
    if (!ps.current_item || !getItem(ps.current_item) || getItem(ps.current_item).level !== ps.level || getItem(ps.current_item).sub !== ps.sub) {
      ps = { ...ps, current_item: randomItemId(ps.level, ps.sub) };
      emit(ctx, 'practice.state', ps);
    }
    return {
      mode: 'latihan',
      level: ps.level,
      sub: ps.sub,
      nama_level: levelInfo(ps.level).nama,
      benar: ps.correct,
      total: ps.total,
      siap_naik: !!ps.siap_naik,
      item: publicItem(getItem(ps.current_item)),
    };
  });
}

function finishDiagnostic(ctx, st, attempt, step) {
  emit(ctx, 'diagnostic.finished', {
    attempt_id: attempt.attempt_id,
    student_code: st.student_code,
    kind: attempt.kind,
    siklus: attempt.siklus,
    level: step.level,
    score: step.skor,
    total: step.total,
    mahir: !!step.mahir,
  });
  // Murid baru langsung dikelompokkan; hasil asesmen ulang menunggu guru menekan "Perbarui kelompok".
  if (attempt.kind === 'awal') assignToLevelGroup(ctx, st.student_code, step.level, 'otomatis');
}

export function submitAnswer(ctx, code, body) {
  const db = ctx.db;
  const st = studentForActivity(ctx, code);
  const event_id = typeof body.event_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.event_id) ? body.event_id : crypto.randomUUID();
  const dup = db.prepare('SELECT * FROM answers WHERE event_id = ?').get(event_id);
  if (dup) {
    const it = getItem(dup.item_id);
    return { benar: !!dup.correct, jawaban_benar: it?.answer, ulang: true, berikutnya: nextActivity(ctx, code) };
  }
  const check = checkAnswer(body.item_id, body.response);
  if (!check) throw new HttpError(400, 'Soal tidak dikenali.', 'butir_salah');
  const ms = Math.max(0, Math.min(Number(body.ms) || 0, 3600000));
  return atomic(db, () => {
    const cur = nextActivity(ctx, code);
    if (cur.item.item_id !== body.item_id) {
      return { kedaluwarsa: true, pesan: 'Soal ini sudah diganti. Lanjutkan dengan soal berikutnya.', berikutnya: cur };
    }
    let feedback = {};
    if (cur.mode === 'diagnostik') {
      emit(ctx, 'answer.submitted', {
        student_code: code, attempt_id: cur.attempt_id, activity: 'diagnostik', item_id: body.item_id,
        level: check.item.level, sub: check.item.sub, response: String(body.response), correct: check.correct, ms,
      }, { event_id });
      const attempt = db.prepare('SELECT * FROM diag WHERE attempt_id = ?').get(cur.attempt_id);
      const step = diagState(ctx, attempt);
      if (step.selesai) {
        finishDiagnostic(ctx, st, attempt, step);
        feedback.diagnostik_selesai = { level: step.level, nama_level: levelInfo(step.level).nama, skor: step.skor, total: step.total };
      }
      // Diagnostik tidak menunjukkan benar/salah agar murid tidak tertekan.
      return { tercatat: true, ...feedback, berikutnya: nextActivity(ctx, code) };
    }
    emit(ctx, 'answer.submitted', {
      student_code: code, activity: 'latihan', item_id: body.item_id,
      level: check.item.level, sub: check.item.sub, response: String(body.response), correct: check.correct, ms,
    }, { event_id });
    const ps = db.prepare('SELECT * FROM practice_state WHERE student_code = ?').get(code);
    const next = adaptStep(ps, check.correct);
    const perubahan = next.perubahan;
    delete next.perubahan;
    next.current_item = randomItemId(next.level, next.sub);
    emit(ctx, 'practice.state', next);
    return { benar: check.correct, jawaban_benar: check.answer, perubahan, berikutnya: nextActivity(ctx, code) };
  });
}

// ---------- Sesi (F-1.7) ----------
export function startSession(ctx, { session_id, group_id, started_at }, user) {
  const g = ctx.db.prepare('SELECT * FROM groups WHERE group_id = ? AND active = 1').get(group_id);
  if (!g) throw new HttpError(404, 'Kelompok tidak ditemukan. Muat ulang halaman lalu pilih kelompok lagi.', 'kelompok_tidak_ada');
  const sid = typeof session_id === 'string' && session_id.length >= 8 ? session_id : crypto.randomUUID();
  const exists = ctx.db.prepare('SELECT * FROM lsessions WHERE session_id = ?').get(sid);
  if (exists) return exists;
  const open = ctx.db.prepare('SELECT * FROM lsessions WHERE group_id = ? AND ended_at IS NULL').get(group_id);
  if (open) throw new HttpError(409, `Sesi untuk ${g.label} masih berjalan. Tutup sesi itu dulu.`, 'sesi_berjalan');
  emit(ctx, 'session.started', {
    session_id: sid, group_id, facilitator_id: user.user_id, facilitator_role: user.role,
    started_at: validIso(started_at) || nowIso(),
  });
  return ctx.db.prepare('SELECT * FROM lsessions WHERE session_id = ?').get(sid);
}

function validIso(s) {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  if (Number.isNaN(t) || t > Date.now() + 5 * 60000) return null;
  return new Date(t).toISOString();
}

export function setAttendance(ctx, session_id, list, opts = {}) {
  const s = ctx.db.prepare('SELECT * FROM lsessions WHERE session_id = ?').get(session_id);
  if (!s) throw new HttpError(404, 'Sesi tidak ditemukan.', 'sesi_tidak_ada');
  atomic(ctx.db, () => {
    for (const a of list || []) {
      const cur = ctx.db.prepare('SELECT present FROM attendance WHERE session_id = ? AND student_code = ?').get(session_id, a.student_code);
      if (cur && !!cur.present === !!a.present) continue;
      emit(ctx, 'session.attendance', { session_id, student_code: a.student_code, present: !!a.present }, a.event_id ? { event_id: a.event_id } : {});
    }
  });
}

export function closeSession(ctx, session_id, { ended_at, notes, volunteer_present, students_finished, event_id }) {
  const s = ctx.db.prepare('SELECT * FROM lsessions WHERE session_id = ?').get(session_id);
  if (!s) throw new HttpError(404, 'Sesi tidak ditemukan.', 'sesi_tidak_ada');
  if (s.ended_at) return s;
  const end = validIso(ended_at) || nowIso();
  const duration = Math.max(1, Math.round((Date.parse(end) - Date.parse(s.started_at)) / 60000));
  emit(ctx, 'session.closed', {
    session_id, ended_at: end, duration_min: duration, notes: String(notes || '').slice(0, 2000),
    volunteer_present: s.facilitator_role === 'relawan' ? true : !!volunteer_present,
    students_finished: Number.isFinite(+students_finished) ? +students_finished : null,
  }, event_id ? { event_id } : {});
  return ctx.db.prepare('SELECT * FROM lsessions WHERE session_id = ?').get(session_id);
}

// ---------- Telemetri dan peringatan (F-2.1–F-2.4) ----------
// Asumsi: baterai LiFePO4 12,8 V (4 sel). 12,0 V ≈ 0%, 13,4 V ≈ 100%. Kalibrasi di lab.
export function voltageToPct(v) {
  if (!Number.isFinite(v)) return null;
  const pct = ((v - 12.0) / (13.4 - 12.0)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

export function thresholds(ctx) {
  return { ...DEFAULT_THRESHOLDS, ...(getMeta(ctx.db, 'thresholds', {}) || {}) };
}

function num(v, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

export function ingestTelemetry(ctx, body) {
  const reading = {
    module_id: String(body.module_id || body.device_id || 'iot').slice(0, 64),
    voltage: num(body.voltage, 0, 60),
    current: num(body.current, -50, 50),
    temp: num(body.temp ?? body.temperature, -20, 90),
    humidity: num(body.humidity, 0, 100),
    power_source: ['adaptor', 'plts', 'baterai'].includes(body.power_source) ? body.power_source : 'tidak_diketahui',
    measured_at: validIso(body.measured_at) || nowIso(),
  };
  reading.battery_pct = body.battery_pct != null ? num(body.battery_pct, 0, 100) : voltageToPct(reading.voltage);
  const ev = emit(ctx, 'telemetry.reading', reading, body.event_id && /^[0-9a-f-]{36}$/i.test(body.event_id) ? { event_id: body.event_id } : {});
  const alerts = evaluateAlerts(ctx, reading);
  const worst = alerts.some((a) => a.level === 'kritis') ? 'kritis' : alerts.length ? 'waspada' : 'normal';
  // Respons dipakai firmware untuk menyalakan lampu indikator (hijau/kuning/merah).
  return { diterima: !ev.duplicate, event_id: ev.event_id, lampu: { normal: 'hijau', waspada: 'kuning', kritis: 'merah' }[worst], peringatan: alerts };
}

function evaluateAlerts(ctx, r) {
  const t = thresholds(ctx);
  const checks = [];
  if (r.battery_pct != null) {
    const lv = r.battery_pct <= t.baterai_kritis_pct ? 'kritis' : r.battery_pct <= t.baterai_waspada_pct ? 'waspada' : 'normal';
    checks.push({ kind: 'baterai', level: lv, value: r.battery_pct, message: lv === 'kritis' ? `Baterai tinggal ${r.battery_pct}%. Simpan pekerjaan; server bisa mati sebentar lagi.` : `Baterai ${r.battery_pct}%. Sambungkan ke listrik atau panel surya bila bisa.` });
  }
  if (r.temp != null) {
    const lv = r.temp >= t.suhu_kritis_c ? 'kritis' : r.temp >= t.suhu_waspada_c ? 'waspada' : 'normal';
    checks.push({ kind: 'suhu', level: lv, value: r.temp, message: `Suhu kotak ${r.temp.toFixed(1)} °C. Pindahkan kotak ke tempat teduh dan jangan tutupi lubang udaranya.` });
  }
  if (r.humidity != null) {
    const lv = r.humidity >= t.lembap_waspada_pct ? 'waspada' : 'normal';
    checks.push({ kind: 'kelembapan', level: lv, value: r.humidity, message: `Kelembapan ${Math.round(r.humidity)}%. Jauhkan kotak dari jendela terbuka dan lantai basah.` });
  }
  const active = [];
  for (const c of checks) {
    const cur = ctx.db.prepare('SELECT level FROM alerts WHERE kind = ?').get(c.kind);
    const curLevel = cur?.level || 'normal';
    if (curLevel !== c.level) emit(ctx, 'device.alert', c);
    if (c.level !== 'normal') active.push({ jenis: c.kind, level: c.level, pesan: c.message });
  }
  return active;
}

// ---------- Detak dan waktu aktif (F-2.6) ----------
export function heartbeat(ctx, bootId, startedAt) {
  emit(ctx, 'server.heartbeat', { boot_id: bootId, uptime_s: Math.round((Date.now() - startedAt) / 1000) });
}

export function localParts(date, tzMin) {
  const d = new Date(date.getTime() + tzMin * 60000);
  return { day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dateStr: d.toISOString().slice(0, 10) };
}

function hm(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
}

// Persentase slot 5 menit pada jam sekolah hari ini yang punya detak.
export function uptimeToday(ctx) {
  const school = ctx.cfg.school;
  const tz = school.tz_offset_min ?? 480;
  const now = new Date();
  const lp = localParts(now, tz);
  const start = hm(school.jam_mulai || '07:00');
  const end = hm(school.jam_selesai || '12:30');
  if (lp.day === 0 || lp.minutes < start) return { persen: null, catatan: 'Jam sekolah belum mulai.' };
  const until = Math.min(lp.minutes, end);
  const slots = Math.max(1, Math.floor((until - start) / HEARTBEAT_MIN));
  const dayStartUtc = Date.parse(lp.dateStr + 'T00:00:00Z') - tz * 60000;
  const from = new Date(dayStartUtc + start * 60000).toISOString();
  const to = new Date(dayStartUtc + until * 60000).toISOString();
  const rows = ctx.db.prepare(`SELECT ts FROM events WHERE type IN ('server.heartbeat','server.boot') AND ts >= ? AND ts <= ?`).all(from, to);
  const filled = new Set(rows.map((r) => Math.floor((Date.parse(r.ts) - Date.parse(from)) / (HEARTBEAT_MIN * 60000))));
  return { persen: Math.min(100, Math.round((filled.size / slots) * 100)), slot: slots };
}

// ---------- Laporan kerusakan (F-2.5) ----------
export function fileReport(ctx, { device_id, description, photo, report_id }, who) {
  const desc = String(description || '').trim();
  if (desc.length < 3) throw new HttpError(400, 'Tulis singkat apa yang rusak, misalnya "lampu Wi-Fi mati".', 'deskripsi_kosong');
  let ph = null;
  if (photo) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw new HttpError(400, 'Foto harus berupa gambar JPG atau PNG.', 'foto_salah');
    if (photo.length > 400000) throw new HttpError(413, 'Foto terlalu besar. Ambil ulang dengan ukuran lebih kecil.', 'foto_besar');
    ph = photo;
  }
  const rid = typeof report_id === 'string' && /^[0-9a-f-]{36}$/i.test(report_id) ? report_id : crypto.randomUUID();
  emit(ctx, 'report.filed', {
    report_id: rid, device_id: device_id || ctx.cfg.device_id, reporter: who ? `${who.role}:${who.user_id}` : 'tamu',
    description: desc.slice(0, 1000), photo: ph,
  }, { event_id: rid });
  return rid;
}

export function levelsMeta() {
  return LEVELS;
}
export { MAX_LEVEL };
