import WebSocket from 'ws'
import type { Reading, SetIntervalCommand, NodeListMessage } from '../shared/types'
import { encryptMessage, decryptMessage } from './secureChannel'

// Default ESP32 Master Node WebSocket endpoint (AP mode).
// Once paired via the Connect Device wizard, main calls connect() again
// with the node's WiFi AP gateway (ws://192.168.4.1:8081) or LAN IP
// (e.g. ws://192.168.1.50:8081), and the choice is persisted in settings.
const DEFAULT_ESP32_URL = 'ws://192.168.4.1:8081'
const RECONNECT_DELAY_MS = 3000

export type ConnectionStatus = 'connected' | 'reconnecting'

export class MasterNodeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private encryptionKey: Buffer | null = null
  private onReadingCallback: ((reading: Reading) => void) | null = null
  private onNodeListCallback: ((nodes: NodeListMessage['nodes']) => void) | null = null
  private onStatusChangeCallback: ((status: ConnectionStatus) => void) | null = null

  connect(url: string = DEFAULT_ESP32_URL, encryptionKey?: Buffer): void {
    // Tear down any existing connection first — connect() can be called again
    // when the user re-pairs to a different Master Node via the Connect Device wizard.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.close()
    }

    this.encryptionKey = encryptionKey ?? null

    this.socket = new WebSocket(url)


    this.socket.on('open', () => {
      console.log(
        `[masterNodeClient] connected to ${url}${this.encryptionKey ? ' (encrypted)' : ' (plain — dev/mock)'}`
      )
      this.onStatusChangeCallback?.('connected')
    })

    this.socket.on('message', (data) => {
      const raw = data.toString()
      const plaintext = this.encryptionKey ? decryptMessage(this.encryptionKey, raw) : raw
      if (plaintext === null) return // decryptMessage already logged why

      try {
        const parsed = JSON.parse(plaintext)
        if (parsed.type === 'node_list') {
          this.onNodeListCallback?.((parsed as NodeListMessage).nodes)
        } else {
          this.onReadingCallback?.(parsed as Reading)
        }
      } catch (err) {
        console.error('[masterNodeClient] failed to parse message:', err)
      }
    })

    this.socket.on('close', () => {
      console.log(`[masterNodeClient] disconnected from ${url}, retrying in 3s`)
      this.onStatusChangeCallback?.('reconnecting')
      this.scheduleReconnect(url, this.encryptionKey)
    })

    this.socket.on('error', (err) => {
      console.error('[masterNodeClient] connection error:', err.message)
    })
  }

  onReading(callback: (reading: Reading) => void): void {
    this.onReadingCallback = callback
  }

  onNodeList(callback: (nodes: NodeListMessage['nodes']) => void): void {
    this.onNodeListCallback = callback
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.onStatusChangeCallback = callback
  }

  sendCommand(command: SetIntervalCommand): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.warn('[masterNodeClient] cannot send command, socket not open')
      return
    }
    const payload = JSON.stringify(command)
    this.socket.send(this.encryptionKey ? encryptMessage(this.encryptionKey, payload) : payload)
  }

  private scheduleReconnect(url: string, encryptionKey: Buffer | null): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect(url, encryptionKey ?? undefined)
    }, RECONNECT_DELAY_MS)
  }
}
