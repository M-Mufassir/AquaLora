import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  initDb,
  insertReading,
  upsertNodeFromReading,
  getRecentReadings,
  getLatestReadingsForAllNodes,
  batchInsertHistoricalReadings,
  getReadingsInRange,
  readingsToCsv,
  insertAlert,
  getRecentAlerts,
  getAllRecentAlerts,
  acknowledgeAlert,
  markStaleNodesOffline,
  userCount,
  createUser,
  upsertUser,
  verifyUser,
  listUsers,
  deleteUser,
  changePassword,
  getAllNodes,
  getThresholdProfiles,
  saveThresholdProfile,
  deleteThresholdProfile,
  upsertNode,
  upsertNodeStub,
  getSetting,
  getSettingOptional,
  setSetting,
  setNodePondType,
  getNodePondType,
  getNodeCustomProfile,
  setNodeCustomProfile,
  deleteNodeReadings,
  deleteNode,
  getPendingOutboxEntries,
  getPendingAlertOutboxEntries,
  getCloudSyncStatus,
  markOutboxSynced,
  markOutboxFailed,
  markAlertOutboxSynced,
  markAlertOutboxFailed,
  resetLocalNodeData
} from './db'
import {
  saveCloudSession,
  loadCloudSession,
  clearCloudSession,
  validateCloudSession,
  resolveCloudUrl,
  type CloudSessionData
} from './cloudSession'
import { MasterNodeClient } from './masterNodeClient'
import { DecisionEngine } from './decisionEngine'
import { scanNetworks, connectToNetwork, getCurrentConnection } from './wifiManager'
import { startUdpDiscovery, stopUdpDiscovery, getDiscoveredDevices } from './udpDiscovery'
import { deriveKeyFromPassword } from './secureChannel'
import type { Score } from '../shared/types'

const OFFLINE_CHECK_INTERVAL_MS = 30_000
const OFFLINE_THRESHOLD_MS = 5 * 60_000
const CLOUD_SYNC_INTERVAL_MS = 2 * 60_000
const NETWORK_CHECK_TIMEOUT_MS = 5_000

let mainWindow: BrowserWindow
const masterNodeClient = new MasterNodeClient()
const decisionEngine = new DecisionEngine()

async function fetchPastTelemetryFromCloud(nodeCode: string, token: string, cloudUrl: string): Promise<void> {
  if (!token || token.startsWith('local-session-')) return
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const [historyResponse, nodesResponse] = await Promise.all([
      fetch(resolveCloudUrl('/readings/history?limit=200', cloudUrl), { headers }),
      fetch(resolveCloudUrl('/nodes', cloudUrl), { headers })
    ])
    if (nodesResponse.ok) {
      const payload = (await nodesResponse.json()) as any
      const cloudNodes = Array.isArray(payload) ? payload : payload.nodes ?? payload.data ?? []
      for (const cloudNode of cloudNodes) {
        const id = cloudNode.node_id ?? cloudNode.id
        if (!id) continue
        const localNode = upsertNodeStub(String(id))
        if (cloudNode.name || cloudNode.display_name || cloudNode.location) {
          upsertNode(String(id), cloudNode.name ?? cloudNode.display_name ?? localNode.name ?? String(id), cloudNode.location ?? localNode.location ?? '')
        }
        if (cloudNode.pond_type) setNodePondType(String(id), cloudNode.pond_type)
        if (cloudNode.custom_profile) setNodeCustomProfile(String(id), cloudNode.custom_profile)
        mainWindow?.webContents.send('node:updated', getAllNodes().find((n) => n.id === String(id)) ?? localNode)
      }
    }
    if (historyResponse.ok) {
      const payload = (await historyResponse.json()) as any
      const rows = Array.isArray(payload) ? payload : payload.readings ?? payload.data ?? []
      const readings = rows.map((row: any) => ({ ...row, node_id: row.node_id ?? row.nodeId, timestamp: row.timestamp ?? row.created_at }))
        .filter((row: any) => row.node_id && row.timestamp && row.temperature != null)
        .filter((row: any) => !row.master_node_code || row.master_node_code === nodeCode)
      batchInsertHistoricalReadings(readings)
      for (const reading of readings) mainWindow?.webContents.send('reading:new', reading)
    }
  } catch (error: any) {
    console.warn('[cloud] historical telemetry fetch skipped:', error.message)
  }
}

