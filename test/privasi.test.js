// US-6, US-7, F-3.5, F-4.2: dasbor dinas tanpa identitas murid; persetujuan wajib sebelum aktif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePusat, makeSchool } from './helpers.js';
import { atomic, enrollStudent, activateStudent, recordConsent, withdrawStudent } from '../sekolah/core.js';
import { buildPacket, applyReceipt, pendingCount } from '../sekolah/sync.js';
import { ingestPacket } from '../pusat/ingest.js';
import { createPusat } from '../pusat/server.js';
import { startServer } from '../shared/http.js';
import { hashPassword } from '../shared/packet.js';
import { generateHistory } from '../scripts/history.js';
import crypto from 'node:crypto';

function syncAll(pusat, s) {
  while (pendingCount(s.ctx) > 0) {
    const { env } = buildPacket(s.ctx);
    applyReceipt(s.ctx, ingestPacket(pusat.db, env, { privateKeyPem: pusat.cfg.private_key_pem }), 'uji');
  }
}

test('murid tanpa persetujuan orang tua tidak bisa diaktifkan', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  const code = enrollStudent(s.ctx, { name: 'Murid Uji', grade: 2 });
  assert.throws(() => activateStudent(s.ctx, code), (e) => e.status === 409 && /persetujuan/.test(e.message));
  recordConsent(s.ctx, code, { given_at: '2026-10-01', form_version: 'PO-2026.1', giver_relation: 'Ibu' });
  activateStudent(s.ctx, code);
  assert.equal(s.db.prepare('SELECT status FROM students WHERE student_code = ?').get(code).status, 'aktif');
});

test('nama murid tidak pernah masuk log kejadian maupun paket sinkron', () => {
  const pusat = makePusat();
  const s = makeSchool(pusat);
  const code = enrollStudent(s.ctx, { name: 'Yohana Nama Rahasia', grade: 3 });
  recordConsent(s.ctx, code, { given_at: '2026-10-01', form_version: 'PO-2026.1', giver_relation: 'Wali' });
  syncAll(pusat, s);
  const all = s.db.prepare('SELECT payload FROM events').all().map((r) => r.payload).join('\n');
  assert.ok(!all.includes('Rahasia'));
  const central = pusat.db.prepare('SELECT payload FROM events').all().map((r) => r.payload).join('\n');
  assert.ok(!central.includes('Rahasia'));
  withdrawStudent(s.ctx, code, 'permintaan_ortu');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM student_identity WHERE student_code = ?').get(code).n, 0);
});

test('dasbor dinas dan koordinator tidak memuat kode atau nama murid', async () => {
  const pusat = makePusat();
  const s = makeSchool(pusat, 'LTR-PRIV');
  const users = [
    { user_id: crypto.randomUUID(), role: 'guru', name: 'Guru Uji', trained_at: '2026-09-01' },
    { user_id: crypto.randomUUID(), role: 'relawan', name: 'Relawan Uji', trained_at: '2026-09-01' },
  ];
  atomic(s.db, () => generateHistory(s.ctx, { seed: 5, days: 30, now: Date.now(), users, nStudents: 14, pendingConsent: 1, sessionRate: 0.9, volunteerRate: 0.9, outageDays: new Set() }));
  syncAll(pusat, s);
  const codes = s.db.prepare('SELECT student_code FROM students').all().map((r) => r.student_code);
  const names = s.db.prepare('SELECT name FROM student_identity').all().map((r) => r.name);
  assert.ok(codes.length >= 14);

  for (const [username, role] of [['dinas', 'dinas'], ['koor', 'koordinator']]) {
    pusat.db.prepare('INSERT INTO users(user_id, username, name, role, pass_hash) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), username, role, role, hashPassword('sandi-uji'));
  }
  const app = createPusat({ dataDir: pusat.dir, cfg: pusat.cfg });
  const server = await startServer({ router: app.router, statics: app.statics, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const username of ['dinas', 'koor']) {
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'sandi-uji' }) });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const paths = ['/dashboard/schools', '/dashboard/schools/LTR-PRIV/metrics', '/reports/semester', '/reports/semester?format=csv'];
      if (username === 'koor') paths.push('/dashboard/devices/LTR-PRIV/health', '/dashboard/notifications');
      for (const p of paths) {
        const res = await fetch(base + p, { headers: { cookie } });
        assert.equal(res.status, 200, `${username} ${p}`);
        const text = await res.text();
        assert.ok(!/student_code/.test(text), `${p} tidak boleh memuat kolom student_code`);
        for (const c of codes) assert.ok(!text.includes(c), `${p} memuat kode murid ${c}`);
        for (const n of names) assert.ok(!text.includes(n), `${p} memuat nama murid`);
      }
      if (username === 'dinas') {
        const res = await fetch(`${base}/dashboard/devices/LTR-PRIV/health`, { headers: { cookie } });
        assert.equal(res.status, 403, 'dinas tidak boleh melihat rincian perangkat');
        const body = await (await fetch(`${base}/dashboard/schools`, { headers: { cookie } })).json();
        assert.ok(!('peringatan' in body.sekolah[0]), 'dinas hanya menerima agregat');
      }
    }
  } finally {
    server.close();
    app.close();
  }
});
