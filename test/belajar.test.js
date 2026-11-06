// F-1.3–F-1.8: diagnostik, pengelompokan, latihan adaptif, sesi, telemetri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makePusat, makeSchool, addUser } from './helpers.js';
import * as core from '../sekolah/core.js';
import { getItem, diagnosticStep, adaptStep, LEVELS, DIAGNOSTIC } from '../shared/numerasi.js';

function activeStudent(ctx, name = 'Murid', grade = 2) {
  const code = core.enrollStudent(ctx, { name, grade });
  core.recordConsent(ctx, code, { given_at: '2026-10-01', form_version: 'PO-2026.1', giver_relation: 'Ibu' });
  core.activateStudent(ctx, code);
  return code;
}

function answerAll(ctx, code, strategy) {
  let act = core.nextActivity(ctx, code);
  let guard = 0;
  while (act.mode === 'diagnostik' && guard++ < 40) {
    const it = getItem(act.item.item_id);
    const resp = strategy(it) ? it.answer : it.options.find((o) => o !== it.answer);
    const r = core.submitAnswer(ctx, code, { event_id: crypto.randomUUID(), item_id: it.item_id, response: resp, ms: 1000 });
    act = r.berikutnya;
  }
  return act;
}

test('setiap butir punya kunci di antara pilihan dan pilihannya unik', () => {
  for (const l of LEVELS) for (let s = 1; s <= 3; s++) for (let seed = 1; seed < 400; seed++) {
    const it = getItem(`L${l.level}S${s}-${seed}`);
    assert.ok(it.options.includes(it.answer), `${it.item_id} kunci tidak ada di pilihan`);
    assert.equal(new Set(it.options).size, it.options.length, `${it.item_id} pilihan ganda`);
    assert.ok(it.options.length >= 2);
  }
});

test('diagnostik berhenti di level pertama yang belum dikuasai', () => {
  const all = (lvlMax) => {
    const ans = [];
    for (;;) {
      const st = diagnosticStep(ans);
      if (st.selesai) return st;
      const lv = getItem(st.nextItemId).level;
      ans.push({ level: lv, correct: lv <= lvlMax });
    }
  };
  assert.equal(all(0).level, 1);
  assert.equal(all(2).level, 3);
  assert.equal(all(5).mahir, true);
  assert.equal(all(5).total, LEVELS.length * DIAGNOSTIC.perLevel);
});

test('latihan adaptif naik setelah dua benar dan turun setelah dua salah', () => {
  let s = { level: 3, sub: 1, streak: 0, wrong_streak: 0 };
  s = adaptStep(s, true); s = adaptStep(s, true);
  assert.equal(s.sub, 2);
  s = adaptStep(s, false); s = adaptStep(s, false);
  assert.equal(s.sub, 1);
});

test('alur murid: diagnostik → kelompok otomatis → latihan; jawaban diperiksa server dan idempoten', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  const code = activeStudent(s.ctx);
  const act = answerAll(s.ctx, code, (it) => it.level <= 2);
  assert.equal(act.mode, 'latihan');
  assert.equal(act.level, 3);
  const st = s.db.prepare('SELECT * FROM students WHERE student_code = ?').get(code);
  const g = s.db.prepare('SELECT * FROM groups WHERE group_id = ?').get(st.group_id);
  assert.equal(g.level, 3);

  // Tablet tidak bisa menentukan benar/salah sendiri: server memeriksa terhadap kunci.
  const it = getItem(act.item.item_id);
  const wrong = it.options.find((o) => o !== it.answer);
  const eid = crypto.randomUUID();
  const r1 = core.submitAnswer(s.ctx, code, { event_id: eid, item_id: it.item_id, response: wrong, correct: true });
  assert.equal(r1.benar, false);
  // Kiriman ulang dengan event_id yang sama (Wi-Fi putus lalu sambung) tidak tercatat dua kali.
  const before = s.db.prepare('SELECT COUNT(*) n FROM answers WHERE student_code = ?').get(code).n;
  core.submitAnswer(s.ctx, code, { event_id: eid, item_id: it.item_id, response: wrong });
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM answers WHERE student_code = ?').get(code).n, before);
});

