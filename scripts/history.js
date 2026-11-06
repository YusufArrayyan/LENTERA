// Pembangkit riwayat contoh: menulis kejadian ber-tanggal-mundur lewat jalur emit yang
// sama dengan server sungguhan, sehingga proyeksi dan paket sinkron konsisten.
import crypto from 'node:crypto';
import { emit } from '../sekolah/core.js';
import { diagnosticStep, getItem, adaptStep, randomItemId, levelInfo, DIAGNOSTIC } from '../shared/numerasi.js';

const DAY = 86400000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMA = [
  'Yosefina', 'Maria Goreti', 'Yohanes', 'Fransiskus', 'Siti Aminah', 'Ahmad Fauzi', 'Agustina', 'Petrus', 'Kornelia', 'Stefanus',
  'Rina', 'Dewi Lestari', 'Andreas', 'Yuliana', 'Marselina', 'Benediktus', 'Aisyah', 'Rahmat', 'Nurhaliza', 'Fitriani',
  'Gabriel', 'Veronika', 'Damianus', 'Elisabet', 'Hendrikus', 'Lusia', 'Kristoforus', 'Anjelina', 'Markus', 'Theresia',
  'Yakobus', 'Florentina', 'Ignasius', 'Rosalia', 'Wilhelmus', 'Margaretha',
];
const INISIAL = 'BDGHKLMNPRSTW';

export function localMs(dayStartUtcMs, hhmm, tz) {
  const [h, m] = hhmm.split(':').map(Number);
  return dayStartUtcMs + (h * 60 + m) * 60000 - tz * 60000;
}

function p(theta, level, sub) {
  const diff = level + (sub - 2) * 0.35;
  const s = 1 / (1 + Math.exp(-1.6 * (theta - diff)));
  return 0.2 + 0.78 * s;
}

function pickWrong(r, item) {
  const w = item.options.filter((o) => o !== item.answer);
  return w[Math.floor(r() * w.length)] || item.options[0];
}

function runDiagnostic(ctx, r, code, theta, kind, siklus, tStart) {
  const attempt_id = crypto.randomUUID();
  let t = tStart;
  const iso = () => new Date(t).toISOString();
  emit(ctx, 'diagnostic.started', { attempt_id, student_code: code, kind, siklus }, { ts: iso() });
  const answers = [];
  for (;;) {
    const step = diagnosticStep(answers, siklus);
    if (step.selesai) {
      t += 5000;
      emit(ctx, 'diagnostic.finished', { attempt_id, student_code: code, kind, siklus, level: step.level, score: step.skor, total: step.total, mahir: !!step.mahir }, { ts: iso() });
      return step.level;
    }
    const item = getItem(step.nextItemId);
    const correct = r() < p(theta, item.level, item.sub);
    t += 15000 + Math.floor(r() * 40000);
    emit(ctx, 'answer.submitted', {
      student_code: code, attempt_id, activity: 'diagnostik', item_id: item.item_id, level: item.level, sub: item.sub,
      response: correct ? item.answer : pickWrong(r, item), correct, ms: 8000 + Math.floor(r() * 30000),
    }, { ts: iso() });
    answers.push({ level: item.level, correct });
  }
}

/**
 * opts: { seed, days, nStudents, pendingConsent, sessionRate, volunteerRate, outageDays:Set, lastSignalDaysAgo, users:{guru, relawan[]}, now }
 */