async function getCloudAuthToken(): Promise<string | null> {
  const session = loadCloudSession()
  return session?.token ?? null
}

/**
 * Check if internet is available via DNS lookup.
 * Attempts to resolve google-dns-a.google.com (IP 8.8.8.8).
 * Returns true if resolvable within timeout, false otherwise.
 */
async function checkInternetConnectivity(): Promise<boolean> {
  try {
    // Use DNS lookup as a lightweight internet check
    const { promises: dnsPromises } = await import('dns')
    const lookupPromise = dnsPromises.resolve4('google-dns-a.google.com')
    const timeoutPromise = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('DNS timeout')), NETWORK_CHECK_TIMEOUT_MS)
    )
    await Promise.race([lookupPromise, timeoutPromise])
    return true
  } catch (err) {
    console.debug('[main] Internet check failed (assumed offline):', err instanceof Error ? err.message : String(err))
    return false
  }
}

async function syncQueuedReadings(isManual = false): Promise<void> {
  const baseUrl = getSettingOptional('cloud_sync_url')?.trim()
  if (!baseUrl) {
    return
  }

  const pendingEntries = getPendingOutboxEntries(100)
  const pendingAlerts = getPendingAlertOutboxEntries(100)
  
  if (pendingEntries.length === 0 && pendingAlerts.length === 0) {
    const status = getCloudSyncStatus()
    mainWindow?.webContents.send('cloud:sync-status', status)
    return
  }

  // Check internet connectivity only for automatic syncs (not manual)
  if (!isManual) {
    const hasInternet = await checkInternetConnectivity()
    if (!hasInternet) {
      console.debug('[main] Skipping automatic cloud sync: no internet connectivity')
      const status = getCloudSyncStatus()
      mainWindow?.webContents.send('cloud:sync-status', status)
      return
    }
  }

  const accessToken = await getCloudAuthToken()
  if (!accessToken) {
    throw new Error('Not authenticated to cloud backend. Please activate Master Node cloud session.')
  }


  try {
    // Sync readings
    if (pendingEntries.length > 0) {
      const syncUrl = resolveCloudUrl('/readings/sync', baseUrl)
      const readings = pendingEntries.map((entry) => JSON.parse(entry.payload_json))

      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ readings })
      })

      if (!response.ok) {
        throw new Error(`Readings sync failed: HTTP ${response.status}: ${response.statusText}`)
      }

      markOutboxSynced(pendingEntries.map((entry) => entry.id))
    }

    // Sync alerts
    if (pendingAlerts.length > 0) {
      const alertSyncUrl = resolveCloudUrl('/alerts/sync', baseUrl)
      const alerts = pendingAlerts.map((entry) => JSON.parse(entry.payload_json))

      const response = await fetch(alertSyncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ alerts })
      })

      if (!response.ok) {
        throw new Error(`Alerts sync failed: HTTP ${response.status}: ${response.statusText}`)
      }

      markAlertOutboxSynced(pendingAlerts.map((entry) => entry.id))
    }

    mainWindow?.webContents.send('cloud:sync-status', getCloudSyncStatus())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown cloud sync error'
    for (const entry of pendingEntries) {
      markOutboxFailed(entry.id, message)
    }
    for (const entry of pendingAlerts) {
      markAlertOutboxFailed(entry.id, message)
    }
    mainWindow?.webContents.send('cloud:sync-status', getCloudSyncStatus())
  }
}

