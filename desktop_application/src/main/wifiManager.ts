import wifi from 'node-wifi'
import type { WifiNetwork, WifiConnectionState } from '../shared/types'

let initialized = false

function ensureInit(): void {
  if (initialized) return
  try {
    wifi.init({ iface: null })
    initialized = true
  } catch (err) {
    console.warn('[wifiManager] Failed to initialize node-wifi:', err)
  }
}

// Timeout helper to ensure Wi-Fi operations never block Electron or main process
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackValue: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs))
  ])
}

// Scans and dedupes by SSID with non-blocking 3s timeout
export async function scanNetworks(): Promise<WifiNetwork[]> {
  ensureInit()
  try {
    const scanPromise = wifi.scan().then((results) => {
      const bySsid = new Map<string, WifiNetwork>()
      for (const r of results) {
        if (!r.ssid) continue
        const existing = bySsid.get(r.ssid)
        if (!existing || r.signal_level > existing.signalLevel) {
          bySsid.set(r.ssid, { ssid: r.ssid, signalLevel: r.signal_level, security: r.security })
        }
      }
      return [...bySsid.values()].sort((a, b) => b.signalLevel - a.signalLevel)
    })

    return await withTimeout(scanPromise, 3000, [])
  } catch (err) {
    console.warn('[wifiManager] Network scan failed or timed out:', err)
    return []
  }
}

export async function connectToNetwork(ssid: string, password: string): Promise<void> {
  ensureInit()
  try {
    const current = await getCurrentConnection()
    if (current.ssid && current.ssid === ssid) return

    const connectPromise = wifi.connect({ ssid, password })
    await withTimeout(connectPromise, 5000, undefined)
  } catch (err) {
    console.warn('[wifiManager] Wi-Fi connection attempt failed:', err)
  }
}

export async function getCurrentConnection(): Promise<WifiConnectionState> {
  ensureInit()
  try {
    const statusPromise: Promise<WifiConnectionState> = wifi.getCurrentConnections().then((conns) => ({
      ssid: conns[0]?.ssid ?? null
    }))
    return await withTimeout<WifiConnectionState>(statusPromise, 2000, { ssid: null })
  } catch (err) {
    console.warn('[wifiManager] Failed to fetch current connection:', err)
    return { ssid: null }
  }
}