export function generateHistory(ctx, opts) {
  const { db, cfg } = ctx;
  const r = rng(opts.seed || 1);
  const tz = cfg.school.tz_offset_min ?? 480;
  const now = opts.now || Date.now();
  const todayLocal = Math.floor((now + tz * 60000) / DAY);
  const startDay = todayLocal - opts.days;
  const dayUtc0 = (d) => d * DAY; // tengah malam UTC untuk hari lokal d (sebelum koreksi tz di localMs)
  const stopMs = now - (opts.lastSignalDaysAgo || 0) * DAY;
  const schedule = cfg.school.schedule_days || [2, 4];

  // ---- pengguna (dikirim ke pusat tanpa kata sandi) ----
  for (const u of opts.users) emit(ctx, 'user.registered', { user_id: u.user_id, role: u.role, name: u.name, trained_at: u.trained_at }, { ts: new Date(localMs(dayUtc0(startDay - 3), '09:00', tz)).toISOString() });

  // ---- murid, persetujuan, aktivasi ----
  const students = [];
  const enrollT = localMs(dayUtc0(startDay - 2), '08:00', tz);
  for (let i = 0; i < opts.nStudents; i++) {
    const code = newCode(r, db);
    const grade = 1 + (i % 6);
    const name = `${NAMA[(i * 7 + opts.seed) % NAMA.length]} ${INISIAL[(i + opts.seed) % INISIAL.length]}.`;
    db.prepare('INSERT INTO student_identity(student_code, name, class_grade, created_at) VALUES (?,?,?,?)').run(code, name, grade, new Date(enrollT).toISOString());
    emit(ctx, 'student.enrolled', { student_code: code, grade }, { ts: new Date(enrollT + i * 60000).toISOString() });
    const pending = i >= opts.nStudents - (opts.pendingConsent || 0);
    if (!pending) {
      const ct = new Date(enrollT + 3600000 + i * 60000).toISOString();
      emit(ctx, 'consent.recorded', { student_code: code, given_at: ct.slice(0, 10), form_version: 'PO-2026.1', giver_relation: ['Ibu', 'Ayah', 'Wali'][Math.floor(r() * 3)] }, { ts: ct });
      emit(ctx, 'student.activated', { student_code: code }, { ts: ct });
      // kemampuan awal mengikuti kelas, dengan sebaran lebar (ciri ruang kelas multi-tingkat)
      const theta = Math.max(0.4, Math.min(5.6, 0.6 + grade * 0.55 + (r() - 0.5) * 2.2 + (opts.abilityShift || 0)));
      students.push({ code, grade, theta });
    }
  }

  // ---- diagnostik awal dan pembentukan kelompok ----
  const groups = new Map(); // level -> [{group_id, n}]
  const assign = (s, level, ts, reason) => {
    let list = groups.get(level) || [];
    let g = list.find((x) => x.n < 15);
    if (!g) {
      g = { group_id: crypto.randomUUID(), level, n: 0, label: `${levelInfo(level).nama} ${'ABCDEF'[list.length]}` };
      list.push(g);
      groups.set(level, list);
      emit(ctx, 'group.formed', { group_id: g.group_id, level, label: g.label, cycle: 1 }, { ts });
    }
    if (s.group) s.group.n--;
    g.n++;
    s.group = g;
    emit(ctx, 'group.assigned', { student_code: s.code, group_id: g.group_id, reason, by: null }, { ts });
  };
  for (const [i, s] of students.entries()) {
    const t0 = localMs(dayUtc0(startDay), '07:30', tz) + i * 4 * 60000;
    s.level = runDiagnostic(ctx, r, s.code, s.theta, 'awal', 0, t0);
    assign(s, s.level, new Date(t0 + 10 * 60000).toISOString(), 'otomatis');
    s.ps = { student_code: s.code, level: s.level, sub: 1, streak: 0, wrong_streak: 0, total: 0, correct: 0, siap_naik: 0 };
  }

  // ---- hari demi hari ----
  const reassessDay = startDay + 28;
  let reportOpenDone = false;
  for (let d = startDay; d <= todayLocal; d++) {
    const dow = new Date(d * DAY).getUTCDay();
    if (dow === 0) continue;
    const outage = opts.outageDays?.has(d - startDay);
    const dayStart = localMs(dayUtc0(d), '07:00', tz);
    if (dayStart > stopMs) break;
    if (!outage) {
      const boot = crypto.randomUUID();
      emit(ctx, 'server.boot', { boot_id: boot, sw_version: cfg.sw_version }, { ts: new Date(dayStart - 120000).toISOString() });
      // detak dan telemetri tiap 5 menit selama jam sekolah
      const endMs = Math.min(localMs(dayUtc0(d), '12:30', tz), stopMs, now - 60000);
      const sunny = r() > 0.3;
      let batt = 70 + r() * 25;
      const lateStart = r() < 0.12 ? 30 + Math.floor(r() * 60) : 0; // kadang server baru menyala setelah listrik kembali
      for (let t = dayStart + lateStart * 60000; t < endMs; t += 5 * 60000) {
        const iso = new Date(t).toISOString();
        emit(ctx, 'server.heartbeat', { boot_id: boot, uptime_s: Math.round((t - dayStart) / 1000) }, { ts: iso });
        const hour = ((t / 3600000 + tz / 60) % 24);
        batt = Math.max(5, Math.min(100, batt + (sunny && hour > 8.5 ? 0.6 : -0.45) + (r() - 0.5) * 0.3 - (opts.weakBattery ? 0.5 : 0)));
        const temp = 27 + (hour - 7) * 1.4 + r() * 1.5 + (opts.hot ? 6 : 0);
        const voltage = Math.round((12.0 + (batt / 100) * 1.4) * 100) / 100;
        emit(ctx, 'telemetry.reading', {
          module_id: `${cfg.device_id}-IOT`, voltage, current: Math.round((0.9 + r() * 0.4) * 100) / 100, battery_pct: Math.round(batt),
          temp: Math.round(temp * 10) / 10, humidity: Math.round(62 + r() * 18), power_source: sunny && hour > 8.5 ? 'plts' : 'baterai', measured_at: iso,
        }, { ts: iso });
      }
      if (opts.hot && d === todayLocal) {
        emit(ctx, 'device.alert', { kind: 'suhu', level: 'waspada', value: 41.2, message: 'Suhu kotak 41,2 °C. Pindahkan kotak ke tempat teduh dan jangan tutupi lubang udaranya.' }, { ts: new Date(Math.min(endMs, now - 120000)).toISOString() });
      }
    }

    // asesmen ulang di pekan kelima
    if (d === reassessDay && !outage) {
      for (const [i, s] of students.entries()) {
        const t0 = localMs(dayUtc0(d), '07:20', tz) + i * 3 * 60000;
        s.level = runDiagnostic(ctx, r, s.code, s.theta, 'ulang', 1, t0);
        s.ps = { ...s.ps, level: s.level, sub: 1, streak: 0, wrong_streak: 0, siap_naik: 0 };
        emit(ctx, 'practice.state', { ...s.ps, current_item: randomItemId(s.level, 1) }, { ts: new Date(t0 + 120000).toISOString() });
      }
      const tReg = new Date(localMs(dayUtc0(d), '09:30', tz)).toISOString();
      for (const s of students) if (s.group.level !== s.level) assign(s, s.level, tReg, 'asesmen_ulang');
      for (const list of groups.values()) for (const g of list) if (g.n === 0 && !g.archived) {
        g.archived = true;
        emit(ctx, 'group.archived', { group_id: g.group_id }, { ts: tReg });
      }
    }

    // sesi belajar pada hari sesi
    if (schedule.includes(dow) && !outage && d > startDay) {
      let slot = 0;
      for (const list of groups.values()) for (const g of list) {
        if (g.archived || g.n === 0) continue;
        if (r() > (opts.sessionRate ?? 0.9)) continue;
        const start = localMs(dayUtc0(d), slot % 2 === 0 ? '08:00' : '10:00', tz) + Math.floor(slot / 2) * 5 * 60000;
        slot++;
        if (start > stopMs || start > now - 2 * 3600000) continue;
        const relawan = r() < (opts.volunteerRate ?? 0.86);
        const fac = relawan ? opts.users.find((u) => u.role === 'relawan') : opts.users.find((u) => u.role === 'guru');
        const session_id = crypto.randomUUID();
        emit(ctx, 'session.started', { session_id, group_id: g.group_id, facilitator_id: fac.user_id, facilitator_role: fac.role, started_at: new Date(start).toISOString() }, { ts: new Date(start).toISOString() });
        const members = students.filter((s) => s.group === g);
        let finished = 0;
        for (const s of members) {
          const present = r() < 0.9;
          emit(ctx, 'session.attendance', { session_id, student_code: s.code, present }, { ts: new Date(start + 120000).toISOString() });
          if (!present) continue;
          // 20 menit alat peraga, lalu latihan di tablet
          let t = start + 22 * 60000;
          const n = 10 + Math.floor(r() * 10);
          for (let k = 0; k < n; k++) {
            const item = getItem(randomItemId(s.ps.level, s.ps.sub));
            const correct = r() < p(s.theta, item.level, item.sub);
            t += 60000 + Math.floor(r() * 90000);
            emit(ctx, 'answer.submitted', {
              student_code: s.code, activity: 'latihan', item_id: item.item_id, level: item.level, sub: item.sub,
              response: correct ? item.answer : pickWrong(r, item), correct, ms: 6000 + Math.floor(r() * 40000),
            }, { ts: new Date(t).toISOString() });
            const nx = adaptStep(s.ps, correct);
            delete nx.perubahan;
            s.ps = nx;
          }
          emit(ctx, 'practice.state', { ...s.ps, current_item: randomItemId(s.ps.level, s.ps.sub) }, { ts: new Date(t + 1000).toISOString() });
          s.theta += 0.045 + r() * 0.03; // efek latihan per sesi (asumsi simulasi, bukan klaim)
          finished++;
        }
        const end = start + (55 + Math.floor(r() * 12)) * 60000;
        emit(ctx, 'session.closed', {
          session_id, ended_at: new Date(end).toISOString(), duration_min: Math.round((end - start) / 60000),
          notes: r() < 0.3 ? 'Beberapa murid masih tertukar antara simbol tambah dan kali.' : '',
          volunteer_present: relawan || r() < 0.2, students_finished: finished,
        }, { ts: new Date(end).toISOString() });
      }
    }

    // laporan kerusakan contoh
    if (d === startDay + 9 && !outage) {
      const rid = crypto.randomUUID();
      emit(ctx, 'report.filed', { report_id: rid, device_id: cfg.device_id, reporter: 'relawan:' + opts.users.find((u) => u.role === 'relawan').user_id, description: 'Kabel adaptor longgar, server mati saat kabel tersenggol.', photo: null }, { ts: new Date(localMs(dayUtc0(d), '11:10', tz)).toISOString(), event_id: rid });
      emit(ctx, 'report.resolved', { report_id: rid, resolution: 'Kabel diikat ke casing dengan klem. Sudah dicek saat kunjungan.' }, { ts: new Date(localMs(dayUtc0(d + 2), '09:00', tz)).toISOString() });
    }
    if (!reportOpenDone && d === todayLocal - 3 && !outage && opts.openReport) {
      reportOpenDone = true;
      const rid = crypto.randomUUID();
      emit(ctx, 'report.filed', { report_id: rid, device_id: cfg.device_id, reporter: 'guru:' + opts.users.find((u) => u.role === 'guru').user_id, description: opts.openReport, photo: null }, { ts: new Date(localMs(dayUtc0(d), '10:40', tz)).toISOString(), event_id: rid });
    }
  }
  return { students: students.length };
}

const ALPH = 'ACDEFHJKMNPRTUVWXY34679';
function newCode(r, db) {
  for (;;) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPH[Math.floor(r() * ALPH.length)];
    const c = `${s.slice(0, 3)}-${s.slice(3)}`;
    if (!db.prepare('SELECT 1 FROM students WHERE student_code = ?').get(c)) return c;
  }
}

export { DIAGNOSTIC };
