import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import type { Reading } from '../shared/types'

let db: Database.Database

export function initDb(): Database.Database {
  const dbPath = join(app.getPath('userData'), 'aqualora.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      location TEXT,
      last_seen TEXT,
      battery_pct INTEGER,
      lora_rssi INTEGER,
      status TEXT DEFAULT 'unknown'
    );

    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      temperature REAL,
      turbidity REAL,
      tds REAL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_node_time ON readings (node_id, timestamp);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      parameter TEXT,
      severity TEXT,
      message TEXT,
      acknowledged INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'operator'
    );
  `)

  return db
}

export function upsertNodeFromReading(reading: Reading): void {
  db.prepare(
    `INSERT INTO nodes (id, last_seen, battery_pct, lora_rssi, status)
     VALUES (@node_id, @timestamp, @battery_pct, @rssi, 'online')
     ON CONFLICT(id) DO UPDATE SET
       last_seen = excluded.last_seen,
       battery_pct = excluded.battery_pct,
       lora_rssi = excluded.lora_rssi,
       status = 'online'`
  ).run(reading)
}

export function insertReading(reading: Reading): void {
  db.prepare(
    `INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds)
     VALUES (@node_id, @timestamp, @temperature, @turbidity, @tds)`
  ).run(reading)
}

export function getRecentReadings(nodeId: string, limit = 50): unknown[] {
  return db
    .prepare(
      `SELECT * FROM readings WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`
    )
    .all(nodeId, limit)
}