function createWindow(): void {
  // Create the browser window. Starts maximized — this is a monitoring
  // dashboard meant to fill the screen, not a small utility window.
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  initDb()

  if (userCount() === 0) {
    createUser('Operator', 'Operator123', 'operator')
    console.log('[auth] default operator account created: username=Operator password=Operator123')
  }

  ipcMain.handle('auth:login', (_event, username: string, password: string) => {
    const user = verifyUser(username, password)
    return user?.role === 'admin' ? null : user
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only HTTPS links can be opened.')
    await shell.openExternal(url)
  })

  ipcMain.handle(
    'auth:setupMasterNodeSession',
    async (
      _event,
      payload: {
        nodeCode: string
        displayName?: string
        password?: string
        wsUrl: string
        cloudUrl?: string
      }
    ) => {
      const nodeCode = payload.nodeCode.trim()
      const displayName = payload.displayName?.trim() || nodeCode
      const password = payload.password?.trim() || ''
      const wsUrl = payload.wsUrl.trim()
      const cloudUrl =
        payload.cloudUrl?.trim() ||
        getSettingOptional('cloud_sync_url')?.trim() ||
        'https://aqualora.up.railway.app/api'

      // 1. Detect if this is a new (different) Master Node — if so, reset local telemetry data
      const previousNodeCode = getSettingOptional('master_node_code')
      const isNewNode = !!previousNodeCode && previousNodeCode !== nodeCode

      // 2. Save settings
      setSetting('master_node_code', nodeCode)
      setSetting('master_node_url', wsUrl)
      if (payload.cloudUrl?.trim()) {
        setSetting('cloud_sync_url', payload.cloudUrl.trim())
      }

      // 3. Derive key and connect WebSocket
      if (password) {
        const key = deriveKeyFromPassword(password)
        setSetting('master_node_key_hex', key.toString('hex'))
        masterNodeClient.connect(wsUrl, key)
      } else {
        setSetting('master_node_key_hex', '')
        masterNodeClient.connect(wsUrl)
      }

      // 4. Upsert user in local SQLite database (using new node code as username)
      upsertUser(nodeCode, password || 'aqualora123', 'operator')

      // 5. Cloud Registration & Authentication
      let session: CloudSessionData | null = null
      let cloudSynced = false
      let cloudMessage = ''
      let registeredAsNew = false

      try {
        const loginUrl = resolveCloudUrl('/auth/login', cloudUrl)

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)

        try {
          // 5a. Try to login as existing node first
          const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              node_code: nodeCode,
              password: password || 'aqualora123',
              client: 'desktop'
            }),
            signal: controller.signal
          })

          if (loginRes.ok) {
            const data = (await loginRes.json()) as any
            session = {
              token: data.access_token || data.token || '',
              masterNodeId: data.master_node_id || 1,
              nodeCode: data.node_code || nodeCode,
              displayName: data.display_name || displayName,
              role: data.role || 'customer',
              savedAt: new Date().toISOString()
            }
            cloudSynced = true
            cloudMessage = isNewNode
              ? 'New node registered — local database reset. Authenticated with cloud.'
              : 'Authenticated with cloud backend.'
          } else if (loginRes.status === 401 || loginRes.status === 404) {
            // 5b. Node not in cloud yet — auto-register using admin token
            console.log('[auth:setupMasterNodeSession] Node not found in cloud — attempting auto-registration.')
            try {
              const adminRes = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'Admin', password: 'Admin123', client: 'web' }),
                signal: controller.signal
              })

              if (adminRes.ok) {
                const adminData = (await adminRes.json()) as any
                const adminToken = adminData.access_token || adminData.token

                // Register new master node in cloud
                const regUrl = resolveCloudUrl('/master-nodes', cloudUrl)
                const regRes = await fetch(regUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`
                  },
                  body: JSON.stringify({
                    node_code: nodeCode.toUpperCase(),
                    display_name: displayName,
                    password: password || 'aqualora123',
                    role: 'customer'
                  }),
                  signal: controller.signal
                })

                if (regRes.ok || regRes.status === 409) {
                  registeredAsNew = regRes.ok
                  // Login as the newly registered node
                  const retryLoginRes = await fetch(loginUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      node_code: nodeCode,
                      password: password || 'aqualora123',
                      client: 'desktop'
                    }),
                    signal: controller.signal
                  })
                  if (retryLoginRes.ok) {
                    const nodeData = (await retryLoginRes.json()) as any
                    session = {
                      token: nodeData.access_token || nodeData.token || '',
                      masterNodeId: nodeData.master_node_id || 1,
                      nodeCode: nodeData.node_code || nodeCode,
                      displayName: nodeData.display_name || displayName,
                      role: nodeData.role || 'customer',
                      savedAt: new Date().toISOString()
                    }
                    cloudSynced = true
                    cloudMessage = registeredAsNew
                      ? 'New master node registered in cloud and authenticated successfully.'
                      : 'Authenticated with cloud backend (node already existed).'
                  } else {
                    console.warn('[auth:setupMasterNodeSession] Login after registration failed:', retryLoginRes.status)
                  }
                } else {
                  const regErr = await regRes.json().catch(() => ({}))
                  console.warn('[auth:setupMasterNodeSession] Cloud registration rejected:', regRes.status, regErr)
                }
              } else {
                console.warn('[auth:setupMasterNodeSession] Admin login failed — cannot auto-register node.')
              }
            } catch (regErr: any) {
              console.warn(
                '[auth:setupMasterNodeSession] Cloud auto-provisioning attempt failed:',
                regErr.message
              )
            }
          } else {
            console.warn('[auth:setupMasterNodeSession] Unexpected login response:', loginRes.status)
          }
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (cloudErr: any) {
        console.warn('[auth:setupMasterNodeSession] Cloud unreachable:', cloudErr.message)
      }

      // 6. If cloud didn't produce a session (offline / unreachable), use local-first offline session
      if (!session) {
        session = {
          token: `local-session-${Date.now()}`,
          masterNodeId: 1,
          nodeCode: nodeCode,
          displayName: displayName,
          role: 'operator',
          savedAt: new Date().toISOString()
        }
        cloudSynced = false
        cloudMessage = isNewNode
          ? 'New node registered locally. Cloud unreachable — will sync when connected.'
          : 'Cloud unreachable (offline mode). Telemetry stored locally and will sync when connected.'
      }

      saveCloudSession(session)
      void fetchPastTelemetryFromCloud(nodeCode, session.token, cloudUrl)
      return {
        session,
        user: { username: session.nodeCode, role: session.role === 'super_admin' ? 'operator' : (session.role || 'operator') },
        cloudSynced,
        isNewNode,
        message: cloudMessage
      }
    }
  )

  // Explicit DB reset IPC (called from renderer when user confirms swapping to a new node)
  ipcMain.handle('db:resetLocalNodeData', () => {
    const result = resetLocalNodeData()
    console.log('[main] Manual local node data reset:', result)
    return result
  })

  ipcMain.handle('readings:getRecent', (_event, nodeId: string, limit?: number) =>
    getRecentReadings(nodeId, limit)
  )
  ipcMain.handle('readings:getLatestByNode', () => getLatestReadingsForAllNodes())

  ipcMain.handle('readings:getRange', (_event, nodeId: string, startIso: string, endIso: string) =>
    getReadingsInRange(nodeId, startIso, endIso)
  )

  ipcMain.handle(
    'readings:exportCsv',
    async (_event, nodeId: string, startIso: string, endIso: string) => {
      const readings = getReadingsInRange(nodeId, startIso, endIso)
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export readings as CSV',
        defaultPath: `aqualora-${nodeId}-${Date.now()}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) {
        return { canceled: true as const }
      }
      writeFileSync(result.filePath, readingsToCsv(readings), 'utf-8')
      return { canceled: false as const, filePath: result.filePath, count: readings.length }
    }
  )

  ipcMain.handle('alerts:getRecent', (_event, nodeId: string, limit?: number) =>
    getRecentAlerts(nodeId, limit)
  )

  ipcMain.handle('alerts:getAllRecent', (_event, limit?: number) => getAllRecentAlerts(limit))

  ipcMain.handle('alerts:acknowledge', (_event, id: number) => acknowledgeAlert(id))

  ipcMain.handle('command:setInterval', (_event, minutes: number) => {
    masterNodeClient.sendCommand({ type: 'set_interval', minutes })
  })

  ipcMain.handle('nodes:getAll', () => getAllNodes())
  ipcMain.handle('nodes:upsert', (_event, id: string, name: string, location: string) =>
    upsertNode(id, name, location)
  )
  ipcMain.handle('thresholds:list', () => getThresholdProfiles())
  ipcMain.handle('thresholds:save', (_event, name: string, profile: any) =>
    saveThresholdProfile(name, profile)
  )
  ipcMain.handle('thresholds:delete', (_event, id: number) => deleteThresholdProfile(id))

  ipcMain.handle('wifi:scan', () => scanNetworks())
  ipcMain.handle('wifi:connect', (_event, ssid: string, password: string) =>
    connectToNetwork(ssid, password)
  )
  ipcMain.handle('wifi:status', () => getCurrentConnection())
  ipcMain.handle('wifi:openSettings', () => {
    // netsh-based joins can fail under restrictive Windows policies — this
    // lets the wizard fall back to "join it yourself, then continue".
    shell.openExternal('ms-settings:network-wifi')
  })
  ipcMain.handle('discovery:start', () => {
    startUdpDiscovery((device) => {
      mainWindow?.webContents.send('discovery:device-found', device)
    })
    for (const device of getDiscoveredDevices()) {
      mainWindow?.webContents.send('discovery:device-found', device)
    }
  })
  ipcMain.handle('discovery:stop', () => {
    stopUdpDiscovery()
  })
  ipcMain.handle('master:connect', (_event, url: string, password?: string) => {
    setSetting('master_node_url', url)
    // No password means the dev-only "use local mock" path, or an
    // intentionally open MCU AP — both stay plain. A real password derives
    // an AES-256-GCM key (see secureChannel.ts) that's persisted so a
    // restart can reconnect encrypted without repeating the wizard.
    if (password) {
      const key = deriveKeyFromPassword(password)
      setSetting('master_node_key_hex', key.toString('hex'))
      masterNodeClient.connect(url, key)
    } else {
      setSetting('master_node_key_hex', '')
      masterNodeClient.connect(url)
    }
  })

  ipcMain.handle('users:list', () => listUsers())
  ipcMain.handle('users:create', (_event, username: string, password: string, role: string) =>
    createUser(username, password, role)
  )
  ipcMain.handle('users:delete', (_event, id: number) => deleteUser(id))
  ipcMain.handle('users:changePassword', (_event, username: string, newPassword: string) =>
    changePassword(username, newPassword)
  )

  ipcMain.handle('settings:get', () => ({
    theme: getSetting('theme', 'dark'),
    soundEnabled: getSetting('sound_enabled', '1') === '1',
    savedWifiSsid: getSettingOptional('wifi_ssid'),
    savedWifiPassword: getSettingOptional('wifi_password'),
    cloudSyncUrl: getSettingOptional('cloud_sync_url'),
    masterNodeUrl: getSettingOptional('master_node_url')
  }))
  ipcMain.handle(
    'settings:set',
    (
      _event,
      key: 'theme' | 'soundEnabled' | 'savedWifiSsid' | 'savedWifiPassword' | 'cloudSyncUrl' | 'masterNodeUrl',
      value: string | boolean
    ) => {
      if (key === 'theme') setSetting('theme', String(value))
      if (key === 'soundEnabled') setSetting('sound_enabled', value ? '1' : '0')
      if (key === 'savedWifiSsid') setSetting('wifi_ssid', String(value))
      if (key === 'savedWifiPassword') setSetting('wifi_password', String(value))
      if (key === 'cloudSyncUrl') {
        const next = String(value).trim()
        if (next) setSetting('cloud_sync_url', next)
        else setSetting('cloud_sync_url', '')
      }
      if (key === 'masterNodeUrl') setSetting('master_node_url', String(value))
      mainWindow?.webContents.send('cloud:sync-status', getCloudSyncStatus())
    }
  )

  ipcMain.handle('cloud:sync-status', () => getCloudSyncStatus())
  ipcMain.handle('cloud:sync', async () => {
    // Manual sync always attempts regardless of network (user can see the error)
    await syncQueuedReadings(true)
    return getCloudSyncStatus()
  })

  ipcMain.handle('cloud:login', async (_event, nodeCode: string, password: string) => {
    const loginUrl = resolveCloudUrl('/auth/login')
    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_code: nodeCode, password, client: 'desktop' })
    })

    if (!response.ok) {
      const errData = (await response.json().catch(() => ({}))) as { detail?: string }
      throw new Error(errData.detail || `Login failed (HTTP ${response.status})`)
    }

    const data = (await response.json()) as {
      access_token?: string
      token?: string
      master_node_id: number
      node_code: string
      display_name: string
      role: string
    }

    const session: CloudSessionData = {
      token: data.access_token || data.token || '',
      masterNodeId: data.master_node_id,
      nodeCode: data.node_code,
      displayName: data.display_name,
      role: data.role,
      savedAt: new Date().toISOString()
    }

    if (!session.token) {
      throw new Error('Authentication failed: No access token received from server.')
    }
    if (session.role === 'super_admin') {
      throw new Error('Administrators must use the AquaLoRa web console.')
    }

    saveCloudSession(session)
    return session
  })

  ipcMain.handle('cloud:activateLocal', (_event, nodeCode?: string) => {
    const code = nodeCode?.trim() || 'master-node'
    const session: CloudSessionData = {
      token: 'local-offline-token',
      masterNodeId: 1,
      nodeCode: code,
      displayName: code,
      role: 'operator',
      savedAt: new Date().toISOString()
    }
    saveCloudSession(session)
    return session
  })

  ipcMain.handle('cloud:logout', () => {
    clearCloudSession()
    return true
  })

  ipcMain.handle('cloud:getSession', () => loadCloudSession())

  ipcMain.handle('cloud:validateSession', async () => {
    const session = loadCloudSession()
    if (!session) return false
    return await validateCloudSession(undefined, session.token)
  })

  ipcMain.handle('cloud:getDirectory', async () => {
    try {
      const dirUrl = resolveCloudUrl('/master-nodes/directory')
      const response = await fetch(dirUrl)
      if (!response.ok) {
        return []
      }
      const text = await response.text()
      try {
        return JSON.parse(text)
      } catch {
        return []
      }
    } catch (err: any) {
      console.debug('[cloud:getDirectory] Directory fetch skipped:', err.message)
      return []
    }
  })

  ipcMain.handle('cloud:getProfile', async () => {
    const session = loadCloudSession()
    if (!session) throw new Error('Not authenticated to cloud backend')
    const profileUrl = resolveCloudUrl('/master-nodes/me')
    const response = await fetch(profileUrl, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch profile: HTTP ${response.status}`)
    }
    return await response.json()
  })

  ipcMain.handle('cloud:updateProfile', async (_event, payload: any) => {
    const session = loadCloudSession()
    if (!session) throw new Error('Not authenticated to cloud backend')
    const profileUrl = resolveCloudUrl('/master-nodes/me')
    const response = await fetch(profileUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { detail?: string }
      throw new Error(err.detail || `Failed to update profile: HTTP ${response.status}`)
    }
    const updated = (await response.json()) as { display_name?: string }
    if (updated.display_name) {
      saveCloudSession({ ...session, displayName: updated.display_name })
    }
    return updated
  })

  ipcMain.handle('cloud:changePassword', async (_event, currentPassword: string, newPassword: string) => {
    const session = loadCloudSession()
    if (!session) throw new Error('Not authenticated to cloud backend')
    const pwdUrl = resolveCloudUrl('/auth/change-password')
    const response = await fetch(pwdUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    })
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { detail?: string }
      throw new Error(err.detail || `Password change failed: HTTP ${response.status}`)
    }
    return await response.json()
  })


  ipcMain.handle('nodes:setPondType', (_event, nodeId: string, pondType: string) =>
    setNodePondType(nodeId, pondType)
  )
  ipcMain.handle('nodes:getPondType', (_event, nodeId: string) => getNodePondType(nodeId))
  ipcMain.handle('nodes:getCustomProfile', (_event, nodeId: string) => getNodeCustomProfile(nodeId))
  ipcMain.handle('nodes:setCustomProfile', (_event, nodeId: string, profile: any) =>
    setNodeCustomProfile(nodeId, profile)
  )
  ipcMain.handle('nodes:deleteReadings', (_event, nodeId: string) => deleteNodeReadings(nodeId))
  ipcMain.handle('nodes:delete', (_event, nodeId: string) => deleteNode(nodeId))

  ipcMain.handle('nodes:syncCloud', async () => {
    const session = loadCloudSession()
    if (!session) throw new Error('Not authenticated to cloud backend')
    const syncUrl = resolveCloudUrl('/nodes/sync')
    const allNodes = getAllNodes()
    const payload = allNodes.map((n: any) => ({
      node_id: n.id,
      name: n.name ?? null,
      location: n.location ?? null,
      pond_type: getNodePondType(n.id) ?? 'tilapia',
      custom_profile: getNodeCustomProfile(n.id) ?? null
    }))
    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({ nodes: payload })
    })
    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { detail?: string }
      throw new Error(err.detail || `Failed to sync nodes: HTTP ${response.status}`)
    }
    return await response.json()
  })

  ipcMain.handle('nodes:fetchCloud', async () => {
    const session = loadCloudSession()
    if (!session) throw new Error('Not authenticated to cloud backend')
    const nodesUrl = resolveCloudUrl('/nodes')
    const response = await fetch(nodesUrl, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch nodes from cloud: HTTP ${response.status}`)
    }
    const cloudNodes = (await response.json()) as Array<{
      node_id: string
      name: string | null
      location: string | null
      pond_type: string
      custom_profile: any
    }>
    for (const cn of cloudNodes) {
      upsertNodeStub(cn.node_id)
      if (cn.pond_type) setNodePondType(cn.node_id, cn.pond_type)
      if (cn.custom_profile) setNodeCustomProfile(cn.node_id, cn.custom_profile)
    }
    return cloudNodes
  })

  decisionEngine.start()

  masterNodeClient.onStatusChange((status) => {
    mainWindow?.webContents.send('connection:status', status)
  })

  masterNodeClient.onNodeList((nodes) => {
    console.log('[main] node list received:', nodes)
    for (const { node_id } of nodes) {
      try {
        const node = upsertNodeStub(node_id)
        mainWindow?.webContents.send('node:updated', node)
      } catch (err) {
        console.error('[main] failed to persist discovered node:', err)
      }
    }
    mainWindow?.webContents.send('nodes:discovered', nodes)
  })

  masterNodeClient.onReading((reading) => {
    console.log('[main] reading received:', reading)
    try {
      const node = upsertNodeFromReading(reading)
      insertReading(reading)
      mainWindow?.webContents.send('node:updated', node)
    } catch (err) {
      console.error('[main] failed to persist reading:', err)
    }
    mainWindow?.webContents.send('reading:new', reading)

    decisionEngine.scoreReading(reading).then((result) => {
      if (!result) return

      const score: Score = {
        node_id: reading.node_id,
        timestamp: reading.timestamp,
        score: result.score,
        status: result.status,
        parameter: result.parameter,
        recommendation: result.recommendation
      }
      mainWindow?.webContents.send('score:new', score)

      if (result.status !== 'Normal' && result.parameter) {
        try {
          const alert = insertAlert({
            node_id: reading.node_id,
            timestamp: reading.timestamp,
            parameter: result.parameter,
            severity: result.status,
            message: result.recommendation ?? `${result.status}: Fish Health Index ${result.score}`
          })
          mainWindow?.webContents.send('alert:new', alert)
        } catch (err) {
          console.error('[main] failed to persist alert:', err)
        }
      }
    })
  })
  // Start background UDP discovery immediately so local ESP32 Master Nodes are detected on boot
  startUdpDiscovery((device) => {
    console.log(`[udpDiscovery] Discovered Master Node: ${device.id} at ${device.ip}:${device.port}`)
    mainWindow?.webContents.send('discovery:device-found', device)
  })

  // Only auto-connect if the user has actually paired with a Master Node
  // before (via the Connect Device wizard) — otherwise a fresh install, or
  // one that's never been paired, would silently dial the dev mock (if one
  // happens to be running) and populate nodes the user never asked to see.
  const pairedMasterNodeUrl = getSettingOptional('master_node_url')
  if (pairedMasterNodeUrl) {
    const pairedKeyHex = getSettingOptional('master_node_key_hex')
    const useKey = (pairedKeyHex && !(pairedMasterNodeUrl.includes('localhost') || pairedMasterNodeUrl.includes('127.0.0.1')))
      ? Buffer.from(pairedKeyHex, 'hex')
      : undefined
    masterNodeClient.connect(
      pairedMasterNodeUrl,
      useKey
    )
  } else {
    console.log('[main] no paired Master Node yet — waiting for the Connect Device wizard')
  }

  setInterval(() => {
    try {
      const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS).toISOString()
      for (const nodeId of markStaleNodesOffline(cutoff)) {
        mainWindow?.webContents.send('node:status', { node_id: nodeId, online: false })
      }
    } catch (err) {
      console.error('[main] offline check failed:', err)
    }
  }, OFFLINE_CHECK_INTERVAL_MS)

  setInterval(() => {
    void (async () => {
      try {
        await syncQueuedReadings(false)
      } catch (err) {
        console.error('[main] Automatic cloud sync failed:', err instanceof Error ? err.message : String(err))
      }
    })()
  }, CLOUD_SYNC_INTERVAL_MS)

  // Initial sync on startup (waits for internet)
  void (async () => {
    try {
      await syncQueuedReadings(false)
    } catch (err) {
      console.debug('[main] Startup cloud sync skipped (likely offline):', err instanceof Error ? err.message : String(err))
    }
  })()

  createWindow()

  const savedWifiSsid = getSettingOptional('wifi_ssid')
  const savedWifiPassword = getSettingOptional('wifi_password')
  if (savedWifiSsid && savedWifiPassword) {
    connectToNetwork(savedWifiSsid, savedWifiPassword).catch((err) => {
      console.warn('[main] saved WiFi connection failed:', err)
    })
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
