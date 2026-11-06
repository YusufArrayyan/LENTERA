// Basis data lokal server sekolah. Log kejadian hanya bisa ditambah (append-only);
// pemicu SQLite menolak DELETE dan UPDATE selain penanda sinkron.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS events (
  event_id   TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  ts         TEXT NOT NULL,
  payload    TEXT NOT NULL,
  acked      INTEGER NOT NULL DEFAULT 0,
  acked_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS events_seq ON events(device_id, seq);
CREATE INDEX IF NOT EXISTS events_unacked ON events(acked, seq);
CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts);

CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'log kejadian hanya bisa ditambah'); END;
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE OF event_id, device_id, seq, type, ts, payload ON events
BEGIN SELECT RAISE(ABORT, 'log kejadian hanya bisa ditambah'); END;

-- Tabel identitas murid: hanya di server sekolah, tidak pernah masuk log kejadian.
CREATE TABLE IF NOT EXISTS student_identity (
  student_code TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  class_grade  INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  trained_at TEXT,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token        TEXT PRIMARY KEY,
  user_id      TEXT,
  role         TEXT NOT NULL,
  student_code TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  user_id TEXT,
  role    TEXT,
  action  TEXT NOT NULL,
  target  TEXT
);

-- Proyeksi (dibangun dari log kejadian)
CREATE TABLE IF NOT EXISTS students (
  student_code     TEXT PRIMARY KEY,
  grade            INTEGER,
  status           TEXT NOT NULL,
  level            INTEGER,
  group_id         TEXT,
  last_assessed_at TEXT,
  reassess_open    INTEGER NOT NULL DEFAULT 0,
  siklus           INTEGER NOT NULL DEFAULT 0,
  enrolled_at      TEXT
);
CREATE TABLE IF NOT EXISTS consent (
  student_code   TEXT PRIMARY KEY,
  given_at       TEXT NOT NULL,
  form_version   TEXT NOT NULL,
  giver_relation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  group_id   TEXT PRIMARY KEY,
  level      INTEGER NOT NULL,
  label      TEXT NOT NULL,
  cycle      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS diag (
  attempt_id   TEXT PRIMARY KEY,
  student_code TEXT NOT NULL,
  kind         TEXT NOT NULL,
  siklus       INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  level_result INTEGER,
  score        INTEGER,
  total        INTEGER
);
CREATE TABLE IF NOT EXISTS answers (
  event_id     TEXT PRIMARY KEY,
  student_code TEXT NOT NULL,
  attempt_id   TEXT,
  activity     TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  level        INTEGER,
  sub          INTEGER,
  response     TEXT,
  correct      INTEGER NOT NULL,
  ms           INTEGER,
  ts           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS answers_student ON answers(student_code, ts);
CREATE TABLE IF NOT EXISTS practice_state (
  student_code TEXT PRIMARY KEY,
  level        INTEGER NOT NULL,
  sub          INTEGER NOT NULL,
  streak       INTEGER NOT NULL DEFAULT 0,
  wrong_streak INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  siap_naik    INTEGER NOT NULL DEFAULT 0,
  current_item TEXT
);
CREATE TABLE IF NOT EXISTS lsessions (
  session_id        TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL,
  facilitator_id    TEXT,
  facilitator_role  TEXT,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  duration_min      INTEGER,
  notes             TEXT,
  volunteer_present INTEGER,
  students_finished INTEGER
);
CREATE TABLE IF NOT EXISTS attendance (
  session_id   TEXT NOT NULL,
  student_code TEXT NOT NULL,
  present      INTEGER NOT NULL,
  PRIMARY KEY (session_id, student_code)
);
CREATE TABLE IF NOT EXISTS telemetry (
  event_id     TEXT PRIMARY KEY,
  ts           TEXT NOT NULL,
  module_id    TEXT,
  voltage      REAL,
  current      REAL,
  battery_pct  REAL,
  temp         REAL,
  humidity     REAL,
  power_source TEXT
);
CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry(ts);
CREATE TABLE IF NOT EXISTS reports (
  report_id   TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  reporter    TEXT,
  description TEXT NOT NULL,
  photo       TEXT,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  resolution  TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  kind       TEXT PRIMARY KEY,
  level      TEXT NOT NULL,
  value      REAL,
  since      TEXT NOT NULL,
  message    TEXT
);
CREATE TABLE IF NOT EXISTS updates (
  update_id   TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL,
  applied_at  TEXT
);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'lentera.db'));
  // NF-3: jurnal WAL + synchronous FULL agar tidak ada data hilang saat listrik mati.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getMeta(db, key, def = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : def;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
