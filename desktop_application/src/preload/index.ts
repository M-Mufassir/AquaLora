import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
  NodeListMessage,
  CloudSyncStatus
} from '../shared/types'

interface CsvExportResult {
  canceled: boolean
  filePath?: string
  count?: number
}

// Custom APIs for renderer
const api = {
  onReading: (callback: (reading: Reading) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reading: Reading): void =>
      callback(reading)
    ipcRenderer.on('reading:new', listener)
    return () => ipcRenderer.removeListener('reading:new', listener)
  },
  getRecentReadings: (nodeId: string, limit?: number): Promise<StoredReading[]> =>
    ipcRenderer.invoke('readings:getRecent', nodeId, limit),
  getReadingsInRange: (
    nodeId: string,
    startIso: string,
    endIso: string
  ): Promise<StoredReading[]> => ipcRenderer.invoke('readings:getRange', nodeId, startIso, endIso),
  exportReadingsCsv: (nodeId: string, startIso: string, endIso: string): Promise<CsvExportResult> =>
    ipcRenderer.invoke('readings:exportCsv', nodeId, startIso, endIso),
  onScore: (callback: (score: Score) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, score: Score): void => callback(score)
    ipcRenderer.on('score:new', listener)
    return () => ipcRenderer.removeListener('score:new', listener)
  },
  onAlert: (callback: (alert: Alert) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, alert: Alert): void => callback(alert)
    ipcRenderer.on('alert:new', listener)
    return () => ipcRenderer.removeListener('alert:new', listener)
  },
  getRecentAlerts: (nodeId: string, limit?: number): Promise<Alert[]> =>
    ipcRenderer.invoke('alerts:getRecent', nodeId, limit),
  getAllRecentAlerts: (limit?: number): Promise<Alert[]> =>
    ipcRenderer.invoke('alerts:getAllRecent', limit),
  acknowledgeAlert: (id: number): Promise<void> => ipcRenderer.invoke('alerts:acknowledge', id),
  setSamplingInterval: (minutes: number): Promise<void> =>
    ipcRenderer.invoke('command:setInterval', minutes),
  login: (username: string, password: string): Promise<{ username: string; role: string } | null> =>
    ipcRenderer.invoke('auth:login', username, password),
  onConnectionStatus: (callback: (status: 'connected' | 'reconnecting') => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: 'connected' | 'reconnecting'
    ): void => callback(status)
    ipcRenderer.on('connection:status', listener)
    return () => ipcRenderer.removeListener('connection:status', listener)
  },
  onNodeStatus: (
    callback: (update: { node_id: string; online: boolean }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: { node_id: string; online: boolean }
    ): void => callback(update)
    ipcRenderer.on('node:status', listener)
    return () => ipcRenderer.removeListener('node:status', listener)
  },
  onNodeUpdated: (callback: (node: NodeRow) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, node: NodeRow): void => callback(node)
    ipcRenderer.on('node:updated', listener)
    return () => ipcRenderer.removeListener('node:updated', listener)
  },
  getAllNodes: (): Promise<NodeRow[]> => ipcRenderer.invoke('nodes:getAll'),
  getThresholdProfiles: (): Promise<any[]> => ipcRenderer.invoke('thresholds:list'),
  saveThresholdProfile: (name: string, profile: any): Promise<any> =>
    ipcRenderer.invoke('thresholds:save', name, profile),
  deleteThresholdProfile: (id: number): Promise<number> =>
    ipcRenderer.invoke('thresholds:delete', id),
  upsertNode: (id: string, name: string, location: string): Promise<NodeRow> =>
    ipcRenderer.invoke('nodes:upsert', id, name, location),
  scanWifi: (): Promise<WifiNetwork[]> => ipcRenderer.invoke('wifi:scan'),
  connectWifi: (ssid: string, password: string): Promise<void> =>
    ipcRenderer.invoke('wifi:connect', ssid, password),
  getWifiStatus: (): Promise<WifiConnectionState> => ipcRenderer.invoke('wifi:status'),
  openWifiSettings: (): Promise<void> => ipcRenderer.invoke('wifi:openSettings'),
  connectMasterNode: (url: string, password?: string): Promise<void> =>
    ipcRenderer.invoke('master:connect', url, password),
  onNodesDiscovered: (callback: (nodes: NodeListMessage['nodes']) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nodes: NodeListMessage['nodes']): void =>
      callback(nodes)
    ipcRenderer.on('nodes:discovered', listener)
    return () => ipcRenderer.removeListener('nodes:discovered', listener)
  },
  listUsers: (): Promise<UserRow[]> => ipcRenderer.invoke('users:list'),
  createUserAccount: (username: string, password: string, role: string): Promise<void> =>
    ipcRenderer.invoke('users:create', username, password, role),
  deleteUserAccount: (id: number): Promise<void> => ipcRenderer.invoke('users:delete', id),
  changeUserPassword: (username: string, newPassword: string): Promise<void> =>
    ipcRenderer.invoke('users:changePassword', username, newPassword),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSetting: (
    key: 'theme' | 'soundEnabled' | 'savedWifiSsid' | 'savedWifiPassword' | 'cloudSyncUrl' | 'masterNodeUrl',
    value: string | boolean
  ): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
  getSyncStatus: (): Promise<CloudSyncStatus> => ipcRenderer.invoke('cloud:sync-status'),
  syncCloudReadings: (): Promise<CloudSyncStatus> => ipcRenderer.invoke('cloud:sync'),
  onSyncStatus: (callback: (status: CloudSyncStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: CloudSyncStatus): void =>
      callback(status)
    ipcRenderer.on('cloud:sync-status', listener)
    return () => ipcRenderer.removeListener('cloud:sync-status', listener)
  },
  getNodePondType: (nodeId: string): Promise<string | null> =>
    ipcRenderer.invoke('nodes:getPondType', nodeId),
  getNodeCustomProfile: (nodeId: string): Promise<any> => ipcRenderer.invoke('nodes:getCustomProfile', nodeId),
  setNodePondType: (nodeId: string, pondType: string): Promise<NodeRow> =>
    ipcRenderer.invoke('nodes:setPondType', nodeId, pondType),
  setNodeCustomProfile: (nodeId: string, profile: any): Promise<NodeRow> =>
    ipcRenderer.invoke('nodes:setCustomProfile', nodeId, profile),
  deleteNodeReadings: (nodeId: string): Promise<number> =>
    ipcRenderer.invoke('nodes:deleteReadings', nodeId),
  deleteNode: (nodeId: string): Promise<number> => ipcRenderer.invoke('nodes:delete', nodeId),
  cloudLogin: (nodeCode: string, password: string): Promise<any> =>
    ipcRenderer.invoke('cloud:login', nodeCode, password),
  cloudLogout: (): Promise<boolean> => ipcRenderer.invoke('cloud:logout'),
  getCloudSession: (): Promise<any> => ipcRenderer.invoke('cloud:getSession'),
  validateCloudSession: (): Promise<boolean> => ipcRenderer.invoke('cloud:validateSession'),
  getCloudDirectory: (): Promise<Array<{ node_code: string; display_name: string }>> =>
    ipcRenderer.invoke('cloud:getDirectory'),
  getCloudProfile: (): Promise<any> => ipcRenderer.invoke('cloud:getProfile'),
  updateCloudProfile: (payload: any): Promise<any> =>
    ipcRenderer.invoke('cloud:updateProfile', payload),
  changeCloudPassword: (currentPassword: string, newPassword: string): Promise<any> =>
    ipcRenderer.invoke('cloud:changePassword', currentPassword, newPassword),
  syncNodesCloud: (): Promise<{ received: number; stored: number }> =>
    ipcRenderer.invoke('nodes:syncCloud'),
  fetchNodesCloud: (): Promise<any[]> =>
    ipcRenderer.invoke('nodes:fetchCloud')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
