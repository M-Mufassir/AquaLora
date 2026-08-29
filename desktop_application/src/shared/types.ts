// Data contract agreed with the LoRa/firmware team — see README.md section
// "Data contract". Do not change field names/units without re-syncing with
// the Master Node firmware.
export const POND_TYPES = ['tilapia', 'prawn', 'catfish', 'tuna', 'salmon', 'custom'] as const
export type PondType = (typeof POND_TYPES)[number]

export interface PondThresholdRange {
  min: number
  max: number
}

export interface PondThresholdProfile {
  temperature: PondThresholdRange
  turbidity: PondThresholdRange
  tds: PondThresholdRange
  ph: PondThresholdRange
}

export const POND_LABELS: Record<PondType, string> = {
  tilapia: 'Tilapia',
  prawn: 'Prawn',
  catfish: 'Catfish',
  tuna: 'Tuna',
  salmon: 'Salmon',
  custom: 'Custom'
}

export const DEFAULT_POND_PROFILES: Record<Exclude<PondType, 'custom'>, PondThresholdProfile> = {
  tilapia: {
    temperature: { min: 26, max: 30 },
    turbidity: { min: 0, max: 25 },
    tds: { min: 100, max: 300 },
    ph: { min: 6.5, max: 8.5 }
  },
  prawn: {
    temperature: { min: 28, max: 32 },
    turbidity: { min: 0, max: 15 },
    tds: { min: 150, max: 250 },
    ph: { min: 7, max: 8.5 }
  },
  catfish: {
    temperature: { min: 24, max: 30 },
    turbidity: { min: 0, max: 30 },
    tds: { min: 80, max: 250 },
    ph: { min: 6.5, max: 8 }
  },
  tuna: {
    temperature: { min: 20, max: 25 },
    turbidity: { min: 0, max: 10 },
    tds: { min: 120, max: 250 },
    ph: { min: 7.5, max: 8.5 }
  },
  salmon: {
    temperature: { min: 12, max: 18 },
    turbidity: { min: 0, max: 15 },
    tds: { min: 80, max: 200 },
    ph: { min: 6.5, max: 8 }
  }
}

export interface Reading {
  node_id: string
  timestamp: string
  temperature: number
  turbidity: number
  tds: number
  ph?: number | null
  pond_type?: PondType | null
  custom_profile?: PondThresholdProfile | null
  battery_pct: number
  rssi: number
}

export interface SetIntervalCommand {
  type: 'set_interval'
  minutes: number
}

// Sent once by the Master Node right when the dashboard's WebSocket connects,
// so the UI can show "N nodes detected" immediately instead of waiting for
// each node's first staggered Reading to arrive. Distinguished from a
// Reading by the `type` field — Reading messages never carry one, so this
// doesn't touch the fixed data contract above.
export interface NodeListMessage {
  type: 'node_list'
  nodes: { node_id: string }[]
}

export interface WifiNetwork {
  ssid: string
  signalLevel: number
  security: string
}

export interface WifiConnectionState {
  ssid: string | null
}

export interface StoredReading {
  id: number
  node_id: string
  timestamp: string
  temperature: number
  turbidity: number
  tds: number
  ph: number | null
  pond_type: PondType | null
}

export interface Score {
  node_id: string
  timestamp: string
  score: number
  status: 'Normal' | 'Warning' | 'Critical'
  parameter: string | null
  recommendation: string | null
}

export interface Alert {
  id: number
  node_id: string
  timestamp: string
  parameter: string
  severity: string
  message: string
  acknowledged: number
}

export interface NodeRow {
  id: string
  name: string | null
  location: string | null
  last_seen: string | null
  battery_pct: number | null
  lora_rssi: number | null
  status: 'unknown' | 'online' | 'offline'
  pond_type: PondType | null
  custom_profile: PondThresholdProfile | null
}

export interface UserRow {
  id: number
  username: string
  role: string
}

export interface SavedThresholdProfile {
  id: number
  name: string
  profile: PondThresholdProfile
}

export interface Settings {
  theme: 'light' | 'dark'
  soundEnabled: boolean
  savedWifiSsid: string | null
  savedWifiPassword: string | null
  cloudSyncUrl: string | null
}

export interface OutboxEntry {
  id: number
  reading_id: number
  payload_json: string
  status: 'pending' | 'synced' | 'failed'
  retry_count: number
  created_at: string
  updated_at: string | null
  last_error: string | null
}

export interface CloudSyncStatus {
  enabled: boolean
  pendingCount: number
  lastSyncedAt: string | null
  lastError: string | null
  url: string | null
}

export type NodeStatusTier = 'Good' | 'Warning' | 'Critical' | 'Offline'

// Shared by Home cards, the Logs detail view, and the critical-alert
// overlay so every part of the UI agrees on a node's tier.
export function deriveStatusTier(
  score: Pick<Score, 'status'> | null,
  online: boolean
): NodeStatusTier {
  if (!online) return 'Offline'
  if (!score) return 'Good'
  if (score.status === 'Normal') return 'Good'
  return score.status
}

export type GaugeStatus = 'normal' | 'warning' | 'critical' | 'unknown'

export function getDefaultPondProfile(
  pondType: PondType | null | undefined
): PondThresholdProfile {
  if (!pondType || pondType === 'custom') {
    return DEFAULT_POND_PROFILES.tilapia
  }
  return DEFAULT_POND_PROFILES[pondType]
}

export function resolveEffectiveProfile(
  pondType: PondType | null | undefined,
  customProfile: PondThresholdProfile | null | undefined
): PondThresholdProfile {
  if (pondType === 'custom') {
    return customProfile ?? DEFAULT_POND_PROFILES.tilapia
  }
  return getDefaultPondProfile(pondType)
}

// Colors a single parameter's gauge: only the parameter the decision engine
// flagged as worst gets the Warning/Critical color, everything else reads
// as normal once a score exists at all.
export function deriveParamStatus(
  score: Pick<Score, 'status' | 'parameter'> | null,
  param: 'temperature' | 'turbidity' | 'tds'
): GaugeStatus {
  if (!score) return 'unknown'
  if (score.status === 'Normal') return 'normal'
  return score.parameter === param ? (score.status.toLowerCase() as GaugeStatus) : 'normal'
}
