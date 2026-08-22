// Data contract agreed with the LoRa/firmware team — see README.md section
// "Data contract". Do not change field names/units without re-syncing with
// the Master Node firmware.
export interface Reading {
  node_id: string
  timestamp: string
  temperature: number
  turbidity: number
  tds: number
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
}

export interface UserRow {
  id: number
  username: string
  role: string
}

export interface Settings {
  theme: 'light' | 'dark'
  soundEnabled: boolean
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
