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

    CREATE TABLE IF NOT EXISTS alert_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_alert_outbox_status ON alert_outbox (status, created_at);

    CREATE TABLE IF NOT EXISTS master_nodes (
      code TEXT PRIMARY KEY,
      display_name TEXT,
      ws_url TEXT,
      key_hex TEXT,
      last_connected TEXT,
      created_at TEXT
    );
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
    db.prepare('ALTER TABLE readings ADD COLUMN master_node_code TEXT').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    db.prepare('CREATE INDEX IF NOT EXISTS idx_readings_master ON readings (master_node_code, timestamp)').run()
  } catch {
    // Index already exists.
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

  try {
    db.prepare('ALTER TABLE nodes ADD COLUMN master_node_code TEXT').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    db.prepare('ALTER TABLE alerts ADD COLUMN master_node_code TEXT').run()
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    db.prepare('ALTER TABLE outbox ADD COLUMN master_node_code TEXT').run()
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

// ============================================================================
// MASTER NODE REGISTRY & SCOPING
// ============================================================================
let activeMasterNodeCode: string | null = null

export function setActiveMasterNodeCode(code: string | null): void {
  activeMasterNodeCode = code ? code.trim() : null
  if (code) {
    setSetting('active_master_node_code', code.trim())
  }
}

export function getActiveMasterNodeCode(): string | null {
  if (!activeMasterNodeCode) {
    activeMasterNodeCode = getSettingOptional('active_master_node_code') || getSettingOptional('master_node_code') || null
  }
  return activeMasterNodeCode
}

export interface MasterNodeRecord {
  code: string
  display_name: string | null
  ws_url: string | null
  key_hex: string | null
  last_connected: string | null
  created_at: string | null
}

export function getMasterNodeByCode(code: string): MasterNodeRecord | null {
  const row = db.prepare('SELECT * FROM master_nodes WHERE LOWER(code) = LOWER(?)').get(code) as
    | MasterNodeRecord
    | undefined
  return row ?? null
}

export function getAllMasterNodes(): MasterNodeRecord[] {
  return db.prepare('SELECT * FROM master_nodes ORDER BY last_connected DESC').all() as MasterNodeRecord[]
}

export function registerOrUpdateMasterNode(
  code: string,
  displayName: string,
  wsUrl?: string,
  keyHex?: string
): { isNew: boolean; record: MasterNodeRecord } {
  const normalizedCode = code.trim()
  const existing = getMasterNodeByCode(normalizedCode)
  const now = new Date().toISOString()
  if (existing) {
    db.prepare(`
      UPDATE master_nodes
      SET display_name = COALESCE(?, display_name),
          ws_url = COALESCE(?, ws_url),
          key_hex = COALESCE(?, key_hex),
          last_connected = ?
      WHERE LOWER(code) = LOWER(?)
    `).run(displayName || null, wsUrl || null, keyHex || null, now, normalizedCode)
    setActiveMasterNodeCode(normalizedCode)
    return { isNew: false, record: getMasterNodeByCode(normalizedCode)! }
  } else {
    db.prepare(`
      INSERT INTO master_nodes (code, display_name, ws_url, key_hex, last_connected, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(normalizedCode, displayName || normalizedCode, wsUrl || null, keyHex || null, now, now)
    setActiveMasterNodeCode(normalizedCode)
    return { isNew: true, record: getMasterNodeByCode(normalizedCode)! }
  }
}

/**
 * Wipe node-specific telemetry data (readings, nodes, alerts, sync outbox).
 * If a masterNodeCode is provided, wipes ONLY that Master Node's local data.
 * Settings, users, and threshold profiles are preserved.
 */
export function resetLocalNodeData(masterNodeCode?: string): { nodes: number; readings: number; alerts: number; outbox: number } {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  const tx = db.transaction(() => {
    let nodes = 0, readings = 0, alerts = 0, outbox = 0
    if (code) {
      nodes = (db.prepare('DELETE FROM nodes WHERE master_node_code = ?').run(code)).changes
      readings = (db.prepare('DELETE FROM readings WHERE master_node_code = ?').run(code)).changes
      alerts = (db.prepare('DELETE FROM alerts WHERE master_node_code = ?').run(code)).changes
      outbox = (db.prepare('DELETE FROM outbox WHERE master_node_code = ?').run(code)).changes
    } else {
      nodes = (db.prepare('DELETE FROM nodes').run()).changes
      readings = (db.prepare('DELETE FROM readings').run()).changes
      alerts = (db.prepare('DELETE FROM alerts').run()).changes
      outbox = (db.prepare('DELETE FROM outbox').run()).changes
    }
    return { nodes, readings, alerts, outbox }
  })
  const result = tx()
  console.log('[db] resetLocalNodeData for code:', code, result)
  return result
}

export function upsertNodeFromReading(reading: Reading, masterNodeCode?: string): NodeRow {
  const code = masterNodeCode ?? (reading as any).master_node_code ?? getActiveMasterNodeCode()
  db.prepare(
    `INSERT INTO nodes (id, last_seen, battery_pct, lora_rssi, status, master_node_code)
     VALUES (@node_id, @timestamp, @battery_pct, @rssi, 'online', ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen = excluded.last_seen,
       battery_pct = excluded.battery_pct,
       lora_rssi = excluded.lora_rssi,
       status = 'online',
       master_node_code = COALESCE(nodes.master_node_code, excluded.master_node_code)`
  ).run(reading, code)
  return normalizeNodeRow(db.prepare('SELECT * FROM nodes WHERE id = ?').get(reading.node_id))
}

export function insertReading(reading: Reading, masterNodeCode?: string): number {
  const code = masterNodeCode ?? (reading as any).master_node_code ?? getActiveMasterNodeCode()
  // Ensure pond_type and master_node_code are populated
  const enrichedReading = {
    ...reading,
    pond_type: (reading as any).pond_type ?? 'tilapia',
    master_node_code: code
  } as any

  const result = db.prepare(
    `INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds, ph, pond_type, master_node_code)
     VALUES (@node_id, @timestamp, @temperature, @turbidity, @tds, @ph, @pond_type, @master_node_code)`
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
  const pendingOutbox = Number(
    (
      db.prepare('SELECT COUNT(*) AS count FROM outbox WHERE status IN (?, ?)').get('pending', 'failed') as {
        count: number
      }
    )?.count ?? 0
  )
  const pendingAlertOutbox = Number(
    (
      db.prepare('SELECT COUNT(*) AS count FROM alert_outbox WHERE status IN (?, ?)').get('pending', 'failed') as {
        count: number
      }
    )?.count ?? 0
  )
  const pendingCount = pendingOutbox + pendingAlertOutbox
  const lastSuccess = getSettingOptional('cloud_sync_last_success_at')
  const lastError = getSettingOptional('cloud_sync_last_error')
  const cloudUrl = getSettingOptional('cloud_sync_url') || 'https://aqualora.up.railway.app/api'

  return {
    enabled: true,
    pendingCount,
    lastSyncedAt: lastSuccess,
    lastError,
    url: cloudUrl
  }
}

// Alert Outbox Functions (for cloud sync)
export interface AlertOutboxEntry {
  id: number
  alert_id: number
  payload_json: string
  status: 'pending' | 'synced' | 'failed'
  retry_count: number
  created_at: string
  updated_at: string | null
  last_error: string | null
}

export function queueAlertForSync(alert: Alert): number {
  const payload = JSON.stringify(alert)
  const createdAt = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO alert_outbox (alert_id, payload_json, status, retry_count, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`
    )
    .run(alert.id || 0, payload, createdAt, createdAt)

  return Number(result.lastInsertRowid ?? 0)
}

export function getPendingAlertOutboxEntries(limit = 100): AlertOutboxEntry[] {
  return db
    .prepare(
      `SELECT id, alert_id, payload_json, status, retry_count, created_at, updated_at, last_error
       FROM alert_outbox WHERE status IN ('pending', 'failed') ORDER BY created_at ASC LIMIT ?`
    )
    .all(limit) as AlertOutboxEntry[]
}

export function markAlertOutboxSynced(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE alert_outbox SET status = 'synced', updated_at = ?, last_error = NULL WHERE id IN (${placeholders})`
  ).run(updatedAt, ...ids)
  setSetting('cloud_sync_last_success_at', updatedAt)
}

export function markAlertOutboxFailed(id: number, errorMessage: string): void {
  const updatedAt = new Date().toISOString()
  const row = db.prepare('SELECT retry_count FROM alert_outbox WHERE id = ?').get(id) as
    | { retry_count: number }
    | undefined
  const nextRetryCount = (row?.retry_count ?? 0) + 1

  db.prepare(
    `UPDATE alert_outbox SET status = 'pending', retry_count = ?, updated_at = ?, last_error = ?
     WHERE id = ?`
  ).run(nextRetryCount, updatedAt, errorMessage, id)
  setSetting('cloud_sync_last_error', errorMessage)
}

export function getRecentReadings(nodeId: string, limit = 50, masterNodeCode?: string): StoredReading[] {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  if (code) {
    return db
      .prepare(`SELECT * FROM readings WHERE node_id = ? AND (master_node_code = ? OR master_node_code IS NULL) ORDER BY timestamp DESC LIMIT ?`)
      .all(nodeId, code, limit) as StoredReading[]
  }
  return db
    .prepare(`SELECT * FROM readings WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(nodeId, limit) as StoredReading[]
}

/**
 * Returns the latest stored reading for every distinct node in SQLite for the active Master Node.
 * Used on startup to populate node cards immediately.
 */
export function getLatestReadingsForAllNodes(masterNodeCode?: string): Record<string, StoredReading> {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  const query = code
    ? `SELECT r.* FROM readings r
       INNER JOIN (
         SELECT node_id, MAX(timestamp) as max_time
         FROM readings
         WHERE master_node_code = ? OR master_node_code IS NULL
         GROUP BY node_id
       ) latest ON r.node_id = latest.node_id AND r.timestamp = latest.max_time
       WHERE r.master_node_code = ? OR r.master_node_code IS NULL`
    : `SELECT r.* FROM readings r
       INNER JOIN (
         SELECT node_id, MAX(timestamp) as max_time
         FROM readings
         GROUP BY node_id
       ) latest ON r.node_id = latest.node_id AND r.timestamp = latest.max_time`

  const rows = (code ? db.prepare(query).all(code, code) : db.prepare(query).all()) as StoredReading[]

  const map: Record<string, StoredReading> = {}
  for (const row of rows) {
    map[row.node_id] = row
  }
  return map
}

/**
 * Filters out readings that already exist in the local SQLite database.
 */
export function filterNewReadings(readings: Reading[]): Reading[] {
  if (readings.length === 0) return []
  const checkStmt = db.prepare('SELECT 1 FROM readings WHERE node_id = ? AND timestamp = ? LIMIT 1')
  return readings.filter((r) => !checkStmt.get(r.node_id, r.timestamp))
}

/**
 * Inserts historical readings in batch while ignoring records that already exist
 * (matching node_id and timestamp) without creating duplicate outbox queues,
 * and returns both inserted count and the newly inserted reading records.
 */
export function batchInsertHistoricalReadingsWithResult(
  readings: Reading[],
  masterNodeCode?: string
): { count: number; inserted: Reading[] } {
  if (readings.length === 0) return { count: 0, inserted: [] }
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  const insertStmt = db.prepare(
    `INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds, ph, pond_type, master_node_code)
     SELECT @node_id, @timestamp, @temperature, @turbidity, @tds, @ph, @pond_type, @master_node_code
     WHERE NOT EXISTS (
       SELECT 1 FROM readings WHERE node_id = @node_id AND timestamp = @timestamp
     )`
  )

  const inserted: Reading[] = []
  const tx = db.transaction((items: Reading[]) => {
    for (const r of items) {
      const enriched: any = {
        node_id: r.node_id,
        timestamp: r.timestamp,
        temperature: r.temperature,
        turbidity: r.turbidity,
        tds: r.tds,
        ph: r.ph,
        pond_type: (r as any).pond_type ?? 'tilapia',
        master_node_code: (r as any).master_node_code ?? code
      }
      const res = insertStmt.run(enriched)
      if (res.changes > 0) {
        inserted.push({
          ...enriched,
          battery_pct: r.battery_pct ?? 0,
          rssi: r.rssi ?? 0
        })
        upsertNodeStub(r.node_id, code ?? undefined)
      }
    }
  })

  tx(readings)
  return { count: inserted.length, inserted }
}

export function batchInsertHistoricalReadings(readings: Reading[], masterNodeCode?: string): number {
  return batchInsertHistoricalReadingsWithResult(readings, masterNodeCode).count
}

export function getReadingsInRange(
  nodeId: string,
  startIso: string,
  endIso: string,
  masterNodeCode?: string
): StoredReading[] {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  if (code) {
    return db
      .prepare(
        `SELECT * FROM readings
         WHERE node_id = ? AND (master_node_code = ? OR master_node_code IS NULL) AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC
         LIMIT 5000`
      )
      .all(nodeId, code, startIso, endIso) as StoredReading[]
  }
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
  master_node_code?: string
}): Alert {
  const code = alert.master_node_code ?? getActiveMasterNodeCode()
  const result = db
    .prepare(
      `INSERT INTO alerts (node_id, timestamp, parameter, severity, message, master_node_code)
       VALUES (@node_id, @timestamp, @parameter, @severity, @message, @master_node_code)`
    )
    .run({ ...alert, master_node_code: code })
  
  const alertId = Number(result.lastInsertRowid ?? 0)
  const insertedAlert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as Alert
  
  // Queue alert for cloud sync
  if (alertId > 0) {
    queueAlertForSync(insertedAlert)
  }
  
  return insertedAlert
}

export function filterNewAlerts(alerts: Array<{ node_id: string; timestamp: string; parameter: string }>): any[] {
  if (alerts.length === 0) return []
  const checkStmt = db.prepare(
    'SELECT 1 FROM alerts WHERE node_id = ? AND timestamp = ? AND parameter = ? LIMIT 1'
  )
  return alerts.filter((a) => !checkStmt.get(a.node_id, a.timestamp, a.parameter))
}

export function batchInsertHistoricalAlerts(alerts: any[], masterNodeCode?: string): Alert[] {
  if (alerts.length === 0) return []
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  const insertStmt = db.prepare(`
    INSERT INTO alerts (node_id, timestamp, parameter, severity, message, master_node_code, acknowledged)
    SELECT @node_id, @timestamp, @parameter, @severity, @message, @master_node_code, 0
    WHERE NOT EXISTS (
      SELECT 1 FROM alerts WHERE node_id = @node_id AND timestamp = @timestamp AND parameter = @parameter
    )
  `)
  const inserted: Alert[] = []
  const tx = db.transaction((items: any[]) => {
    for (const a of items) {
      const row = {
        node_id: a.node_id,
        timestamp: a.timestamp,
        parameter: a.parameter,
        severity: a.severity,
        message: a.message,
        master_node_code: a.master_node_code ?? code
      }
      const res = insertStmt.run(row)
      if (res.changes > 0) {
        inserted.push({ ...row, id: Number(res.lastInsertRowid), acknowledged: 0 })
      }
    }
  })
  tx(alerts)
  return inserted
}


export function getRecentAlerts(nodeId: string, limit = 50, masterNodeCode?: string): Alert[] {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  if (code) {
    return db
      .prepare(`SELECT * FROM alerts WHERE node_id = ? AND (master_node_code = ? OR master_node_code IS NULL) ORDER BY timestamp DESC LIMIT ?`)
      .all(nodeId, code, limit) as Alert[]
  }
  return db
    .prepare(`SELECT * FROM alerts WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(nodeId, limit) as Alert[]
}

export function getAllRecentAlerts(limit = 200, masterNodeCode?: string): Alert[] {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  if (code) {
    return db.prepare(`SELECT * FROM alerts WHERE (master_node_code = ? OR master_node_code IS NULL) ORDER BY timestamp DESC LIMIT ?`).all(code, limit) as Alert[]
  }
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

export function upsertUser(username: string, password: string, role = 'operator'): void {
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS)
  db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role
  `).run(username, passwordHash, role)
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

export function getAllNodes(masterNodeCode?: string): NodeRow[] {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  if (code) {
    return (
      db
        .prepare(
          'SELECT * FROM nodes WHERE master_node_code = ? OR master_node_code IS NULL ORDER BY id'
        )
        .all(code) as any[]
    ).map(normalizeNodeRow)
  }
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
export function upsertNodeStub(id: string, masterNodeCode?: string): NodeRow {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  db.prepare(
    `INSERT INTO nodes (id, status, master_node_code) VALUES (?, 'unknown', ?)
     ON CONFLICT(id) DO UPDATE SET master_node_code = COALESCE(nodes.master_node_code, excluded.master_node_code)`
  ).run(id, code)
  return normalizeNodeRow(db.prepare('SELECT * FROM nodes WHERE id = ?').get(id))
}

export function upsertNode(
  id: string,
  name: string | null,
  location: string | null,
  masterNodeCode?: string
): NodeRow {
  const code = masterNodeCode ?? getActiveMasterNodeCode()
  db.prepare(
    `INSERT INTO nodes (id, name, location, status, master_node_code)
     VALUES (?, ?, ?, 'unknown', ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, location = excluded.location, master_node_code = COALESCE(excluded.master_node_code, nodes.master_node_code)`
  ).run(id, name, location, code)
  return normalizeNodeRow(db.prepare('SELECT * FROM nodes WHERE id = ?').get(id))
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

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}


