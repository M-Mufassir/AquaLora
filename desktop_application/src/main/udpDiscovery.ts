import dgram from 'dgram'
import type { DiscoveredMasterNode } from '../shared/types'

const UDP_PORT = 8082
let socket: dgram.Socket | null = null
const discoveredDevices = new Map<string, DiscoveredMasterNode>()

export type DeviceDiscoveredCallback = (device: DiscoveredMasterNode) => void

/**
 * Start listening for UDP discovery broadcasts from AquaLoRa Master Nodes.
 */
export function startUdpDiscovery(onDiscovered: DeviceDiscoveredCallback): void {
  if (socket) {
    console.log('[udpDiscovery] Already listening on UDP port', UDP_PORT)
    return
  }

  try {
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

    socket.on('error', (err) => {
      console.warn('[udpDiscovery] Socket error:', err.message)
      stopUdpDiscovery()
    })

    socket.on('message', (msg, rinfo) => {
      try {
        const payloadStr = msg.toString('utf8').trim()
        const data = JSON.parse(payloadStr)

        // Validate that this packet is from an AquaLoRa device
        if (data.service === 'aqualora-master' || data.id || data.ip) {
          const deviceIp = data.ip || rinfo.address
          const deviceId = String(data.id || `node-${deviceIp}`)
          const devicePort = Number(data.port || 8081)
          const mode = data.mode === 'STA' || data.mode === 'AP' ? data.mode : 'STA'

          const device: DiscoveredMasterNode = {
            id: deviceId,
            code: data.code ? String(data.code) : undefined,
            name: data.name ? String(data.name) : undefined,
            ip: deviceIp,
            port: devicePort,
            service: data.service ?? 'aqualora-master',
            mode,
            lastSeen: new Date().toISOString()
          }

          discoveredDevices.set(deviceIp, device)
          onDiscovered(device)
        }
      } catch {
        // Silently ignore non-JSON or unrelated UDP packets
      }
    })

    socket.on('listening', () => {
      const addr = socket?.address()
      console.log(`[udpDiscovery] Listening for ESP32 broadcasts on UDP ${addr?.address}:${addr?.port}`)
    })

    socket.bind(UDP_PORT, '0.0.0.0')
  } catch (err) {
    console.warn('[udpDiscovery] Failed to bind UDP socket:', err)
  }
}

/**
 * Stop listening for UDP broadcasts and close socket.
 */
export function stopUdpDiscovery(): void {
  if (!socket) return
  try {
    socket.close(() => {
      console.log('[udpDiscovery] Stopped listening')
    })
  } catch (err) {
    console.warn('[udpDiscovery] Error closing socket:', err)
  } finally {
    socket = null
  }
}

/**
 * Get all currently discovered devices.
 */
export function getDiscoveredDevices(): DiscoveredMasterNode[] {
  return Array.from(discoveredDevices.values())
}

/**
 * Clear cached discovered devices.
 */
export function clearDiscoveredDevices(): void {
  discoveredDevices.clear()
}
