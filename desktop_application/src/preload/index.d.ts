import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Reading,
  StoredReading,
  Score,
  Alert,
  NodeRow,
  UserRow,
  Settings,
  WifiNetwork,
  WifiConnectionState,
  NodeListMessage
} from '../shared/types'

interface CsvExportResult {
  canceled: boolean
  filePath?: string
  count?: number
}

interface AquaLoraApi {
  onReading: (callback: (reading: Reading) => void) => () => void
  getRecentReadings: (nodeId: string, limit?: number) => Promise<StoredReading[]>
  getReadingsInRange: (nodeId: string, startIso: string, endIso: string) => Promise<StoredReading[]>
  exportReadingsCsv: (nodeId: string, startIso: string, endIso: string) => Promise<CsvExportResult>
  onScore: (callback: (score: Score) => void) => () => void
  onAlert: (callback: (alert: Alert) => void) => () => void
  getRecentAlerts: (nodeId: string, limit?: number) => Promise<Alert[]>
  getAllRecentAlerts: (limit?: number) => Promise<Alert[]>
  acknowledgeAlert: (id: number) => Promise<void>
  setSamplingInterval: (minutes: number) => Promise<void>
  login: (username: string, password: string) => Promise<{ username: string; role: string } | null>
  onConnectionStatus: (callback: (status: 'connected' | 'reconnecting') => void) => () => void
  onNodeStatus: (callback: (update: { node_id: string; online: boolean }) => void) => () => void
  onNodeUpdated: (callback: (node: NodeRow) => void) => () => void
  getAllNodes: () => Promise<NodeRow[]>
  getThresholdProfiles: () => Promise<any[]>
  saveThresholdProfile: (name: string, profile: any) => Promise<any>
  deleteThresholdProfile: (id: number) => Promise<number>
  upsertNode: (id: string, name: string, location: string) => Promise<NodeRow>
  scanWifi: () => Promise<WifiNetwork[]>
  connectWifi: (ssid: string, password: string) => Promise<void>
  getWifiStatus: () => Promise<WifiConnectionState>
  openWifiSettings: () => Promise<void>
  connectMasterNode: (url: string, password?: string) => Promise<void>
  onNodesDiscovered: (callback: (nodes: NodeListMessage['nodes']) => void) => () => void
  listUsers: () => Promise<UserRow[]>
  createUserAccount: (username: string, password: string, role: string) => Promise<void>
  deleteUserAccount: (id: number) => Promise<void>
  changeUserPassword: (username: string, newPassword: string) => Promise<void>
  getSettings: () => Promise<Settings>
  setSetting: (
    key: 'theme' | 'soundEnabled' | 'savedWifiSsid' | 'savedWifiPassword' | 'cloudSyncUrl',
    value: string | boolean
  ) => Promise<void>
  getSyncStatus: () => Promise<CloudSyncStatus>
  syncCloudReadings: () => Promise<CloudSyncStatus>
  onSyncStatus: (callback: (status: CloudSyncStatus) => void) => () => void
  getNodePondType: (nodeId: string) => Promise<string | null>
  getNodeCustomProfile: (nodeId: string) => Promise<any>
  setNodePondType: (nodeId: string, pondType: string) => Promise<NodeRow>
  setNodeCustomProfile: (nodeId: string, profile: any) => Promise<NodeRow>
  deleteNodeReadings: (nodeId: string) => Promise<number>
  deleteNode: (nodeId: string) => Promise<number>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AquaLoraApi
  }
}
