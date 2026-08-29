import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import {
  DEFAULT_POND_PROFILES,
  type Reading,
  type StoredReading,
  type Alert,
  type NodeRow,
  type UserRow,
  type PondThresholdProfile,
  type PondType,
  type SavedThresholdProfile,
  type OutboxEntry,
  type CloudSyncStatus
} from '../shared/types'

let db: Database.Database

function parseCustomProfile(value: string | null): PondThresholdProfile | null {
  if (!value) return null
  try {
    return JSON.parse(value) as PondThresholdProfile
  } catch {
    return null
  }
}

function normalizeNodeRow(row: any): NodeRow {
  return {
    ...row,
    pond_type: row.pond_type as PondType | null,
    custom_profile: parseCustomProfile(row.custom_profile)
  }
}

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
      status TEXT DEFAULT 'unknown',
      pond_type TEXT DEFAULT 'tilapia',
      custom_profile TEXT
    );

    CREATE TABLE IF NOT EXISTS threshold_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      profile TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      temperature REAL,
      turbidity REAL,
      tds REAL,
      ph REAL,
      pond_type TEXT DEFAULT 'tilapia'
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

    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reading_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status, created_at);
  `)

  try {
    db.prepare('ALTER TABLE readings ADD COLUMN ph REAL').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    db.prepare('ALTER TABLE readings ADD COLUMN pond_type TEXT DEFAULT "tilapia"').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    db.prepare('ALTER TABLE nodes ADD COLUMN pond_type TEXT DEFAULT "tilapia"').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    db.prepare('ALTER TABLE nodes ADD COLUMN custom_profile TEXT').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  const seededProfiles = Object.entries(DEFAULT_POND_PROFILES)
  for (const [name, profile] of seededProfiles) {
    const existing = db.prepare('SELECT id FROM threshold_profiles WHERE LOWER(name) = LOWER(?)').get(name)
    if (!existing) {
      db.prepare('INSERT INTO threshold_profiles (name, profile) VALUES (?, ?)').run(
        name,
        JSON.stringify(profile)
      )
    }
  }

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

export function insertReading(reading: Reading): number {
  // Ensure pond_type is defined; default to 'tilapia' for legacy readings
  const enrichedReading = { ...reading, pond_type: (reading as any).pond_type ?? 'tilapia' } as any;
  const result = db.prepare(
    `INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds, ph, pond_type)
     VALUES (@node_id, @timestamp, @temperature, @turbidity, @tds, @ph, @pond_type)`
  ).run(enrichedReading)

  const readingId = Number(result.lastInsertRowid ?? 0)
  if (readingId > 0) {
    queueOutboxEntryForReading(readingId, enrichedReading)
  }
  return readingId
}

export function queueOutboxEntryForReading(readingId: number, reading: Reading): number {
  const payload = JSON.stringify({ ...reading, reading_id: readingId })
  const createdAt = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO outbox (reading_id, payload_json, status, retry_count, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`
    )
    .run(readingId, payload, createdAt, createdAt)

  return Number(result.lastInsertRowid ?? 0)
}

export function getPendingOutboxEntries(limit = 100): OutboxEntry[] {
  return db
    .prepare(
      `SELECT id, reading_id, payload_json, status, retry_count, created_at, updated_at, last_error
       FROM outbox WHERE status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?`
    )
    .all(limit) as OutboxEntry[]
}

