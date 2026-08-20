import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import type { Reading, StoredReading, Alert, NodeRow, UserRow } from '../shared/types'

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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return db
}

export function upsertNodeFromReading(reading: Reading): NodeRow {
  db.prepare(
    `INSERT INTO nodes (id, last_seen, battery_pct, lora_rssi, status)
     VALUES (@node_id, @timestamp, @battery_pct, @rssi, 'online')
     ON CONFLICT(id) DO UPDATE SET
       last_seen = excluded.last_seen,
       battery_pct = excluded.battery_pct,
       lora_rssi = excluded.lora_rssi,
       status = 'online'`
  ).run(reading)
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(reading.node_id) as NodeRow
}

export function insertReading(reading: Reading): void {
  db.prepare(
    `INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds)
     VALUES (@node_id, @timestamp, @temperature, @turbidity, @tds)`
  ).run(reading)
}

export function getRecentReadings(nodeId: string, limit = 50): StoredReading[] {
  return db
    .prepare(`SELECT * FROM readings WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(nodeId, limit) as StoredReading[]
}

export function getReadingsInRange(
  nodeId: string,
  startIso: string,
  endIso: string
): StoredReading[] {
  return db
    .prepare(
      `SELECT * FROM readings
       WHERE node_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC
       LIMIT 5000`
    )
    .all(nodeId, startIso, endIso) as StoredReading[]
}

export function readingsToCsv(readings: StoredReading[]): string {
  const header = 'timestamp,node_id,temperature,turbidity,tds'
  const rows = readings.map(
    (r) => `${r.timestamp},${r.node_id},${r.temperature},${r.turbidity},${r.tds}`
  )
  return [header, ...rows].join('\n')
}

export function insertAlert(alert: {
  node_id: string
  timestamp: string
  parameter: string
  severity: string
  message: string
}): Alert {
  const result = db
    .prepare(
      `INSERT INTO alerts (node_id, timestamp, parameter, severity, message)
       VALUES (@node_id, @timestamp, @parameter, @severity, @message)`
    )
    .run(alert)
  return db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid) as Alert
}

export function getRecentAlerts(nodeId: string, limit = 50): Alert[] {
  return db
    .prepare(`SELECT * FROM alerts WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(nodeId, limit) as Alert[]
}

export function getAllRecentAlerts(limit = 200): Alert[] {
  return db.prepare(`SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?`).all(limit) as Alert[]
}

export function acknowledgeAlert(id: number): void {
  db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(id)
}

// Flips any node whose last_seen is older than cutoffIso from 'online' to
// 'offline', returning the ids that changed so the caller can notify the UI.
export function markStaleNodesOffline(cutoffIso: string): string[] {
  const stale = db
    .prepare(`SELECT id FROM nodes WHERE status = 'online' AND last_seen < ?`)
    .all(cutoffIso) as { id: string }[]
  if (stale.length === 0) return []
  db.prepare(`UPDATE nodes SET status = 'offline' WHERE status = 'online' AND last_seen < ?`).run(
    cutoffIso
  )
  return stale.map((n) => n.id)
}

const SALT_ROUNDS = 10

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n
}

export function createUser(username: string, password: string, role = 'operator'): void {
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS)
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    username,
    passwordHash,
    role
  )
}

export function verifyUser(
  username: string,
  password: string
): { username: string; role: string } | null {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    { username: string; password_hash: string; role: string } | undefined
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return null
  return { username: user.username, role: user.role }
}

export function listUsers(): UserRow[] {
  return db.prepare('SELECT id, username, role FROM users ORDER BY username').all() as UserRow[]
}

export function deleteUser(id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function changePassword(username: string, newPassword: string): void {
  const passwordHash = bcrypt.hashSync(newPassword, SALT_ROUNDS)
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, username)
}

export function getAllNodes(): NodeRow[] {
  return db.prepare('SELECT * FROM nodes ORDER BY id').all() as NodeRow[]
}

// Creates a node row from a discovery message if it doesn't exist yet;
// leaves an existing row's name/location untouched. Discovery re-fires on
// every WiFi reconnect, so this must not clobber a name the user later set.
export function upsertNodeStub(id: string): NodeRow {
  db.prepare(
    `INSERT INTO nodes (id, status) VALUES (?, 'unknown')
     ON CONFLICT(id) DO NOTHING`
  ).run(id)
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow
}

export function upsertNode(id: string, name: string | null, location: string | null): NodeRow {
  db.prepare(
    `INSERT INTO nodes (id, name, location, status)
     VALUES (?, ?, ?, 'unknown')
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, location = excluded.location`
  ).run(id, name, location)
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? fallback
}

// Distinguishes "never paired" from "paired, has a value" — getSetting's
// fallback can't do that, and startup needs to know whether to auto-connect
// at all versus wait for the Connect Device wizard.
export function getSettingOptional(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}
