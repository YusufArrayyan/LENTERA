// Uji integritas sinkronisasi (PRD bagian 13): 0 kejadian ganda atau hilang
// pada 1.000 percobaan putus-sambung, paket terpotong, kirim ulang, dan perangkat tumpang tindih.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makePusat, makeSchool } from './helpers.js';
import { emit } from '../sekolah/core.js';
import { buildPacket, applyReceipt, pendingCount, verifyReceipt } from '../sekolah/sync.js';
import { ingestPacket } from '../pusat/ingest.js';
import { signUpdate } from '../shared/packet.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function truncate(env, r) {
  const ct = env.ct;
  const cut = Math.max(1, Math.floor(ct.length * r()));
  return { ...env, ct: ct.slice(0, cut) };
}

test('1.000 percobaan putus-sambung: tidak ada kejadian ganda atau hilang', () => {
  const pusat = makePusat();
  const A = makeSchool(pusat, 'LTR-UJI-A');
  const B = makeSchool(pusat, 'LTR-UJI-B');
  const r = rng(2026);
  const stats = { putus_sebelum: 0, tanda_terima_hilang: 0, terpotong: 0, kirim_ganda: 0, sukses: 0 };

  for (let trial = 0; trial < 1000; trial++) {
    const school = r() < 0.5 ? A : B;
    // kejadian baru di antara percobaan (kadang tidak ada)
    const n = Math.floor(r() * 6);
    for (let i = 0; i < n; i++) emit(school.ctx, 'server.heartbeat', { boot_id: 'uji', uptime_s: trial * 10 + i });
    const { env } = buildPacket(school.ctx, 1 + Math.floor(r() * 40));
    const roll = r();
    if (roll < 0.2) {
      stats.putus_sebelum++; // koneksi putus sebelum paket sampai
      continue;
    }
    if (roll < 0.35) {
      stats.terpotong++; // paket terpotong di jalan: pusat harus menolak tanpa menyimpan apa pun
      const before = pusat.db.prepare('SELECT COUNT(*) n FROM events').get().n;
      assert.throws(() => ingestPacket(pusat.db, truncate(env, r), { privateKeyPem: pusat.cfg.private_key_pem }));
      assert.equal(pusat.db.prepare('SELECT COUNT(*) n FROM events').get().n, before);
      continue;
    }
    const receipt = ingestPacket(pusat.db, env, { privateKeyPem: pusat.cfg.private_key_pem });
    if (roll < 0.55) {
      stats.tanda_terima_hilang++; // pusat sudah menyimpan, tapi tanda terima tidak sampai ke sekolah
      continue;
    }
    if (roll < 0.7) {
      stats.kirim_ganda++; // relawan mengirim paket yang sama dua kali
      ingestPacket(pusat.db, env, { privateKeyPem: pusat.cfg.private_key_pem });
    }
    applyReceipt(school.ctx, receipt, 'uji');
    stats.sukses++;
  }

  // Pengurasan akhir: kirim sampai semua di-ack.
  for (const s of [A, B]) {
    while (pendingCount(s.ctx) > 0) {
      const { env } = buildPacket(s.ctx);
      applyReceipt(s.ctx, ingestPacket(pusat.db, env, { privateKeyPem: pusat.cfg.private_key_pem }), 'uji');
    }
  }

  for (const s of [A, B]) {
    const local = s.db.prepare('SELECT event_id, seq FROM events ORDER BY seq').all();
    const remote = pusat.db.prepare('SELECT event_id, seq FROM events WHERE device_id = ? ORDER BY seq').all(s.cfg.device_id);
    assert.equal(remote.length, local.length, `jumlah kejadian ${s.cfg.device_id} harus sama`);
    assert.deepEqual(remote.map((e) => e.event_id), local.map((e) => e.event_id), 'tidak ada kejadian hilang atau tertukar');
    const seqs = remote.map((e) => e.seq);
    assert.equal(new Set(seqs).size, seqs.length, 'tidak ada nomor urut ganda');
  }
  for (const k of Object.keys(stats)) assert.ok(stats[k] > 50, `skenario ${k} teruji cukup sering (${stats[k]})`);
});

