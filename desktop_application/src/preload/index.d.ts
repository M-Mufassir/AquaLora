import { ElectronAPI } from '@electron-toolkit/preload'
import type { Reading } from '../shared/types'

interface AquaLoraApi {
  onReading: (callback: (reading: Reading) => void) => () => void
  getRecentReadings: (nodeId: string, limit?: number) => Promise<unknown[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AquaLoraApi
  }
}
