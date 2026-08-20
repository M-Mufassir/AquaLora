// node-wifi ships no types. Minimal ambient declaration covering only the
// functions wifiManager.ts actually uses.
declare module 'node-wifi' {
  interface InitOptions {
    iface: string | null
  }

  interface ScanResult {
    ssid: string
    bssid?: string
    mac?: string
    channel?: number
    frequency?: number
    signal_level: number
    quality?: number
    security: string
    security_flags?: string
  }

  interface ConnectOptions {
    ssid: string
    password?: string
  }

  interface CurrentConnection {
    ssid: string
    bssid?: string
    mac?: string
    channel?: number
    frequency?: number
    signal_level?: number
    security?: string
  }

  interface NodeWifi {
    init(options: InitOptions): void
    scan(): Promise<ScanResult[]>
    connect(options: ConnectOptions): Promise<void>
    disconnect(): Promise<void>
    getCurrentConnections(): Promise<CurrentConnection[]>
  }

  const wifi: NodeWifi
  export default wifi
}
