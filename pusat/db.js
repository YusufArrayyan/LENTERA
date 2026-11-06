import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id    TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  ts          TEXT NOT NULL,
  payload     TEXT NOT NULL,
  received_at TEXT NOT NULL,
  packet_id   TEXT
);
CREATE INDEX IF NOT EXISTS ev_dev_type_ts ON events(device_id, type, ts);
CREATE TRIGGER IF NOT EXISTS ev_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'log kejadian hanya bisa ditambah'); END;

CREATE TABLE IF NOT EXISTS devices (
  device_id       TEXT PRIMARY KEY,
  school_id       TEXT NOT NULL,
  school_name     TEXT NOT NULL,
  region          TEXT,
  region_code     TEXT,
  public_key_pem  TEXT NOT NULL,
  sync_key_hex    TEXT NOT NULL,
  serial          TEXT,
  installed_at    TEXT,
  sw_version      TEXT,
  fw_version      TEXT,
  schedule_days   TEXT NOT NULL DEFAULT '[2,4]',
  tz_offset_min   INTEGER NOT NULL DEFAULT 480,
  jam_mulai       TEXT NOT NULL DEFAULT '07:00',
  jam_selesai     TEXT NOT NULL DEFAULT '12:30',
  program_start   TEXT,
  pembanding      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT NOT NULL,
  packet_id   TEXT,
  received_at TEXT NOT NULL,
  n_events    INTEGER NOT NULL,
  n_new       INTEGER NOT NULL,
  via         TEXT
);

CREATE TABLE IF NOT EXISTS users (
  user_id   TEXT PRIMARY KEY,
  username  TEXT UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL,
  pass_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS updates (
  update_id  TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  target     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT,
  signed     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message    TEXT NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(device_id, kind, ref)
);
CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  user_id TEXT,
  role    TEXT,
  action  TEXT NOT NULL,
  target  TEXT
);
`;

export function openPusatDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'pusat.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function ptx(db, fn) {
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
