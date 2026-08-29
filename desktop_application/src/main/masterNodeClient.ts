import WebSocket from 'ws'
import type { Reading, SetIntervalCommand, NodeListMessage } from '../shared/types'
import { encryptMessage, decryptMessage } from './secureChannel'

// Default target in development, before a device has been paired via the
// Connect Device wizard (see README "Real MCU pairing"). Once paired, main
// calls connect() again with the real Master Node's URL (its WiFi AP
// gateway, e.g. ws://192.168.4.1:8081) and that choice is persisted to the
// settings table so restarts reconnect straight to it.
const DEFAULT_MOCK_URL = 'ws://localhost:8081'
const RECONNECT_DELAY_MS = 3000

export type ConnectionStatus = 'connected' | 'reconnecting'

export class MasterNodeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private encryptionKey: Buffer | null = null
  private onReadingCallback: ((reading: Reading) => void) | null = null
  private onNodeListCallback: ((nodes: NodeListMessage['nodes']) => void) | null = null
  private onStatusChangeCallback: ((status: ConnectionStatus) => void) | null = null

  // encryptionKey is present for a real MCU paired with a WiFi password
  // (AES-256-GCM, see secureChannel.ts) and absent for the dev mock, which
  // speaks plain JSON — mirroring the two states the wizard can leave a
  // pairing in.
  connect(url: string = DEFAULT_MOCK_URL, encryptionKey?: Buffer): void {
    // If we are connecting to a local mock server, ignore any stored encryption key.
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      encryptionKey = undefined;
    }
    // Tear down any existing connection first — connect() can now be called
    // again mid-session when the user re-pairs to a different Master Node
    // from the Connect Device wizard, which never happened before.
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
