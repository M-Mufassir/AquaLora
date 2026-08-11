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
