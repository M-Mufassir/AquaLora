import { safeStorage } from 'electron'
import { getSettingOptional, setSetting, deleteSetting } from './db'
import { DEFAULT_CLOUD_API_URL } from './config'

export interface CloudSessionData {
  token: string
  masterNodeId: number
  nodeCode: string
  displayName: string
  role: string
  savedAt: string
}

const SETTING_KEY = 'cloud_session'
const NODE_CODE_KEY = 'master_node_code'

export function saveCloudSession(session: CloudSessionData): void {
  const jsonStr = JSON.stringify(session)
  let storedValue: string

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(jsonStr)
    storedValue = `enc:${encrypted.toString('base64')}`
  } else {
    // Fallback if OS keychain is unavailable (e.g., headless Linux / early bootstrap)
    storedValue = `plain:${Buffer.from(jsonStr, 'utf8').toString('base64')}`
  }

  setSetting(SETTING_KEY, storedValue)
  setSetting(NODE_CODE_KEY, session.nodeCode)
}

export function loadCloudSession(): CloudSessionData | null {
  const raw = getSettingOptional(SETTING_KEY)
  if (!raw) return null

  try {
    let jsonStr: string
    if (raw.startsWith('enc:')) {
      const buffer = Buffer.from(raw.slice(4), 'base64')
      jsonStr = safeStorage.decryptString(buffer)
    } else if (raw.startsWith('plain:')) {
      jsonStr = Buffer.from(raw.slice(6), 'base64').toString('utf8')
    } else {
      // Legacy or un-prefixed fallback
      jsonStr = raw
    }

    const data = JSON.parse(jsonStr) as CloudSessionData
    if (!data.token || !data.nodeCode) return null
    return data
  } catch (err) {
    console.warn('[cloudSession] Failed to decrypt or parse cloud session:', err)
    return null
  }
}

export function clearCloudSession(): void {
  deleteSetting(SETTING_KEY)
  deleteSetting(NODE_CODE_KEY)
}

export function resolveCloudUrl(path: string, customBaseUrl?: string): string {
  let base = (customBaseUrl || getSettingOptional('cloud_sync_url') || '').trim()
  if (!base) {
    base = DEFAULT_CLOUD_API_URL
  }
  base = base.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${base}/${cleanPath}`
}

export async function validateCloudSession(baseUrl?: string, token?: string): Promise<boolean> {
  if (!token) return false
  try {
    const url = resolveCloudUrl('/master-nodes/me', baseUrl)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
    return response.ok
  } catch (err) {
    console.warn('[cloudSession] Background validation check error:', err)
    return false
  }
}
