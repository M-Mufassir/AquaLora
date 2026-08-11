import WebSocket from 'ws'
import type { Reading, SetIntervalCommand } from '../shared/types'

// Points at the mock server in development (see README.md Phase 2/9).
// Swap for the real Master Node's LAN IP once firmware is flashed —
// no other code should need to change if the data contract held.
const MASTER_NODE_URL = 'ws://localhost:8081'
const RECONNECT_DELAY_MS = 3000

export class MasterNodeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private onReadingCallback: ((reading: Reading) => void) | null = null

  connect(): void {
    this.socket = new WebSocket(MASTER_NODE_URL)

    this.socket.on('open', () => {
      console.log(`[masterNodeClient] connected to ${MASTER_NODE_URL}`)
    })

    this.socket.on('message', (data) => {
      try {
        const reading = JSON.parse(data.toString()) as Reading
        this.onReadingCallback?.(reading)
      } catch (err) {
        console.error('[masterNodeClient] failed to parse message:', err)
      }
    })

    this.socket.on('close', () => {
      console.log('[masterNodeClient] disconnected, retrying in 3s')
      this.scheduleReconnect()
    })

    this.socket.on('error', (err) => {
      console.error('[masterNodeClient] connection error:', err.message)
    })
  }

  onReading(callback: (reading: Reading) => void): void {
    this.onReadingCallback = callback
  }

  sendCommand(command: SetIntervalCommand): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(command))
    } else {
      console.warn('[masterNodeClient] cannot send command, socket not open')
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, RECONNECT_DELAY_MS)
  }
}