test('paket dari perangkat tak terdaftar atau kunci salah ditolak', () => {
  const pusat = makePusat();
  const A = makeSchool(pusat, 'LTR-UJI-C');
  emit(A.ctx, 'server.heartbeat', { boot_id: 'x', uptime_s: 1 });
  const { env } = buildPacket(A.ctx);
  assert.throws(() => ingestPacket(pusat.db, { ...env, device_id: 'LTR-PALSU' }, { privateKeyPem: pusat.cfg.private_key_pem }), /terdaftar|tanda tangan/i);
  const tampered = { ...env, sig: Buffer.from(crypto.randomBytes(64)).toString('base64') };
  assert.throws(() => ingestPacket(pusat.db, tampered, { privateKeyPem: pusat.cfg.private_key_pem }), /tanda tangan/i);
  pusat.db.prepare('UPDATE devices SET sync_key_hex = ? WHERE device_id = ?').run(crypto.randomBytes(32).toString('hex'), 'LTR-UJI-C');
  assert.throws(() => ingestPacket(pusat.db, env, { privateKeyPem: pusat.cfg.private_key_pem }), /tidak bisa dibuka/i);
});

test('tanda terima palsu dari ponsel tidak bisa menandai data sebagai terkirim', () => {
  const pusat = makePusat();
  const A = makeSchool(pusat, 'LTR-UJI-D');
  emit(A.ctx, 'server.heartbeat', { boot_id: 'x', uptime_s: 1 });
  const ids = A.db.prepare('SELECT event_id FROM events').all().map((r) => r.event_id);
  const fakeKeys = crypto.generateKeyPairSync('ed25519');
  const forged = signUpdate({ device_id: 'LTR-UJI-D', packet_id: 'x', acked_event_ids: ids, received_at: new Date().toISOString(), baru: 0, updates: [] }, fakeKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.equal(verifyReceipt(A.ctx, forged), false);
  assert.throws(() => applyReceipt(A.ctx, forged, 'relawan'));
  assert.equal(pendingCount(A.ctx), ids.length);
});

test('log kejadian hanya bisa ditambah', () => {
  const pusat = makePusat();
  const A = makeSchool(pusat, 'LTR-UJI-E');
  emit(A.ctx, 'server.heartbeat', { boot_id: 'x', uptime_s: 1 });
  assert.throws(() => A.db.exec('DELETE FROM events'), /hanya bisa ditambah/);
  assert.throws(() => A.db.exec(`UPDATE events SET payload = '{}'`), /hanya bisa ditambah/);
  A.db.exec('UPDATE events SET acked = 1'); // penanda sinkron tetap boleh diubah
});

test('pembaruan bertanda tangan pusat dipasang; yang palsu diabaikan', () => {
  const pusat = makePusat();
  const A = makeSchool(pusat, 'LTR-UJI-F');
  emit(A.ctx, 'server.heartbeat', { boot_id: 'x', uptime_s: 1 });
  pusat.db.prepare('INSERT INTO updates(update_id, kind, target, created_at, created_by, signed) VALUES (?,?,?,?,?,?)').run(
    'u1', 'ambang', '*', new Date().toISOString(), 'uji',
    JSON.stringify(signUpdate({ update_id: 'u1', kind: 'ambang', target: '*', payload: { suhu_waspada_c: 38 }, created_at: new Date().toISOString() }, pusat.cfg.private_key_pem))
  );
  const fake = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  pusat.db.prepare('INSERT INTO updates(update_id, kind, target, created_at, created_by, signed) VALUES (?,?,?,?,?,?)').run(
    'u2', 'ambang', '*', new Date().toISOString(), 'uji',
    JSON.stringify(signUpdate({ update_id: 'u2', kind: 'ambang', target: '*', payload: { suhu_waspada_c: 99 }, created_at: new Date().toISOString() }, fake))
  );
  const { env } = buildPacket(A.ctx);
  const r = applyReceipt(A.ctx, ingestPacket(pusat.db, env, { privateKeyPem: pusat.cfg.private_key_pem }), 'uji');
  assert.equal(r.pembaruan, 1);
  const t = JSON.parse(A.db.prepare(`SELECT value FROM meta WHERE key = 'thresholds'`).get().value);
  assert.equal(t.suhu_waspada_c, 38);
});