test('kelompok dipecah otomatis bila lebih dari 15 murid di level yang sama', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  for (let i = 0; i < 17; i++) answerAll(s.ctx, activeStudent(s.ctx, `Murid ${i}`), () => false);
  const groups = s.db.prepare(`SELECT g.group_id, COUNT(st.student_code) n FROM groups g JOIN students st ON st.group_id = g.group_id WHERE g.level = 1 GROUP BY g.group_id`).all();
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.n <= core.GROUP_MAX));
});

test('asesmen ulang dan pembaruan kelompok memindahkan murid yang naik level', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  const guru = addUser(s.db, 'guru');
  const code = activeStudent(s.ctx);
  answerAll(s.ctx, code, (it) => it.level <= 1);
  assert.equal(s.db.prepare('SELECT level FROM students WHERE student_code = ?').get(code).level, 2);
  core.openReassessment(s.ctx, {}, guru);
  const act = core.nextActivity(s.ctx, code);
  assert.equal(act.mode, 'diagnostik');
  assert.equal(act.jenis, 'ulang');
  answerAll(s.ctx, code, (it) => it.level <= 3);
  assert.equal(core.regroup(s.ctx, guru), 1);
  const st = s.db.prepare('SELECT s.level, g.level glevel FROM students s JOIN groups g ON g.group_id = s.group_id WHERE student_code = ?').get(code);
  assert.equal(st.level, 4);
  assert.equal(st.glevel, 4);
});

test('sesi: mulai, kehadiran, tutup; kiriman ulang tidak menggandakan', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  const relawan = addUser(s.db, 'relawan');
  const code = activeStudent(s.ctx);
  answerAll(s.ctx, code, () => false);
  const gid = s.db.prepare('SELECT group_id FROM students WHERE student_code = ?').get(code).group_id;
  const sid = crypto.randomUUID();
  core.startSession(s.ctx, { session_id: sid, group_id: gid, started_at: new Date(Date.now() - 61 * 60000).toISOString() }, relawan);
  core.startSession(s.ctx, { session_id: sid, group_id: gid }, relawan); // kirim ulang aman
  assert.throws(() => core.startSession(s.ctx, { session_id: crypto.randomUUID(), group_id: gid }, relawan), /masih berjalan/);
  core.setAttendance(s.ctx, sid, [{ student_code: code, present: true }]);
  core.setAttendance(s.ctx, sid, [{ student_code: code, present: true }]);
  assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM events WHERE type = 'session.attendance'`).get().n, 1);
  const closed = core.closeSession(s.ctx, sid, { notes: 'uji' });
  assert.ok(closed.duration_min >= 60);
  assert.equal(closed.volunteer_present, 1);
  core.closeSession(s.ctx, sid, { notes: 'kirim ulang' });
  assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM events WHERE type = 'session.closed'`).get().n, 1);
});

test('telemetri memicu peringatan lampu dan tersimpan sebagai kejadian', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  const ok = core.ingestTelemetry(s.ctx, { voltage: 13.2, temp: 30, humidity: 60, power_source: 'plts' });
  assert.equal(ok.lampu, 'hijau');
  const hot = core.ingestTelemetry(s.ctx, { voltage: 13.2, temp: 46, humidity: 60, power_source: 'plts' });
  assert.equal(hot.lampu, 'merah');
  const low = core.ingestTelemetry(s.ctx, { voltage: 12.25, temp: 30, humidity: 60 });
  assert.equal(low.lampu, 'kuning');
  assert.equal(s.db.prepare(`SELECT COUNT(*) n FROM events WHERE type = 'telemetry.reading'`).get().n, 3);
  const eid = crypto.randomUUID();
  core.ingestTelemetry(s.ctx, { event_id: eid, voltage: 13 });
  const dup = core.ingestTelemetry(s.ctx, { event_id: eid, voltage: 13 });
  assert.equal(dup.diterima, false);
});