export function markOutboxSynced(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE outbox SET status = 'synced', updated_at = ?, last_error = NULL WHERE id IN (${placeholders})`
  ).run(updatedAt, ...ids)
  setSetting('cloud_sync_last_success_at', updatedAt)
}

export function markOutboxFailed(id: number, errorMessage: string): void {
  const updatedAt = new Date().toISOString()
  const row = db.prepare('SELECT retry_count FROM outbox WHERE id = ?').get(id) as
    | { retry_count: number }
    | undefined
  const nextRetryCount = (row?.retry_count ?? 0) + 1

  db.prepare(
    `UPDATE outbox SET status = 'pending', retry_count = ?, updated_at = ?, last_error = ?
     WHERE id = ?`
  ).run(nextRetryCount, updatedAt, errorMessage, id)
  setSetting('cloud_sync_last_error', errorMessage)
}

export function getCloudSyncStatus(): CloudSyncStatus {
  const pendingCount = Number(
    (
      db.prepare('SELECT COUNT(*) AS count FROM outbox WHERE status IN (?, ?)').get('pending', 'failed') as {
        count: number
      }
    )?.count ?? 0
  )
  const lastSuccess = getSettingOptional('cloud_sync_last_success_at')
  const lastError = getSettingOptional('cloud_sync_last_error')
  const cloudUrl = getSettingOptional('cloud_sync_url')

  return {
    enabled: Boolean(cloudUrl),
    pendingCount,
    lastSyncedAt: lastSuccess,
    lastError,
    url: cloudUrl
  }
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
  const header = 'timestamp,node_id,temperature,turbidity,tds,ph'
  const rows = readings.map(
    (r) => `${r.timestamp},${r.node_id},${r.temperature},${r.turbidity},${r.tds},${r.ph ?? ''}`
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
  const user = db
    .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(username) as { username: string; password_hash: string; role: string } | undefined
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
  return (db.prepare('SELECT * FROM nodes ORDER BY id').all() as any[]).map(normalizeNodeRow)
}

export function getThresholdProfiles(): SavedThresholdProfile[] {
  return (db.prepare('SELECT * FROM threshold_profiles ORDER BY name ASC').all() as any[]).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    profile: parseCustomProfile(row.profile) ?? DEFAULT_POND_PROFILES.tilapia
  }))
}

export function saveThresholdProfile(name: string, profile: PondThresholdProfile): SavedThresholdProfile {
  const normalizedName = name.trim()
  db.prepare(
    `INSERT INTO threshold_profiles (name, profile)
     VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET profile = excluded.profile`
  ).run(normalizedName, JSON.stringify(profile))

  const row = db
    .prepare('SELECT * FROM threshold_profiles WHERE name = ?')
    .get(normalizedName) as { id: number; name: string; profile: string }

  return {
    id: Number(row.id),
    name: String(row.name),
    profile: parseCustomProfile(row.profile) ?? DEFAULT_POND_PROFILES.tilapia
  }
}

export function deleteThresholdProfile(id: number): number {
  const result = db.prepare('DELETE FROM threshold_profiles WHERE id = ?').run(id)
  return Number(result.changes ?? 0)
}

export function deleteNodeReadings(nodeId: string): number {
  const result = db.prepare('DELETE FROM readings WHERE node_id = ?').run(nodeId)
  return Number(result.changes ?? 0)
}

export function deleteNode(nodeId: string): number {
  const result = db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId)
  return Number(result.changes ?? 0)
}

export function getNodePondType(nodeId: string): string | null {
  const row = db.prepare('SELECT pond_type FROM nodes WHERE id = ?').get(nodeId) as
    | { pond_type: string | null }
    | undefined
  return row?.pond_type ?? null
}

export function getNodeCustomProfile(nodeId: string): PondThresholdProfile | null {
  const row = db.prepare('SELECT custom_profile FROM nodes WHERE id = ?').get(nodeId) as
    | { custom_profile: string | null }
    | undefined
  return parseCustomProfile(row?.custom_profile ?? null)
}

export function setNodePondType(nodeId: string, pondType: string): NodeRow {
  db.prepare(
    `INSERT INTO nodes (id, pond_type, status)
     VALUES (?, ?, 'unknown')
     ON CONFLICT(id) DO UPDATE SET pond_type = excluded.pond_type`
  ).run(nodeId, pondType)
  return normalizeNodeRow(db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId))
}

export function setNodeCustomProfile(
  nodeId: string,
  profile: PondThresholdProfile | null
): NodeRow {
  db.prepare(
    `INSERT INTO nodes (id, custom_profile, status)
     VALUES (?, ?, 'unknown')
     ON CONFLICT(id) DO UPDATE SET custom_profile = excluded.custom_profile`
  ).run(nodeId, profile ? JSON.stringify(profile) : null)
  return normalizeNodeRow(db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId))
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

