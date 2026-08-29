import wifi from 'node-wifi'
import type { WifiNetwork, WifiConnectionState } from '../shared/types'

let initialized = false

function ensureInit(): void {
  if (initialized) return
  wifi.init({ iface: null })
  initialized = true
}

// Scans and dedupes by SSID (the same AP shows up once per channel/BSSID
// otherwise), keeping the strongest signal reading of each.
export async function scanNetworks(): Promise<WifiNetwork[]> {
  ensureInit()
  const results = await wifi.scan()
  const bySsid = new Map<string, WifiNetwork>()
  for (const r of results) {
    if (!r.ssid) continue
    const existing = bySsid.get(r.ssid)
    if (!existing || r.signal_level > existing.signalLevel) {
      bySsid.set(r.ssid, { ssid: r.ssid, signalLevel: r.signal_level, security: r.security })
    }
  }
  return [...bySsid.values()].sort((a, b) => b.signalLevel - a.signalLevel)
}

export async function connectToNetwork(ssid: string, password: string): Promise<void> {
  ensureInit()
  const current = await getCurrentConnection()
  if (current.ssid && current.ssid === ssid) return
  await wifi.connect({ ssid, password })
}

export async function getCurrentConnection(): Promise<WifiConnectionState> {
  ensureInit()
  const conns = await wifi.getCurrentConnections()
  return { ssid: conns[0]?.ssid ?? null }
}
