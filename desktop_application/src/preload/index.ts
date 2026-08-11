import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Reading } from '../shared/types'

// Custom APIs for renderer
const api = {
  onReading: (callback: (reading: Reading) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, reading: Reading): void =>
      callback(reading)
    ipcRenderer.on('reading:new', listener)
    return () => ipcRenderer.removeListener('reading:new', listener)
  },
  getRecentReadings: (nodeId: string, limit?: number): Promise<unknown[]> =>
    ipcRenderer.invoke('readings:getRecent', nodeId, limit)
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
