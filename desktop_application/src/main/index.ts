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
  batchInsertHistoricalReadingsWithResult,
  filterNewReadings,
  getReadingsInRange,
  readingsToCsv,
  insertAlert,
  filterNewAlerts,
  batchInsertHistoricalAlerts,
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
  resetLocalNodeData,
  setActiveMasterNodeCode,
  getActiveMasterNodeCode,
  getMasterNodeByCode,
  registerOrUpdateMasterNode
} from './db'
import {
  saveCloudSession,
  loadCloudSession,
  clearCloudSession,
  validateCloudSession,
  resolveCloudUrl,
  type CloudSessionData
} from './cloudSession'
import { DEFAULT_CLOUD_API_URL } from './config'
import { MasterNodeClient } from './masterNodeClient'
import { DecisionEngine } from './decisionEngine'
import { scanNetworks, connectToNetwork, getCurrentConnection } from './wifiManager'
import { startUdpDiscovery, stopUdpDiscovery, getDiscoveredDevices } from './udpDiscovery'
import { deriveKeyFromPassword } from './secureChannel'
import type { Score, CloudSyncStatus, SyncPhase } from '../shared/types'

const OFFLINE_CHECK_INTERVAL_MS = 30_000
const OFFLINE_THRESHOLD_MS = 5 * 60_000
const CLOUD_SYNC_INTERVAL_MS = 20_000
const NETWORK_CHECK_TIMEOUT_MS = 4_000

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
        const localNode = upsertNodeStub(String(id), nodeCode)
        if (cloudNode.name || cloudNode.display_name || cloudNode.location) {
          upsertNode(
            String(id),
            cloudNode.name ?? cloudNode.display_name ?? localNode.name ?? String(id),
            cloudNode.location ?? localNode.location ?? '',
            nodeCode
          )
        }
        if (cloudNode.pond_type) setNodePondType(String(id), cloudNode.pond_type)
        if (cloudNode.custom_profile) setNodeCustomProfile(String(id), cloudNode.custom_profile)
        mainWindow?.webContents.send('node:updated', getAllNodes(nodeCode).find((n) => n.id === String(id)) ?? localNode)
      }
    }
    if (historyResponse.ok) {
      const payload = (await historyResponse.json()) as any
      const rows = Array.isArray(payload) ? payload : payload.readings ?? payload.data ?? []
      const readings = rows.map((row: any) => ({ ...row, node_id: row.node_id ?? row.nodeId, timestamp: row.timestamp ?? row.created_at }))
        .filter((row: any) => row.node_id && row.timestamp && row.temperature != null)
        .filter((row: any) => !row.master_node_code || row.master_node_code === nodeCode)
      batchInsertHistoricalReadings(readings, nodeCode)
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
 * Check if internet/cloud connectivity is available.
 * Tests the cloud endpoint /health or uses DNS lookup fallback.
 */
async function checkInternetConnectivity(): Promise<boolean> {
  const baseUrl = getSettingOptional('cloud_sync_url')?.trim() || DEFAULT_CLOUD_API_URL
  try {
    const healthUrl = resolveCloudUrl('/health', baseUrl)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_CHECK_TIMEOUT_MS)
    try {
      const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal })
      return res.ok || res.status < 500
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    // If direct health check failed, check DNS resolution of host
    try {
      const host = new URL(baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`).hostname
      const { promises: dnsPromises } = await import('dns')
      await dnsPromises.lookup(host)
      return true
    } catch {
      return false
    }
  }
}

let isSyncInProgress = false
let currentSyncPhase: SyncPhase = 'idle'

function notifySyncStatus(status: CloudSyncStatus): void {
  mainWindow?.webContents.send('cloud:sync-status', status)
}

async function performCloudSync(isManual = false): Promise<CloudSyncStatus> {
  if (isSyncInProgress) {
    return { ...getCloudSyncStatus(), isSyncing: true, syncPhase: currentSyncPhase }
  }

  isSyncInProgress = true
  const baseUrl = getSettingOptional('cloud_sync_url')?.trim() || DEFAULT_CLOUD_API_URL
  const activeCode = getActiveMasterNodeCode() || getSettingOptional('master_node_code') || 'AQL-0001'

  try {
    // 1. Check internet connectivity
    const hasInternet = await checkInternetConnectivity()
    if (!hasInternet) {
      const status: CloudSyncStatus = {
        ...getCloudSyncStatus(),
        isSyncing: false,
        isOnline: false,
        syncPhase: 'error'
      }
      notifySyncStatus(status)
      if (isManual) {
        throw new Error('Cloud backend is unreachable. Telemetry is preserved locally in offline mode.')
      }
      return status
    }

    // 2. Authenticate or refresh session token
    let accessToken = await getCloudAuthToken()
    if ((!accessToken || accessToken.startsWith('local-')) && activeCode) {
      try {
        const loginUrl = resolveCloudUrl('/auth/login', baseUrl)
        const authNodeCode = (activeCode === 'master-node' || activeCode === 'AquaLoRa-Master') ? 'AQL-0001' : activeCode
        const authPassword =
          authNodeCode === 'AQL-TEST' || activeCode === 'test-master-node' || activeCode === 'test-master'
            ? 'testmaster123'
            : 'aqualora123'
        const authClient = (authNodeCode === 'AQL-0001' || authNodeCode === 'AQL-001') ? 'masternode' : 'desktop'
        const res = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            node_code: authNodeCode,
            password: authPassword,
            client: authClient
          })
        })
        if (res.ok) {
          const data = (await res.json()) as any
          const token = data.access_token || data.token
          if (token) {
            saveCloudSession({
              token,
              masterNodeId: data.master_node_id || 1,
              nodeCode: data.node_code || activeCode,
              displayName: data.display_name || activeCode,
              role: data.role || 'customer',
              savedAt: new Date().toISOString()
            })
            accessToken = token
          }
        }
      } catch (authErr) {
        console.warn('[main] Background cloud auto-authentication attempt failed:', authErr)
      }
    }

    if (!accessToken || accessToken.startsWith('local-')) {
      const status: CloudSyncStatus = {
        ...getCloudSyncStatus(),
        isSyncing: false,
        isOnline: false,
        syncPhase: 'error'
      }
      notifySyncStatus(status)
      if (isManual) {
        throw new Error('Not authenticated to cloud backend. Please activate Master Node cloud session.')
      }
      return status
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    }

    // 3. Checking Phase
    currentSyncPhase = 'checking'
    notifySyncStatus({
      ...getCloudSyncStatus(),
      isSyncing: true,
      syncPhase: 'checking',
      isOnline: true
    })

    const pendingEntries = getPendingOutboxEntries(100)
    const pendingAlerts = getPendingAlertOutboxEntries(100)
    let totalUploaded = 0
    let totalDownloaded = 0

    // 4. Upload Phase: Send pending readings, alerts & node configurations
    if (pendingEntries.length > 0 || pendingAlerts.length > 0) {
      currentSyncPhase = 'uploading'
      const pendingTotal = pendingEntries.length + pendingAlerts.length
      notifySyncStatus({
        ...getCloudSyncStatus(),
        isSyncing: true,
        syncPhase: 'uploading',
        uploadedCount: pendingTotal,
        isOnline: true
      })

      // Upload readings
      if (pendingEntries.length > 0) {
        const syncUrl = resolveCloudUrl('/readings/sync', baseUrl)
        const readings = pendingEntries.map((entry) => JSON.parse(entry.payload_json))
        const res = await fetch(syncUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ readings })
        })
        if (!res.ok) {
          const errDetail = `Readings sync failed: HTTP ${res.status}: ${res.statusText}`
          for (const entry of pendingEntries) {
            markOutboxFailed(entry.id, errDetail)
          }
          throw new Error(errDetail)
        }
        markOutboxSynced(pendingEntries.map((entry) => entry.id))
        totalUploaded += readings.length
      }

      // Upload alerts
      if (pendingAlerts.length > 0) {
        const alertSyncUrl = resolveCloudUrl('/alerts/sync', baseUrl)
        const alerts = pendingAlerts.map((entry) => JSON.parse(entry.payload_json))
        const res = await fetch(alertSyncUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ alerts })
        })
        if (!res.ok) {
          const errDetail = `Alerts sync failed: HTTP ${res.status}: ${res.statusText}`
          for (const entry of pendingAlerts) {
            markAlertOutboxFailed(entry.id, errDetail)
          }
          throw new Error(errDetail)
        }
        markAlertOutboxSynced(pendingAlerts.map((entry) => entry.id))
        totalUploaded += alerts.length
      }

      // Also sync local node configurations to cloud
      try {
        const nodesSyncUrl = resolveCloudUrl('/nodes/sync', baseUrl)
        const allNodes = getAllNodes(activeCode ?? undefined)
        if (allNodes.length > 0) {
          const payload = allNodes.map((n: any) => ({
            node_id: n.id,
            name: n.name ?? null,
            location: n.location ?? null,
            pond_type: getNodePondType(n.id) ?? 'tilapia',
            custom_profile: getNodeCustomProfile(n.id) ?? null
          }))
          await fetch(nodesSyncUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ nodes: payload })
          })
        }
      } catch (nodeErr) {
        console.warn('[main] Node sync upload non-critical warning:', nodeErr)
      }
    }

    // 5. Download Phase: Fetch cloud telemetry, alerts, and node configurations
    currentSyncPhase = 'downloading'
    notifySyncStatus({
      ...getCloudSyncStatus(),
      isSyncing: true,
      syncPhase: 'downloading',
      isOnline: true
    })

    try {
      const [historyResponse, alertsResponse, nodesResponse, profileResponse] = await Promise.all([
        fetch(resolveCloudUrl('/readings/history?limit=1000', baseUrl), { headers }),
        fetch(resolveCloudUrl('/alerts/history?limit=200', baseUrl), { headers }),
        fetch(resolveCloudUrl('/nodes', baseUrl), { headers }),
        fetch(resolveCloudUrl('/master-nodes/me', baseUrl), { headers })
      ])

      // 5a. Download and sync nodes
      if (nodesResponse.ok) {
        const payload = (await nodesResponse.json()) as any
        const cloudNodes = Array.isArray(payload) ? payload : payload.nodes ?? payload.data ?? []
        for (const cloudNode of cloudNodes) {
          const id = cloudNode.node_id ?? cloudNode.id
          if (!id) continue
          const localNode = upsertNodeStub(String(id), activeCode ?? undefined)
          if (cloudNode.name || cloudNode.display_name || cloudNode.location) {
            upsertNode(
              String(id),
              cloudNode.name ?? cloudNode.display_name ?? localNode.name ?? String(id),
              cloudNode.location ?? localNode.location ?? '',
              activeCode ?? undefined
            )
          }
          if (cloudNode.pond_type) setNodePondType(String(id), cloudNode.pond_type)
          if (cloudNode.custom_profile) setNodeCustomProfile(String(id), cloudNode.custom_profile)
          mainWindow?.webContents.send(
            'node:updated',
            getAllNodes(activeCode ?? undefined).find((n) => n.id === String(id)) ?? localNode
          )
        }
      }

      // 5b. Download and sync readings (with multi-page catchup for missing/older records)
      if (historyResponse.ok) {
        const payload = (await historyResponse.json()) as any
        const initialRows = Array.isArray(payload) ? payload : payload.readings ?? payload.data ?? []
        const allCloudRows = [...initialRows]
        let currentBatch = initialRows
        let pageCount = 1
        const maxPages = 5 // Fetch up to 5,000 missing readings

        while (currentBatch.length >= 1000 && pageCount < maxPages) {
          const oldestTime = currentBatch[currentBatch.length - 1]?.timestamp ?? currentBatch[currentBatch.length - 1]?.created_at
          if (!oldestTime) break
          try {
            const nextUrl = resolveCloudUrl(`/readings/history?limit=1000&end=${encodeURIComponent(oldestTime)}`, baseUrl)
            const nextRes = await fetch(nextUrl, { headers })
            if (!nextRes.ok) break
            const nextPayload = (await nextRes.json()) as any
            const nextRows = Array.isArray(nextPayload) ? nextPayload : nextPayload.readings ?? nextPayload.data ?? []
            if (nextRows.length <= 1) break
            const sliced = nextRows.slice(1) // exclude overlapping boundary record
            allCloudRows.push(...sliced)
            currentBatch = nextRows
            pageCount++
          } catch {
            break
          }
        }

        const cloudReadings = allCloudRows
          .map((row: any) => ({
            ...row,
            node_id: String(row.node_id ?? row.nodeId),
            timestamp: row.timestamp ?? row.created_at
          }))
          .filter((row: any) => row.node_id && row.timestamp && row.temperature != null)
          .filter((row: any) => !row.timestamp.startsWith('2026-01-01T00:00:00')) // Ignore placeholder dummy timestamps
          .filter(
            (row: any) =>
              !row.master_node_code ||
              row.master_node_code === activeCode ||
              activeCode === 'master-node' ||
              activeCode === 'AQL-0001'
          )

        const newReadings = filterNewReadings(cloudReadings)
        if (newReadings.length > 0) {
          const { inserted } = batchInsertHistoricalReadingsWithResult(
            newReadings,
            activeCode ?? undefined
          )
          totalDownloaded += inserted.length
          for (const reading of inserted) {
            mainWindow?.webContents.send('reading:new', reading)
          }
        }
      }

      // 5c. Download and sync alerts
      if (alertsResponse.ok) {
        const payload = (await alertsResponse.json()) as any
        const rows = Array.isArray(payload) ? payload : payload.alerts ?? payload.data ?? []
        const cloudAlerts = rows.filter((a: any) => a.node_id && a.timestamp && a.parameter)
        const newAlerts = filterNewAlerts(cloudAlerts)
        if (newAlerts.length > 0) {
          const insertedAlerts = batchInsertHistoricalAlerts(newAlerts, activeCode ?? undefined)
          totalDownloaded += insertedAlerts.length
          for (const alert of insertedAlerts) {
            mainWindow?.webContents.send('alert:new', alert)
          }
        }
      }

      // 5d. Master Node Profile update
      if (profileResponse.ok) {
        const me = (await profileResponse.json()) as any
        if (me && me.display_name && activeCode) {
          registerOrUpdateMasterNode(activeCode, me.display_name)
        }
      }
    } catch (downloadErr) {
      console.warn('[main] Cloud download phase non-critical warning:', downloadErr)
    }

    // 6. Complete Synced Phase
    setSetting('cloud_sync_last_error', '')
    currentSyncPhase = 'synced'
    const finalStatus: CloudSyncStatus = {
      ...getCloudSyncStatus(),
      isSyncing: false,
      syncPhase: 'synced',
      isOnline: true,
      lastError: null,
      uploadedCount: totalUploaded,
      downloadedCount: totalDownloaded,
      downloadPendingCount: 0
    }
    notifySyncStatus(finalStatus)

    // Briefly hold the 'synced' state, then transition to 'idle'
    setTimeout(() => {
      if (!isSyncInProgress) {
        currentSyncPhase = 'idle'
        notifySyncStatus({
          ...getCloudSyncStatus(),
          isSyncing: false,
          syncPhase: 'idle',
          isOnline: true,
          uploadedCount: 0,
          downloadedCount: 0
        })
      }
    }, 3500)

    return finalStatus
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Unknown cloud sync error'
    setSetting('cloud_sync_last_error', message)
    currentSyncPhase = 'error'
    const errStatus: CloudSyncStatus = {
      ...getCloudSyncStatus(),
      isSyncing: false,
      syncPhase: 'error',
      isOnline: false,
      lastError: message
    }
    notifySyncStatus(errStatus)
    if (isManual) throw error
    return errStatus
  } finally {
    isSyncInProgress = false
  }
}

async function syncQueuedReadings(isManual = false): Promise<void> {
  await performCloudSync(isManual)
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
    frame: false,
    titleBarStyle: 'hidden',
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

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

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
        DEFAULT_CLOUD_API_URL

      // 1. Check if this Master Node was previously connected in our local SQLite database
      const existingMasterNode = getMasterNodeByCode(nodeCode)
      const isNewNode = !existingMasterNode
      setActiveMasterNodeCode(nodeCode)

      // Register or update master node record in SQLite database
      registerOrUpdateMasterNode(
        nodeCode,
        displayName,
        wsUrl,
        password ? deriveKeyFromPassword(password).toString('hex') : undefined
      )

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

      const defaultPassword =
        nodeCode === 'AQL-TEST' || nodeCode === 'test-master-node' || nodeCode === 'test-master'
          ? 'testmaster123'
          : 'aqualora123'
      const effectivePassword = password || defaultPassword

      // 4. Upsert user in local SQLite database (using new node code as username)
      upsertUser(nodeCode, effectivePassword, 'operator')

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
          const authNodeCode =
            nodeCode === 'master-node' || nodeCode === 'AquaLoRa-Master' ? 'AQL-0001' : nodeCode
          const authClient =
            authNodeCode === 'AQL-0001' || authNodeCode === 'AQL-001' ? 'masternode' : 'desktop'

          // 5a. Try to login as existing node first
          const loginRes = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              node_code: authNodeCode,
              password: effectivePassword,
              client: authClient
            }),
            signal: controller.signal
          })

          if (loginRes.ok) {
            const data = (await loginRes.json()) as any
            session = {
              token: data.access_token || data.token || '',
              masterNodeId: data.master_node_id || 1,
              nodeCode: data.node_code || authNodeCode,
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

  ipcMain.handle('cloud:sync-status', () => ({
    ...getCloudSyncStatus(),
    isSyncing: isSyncInProgress,
    syncPhase: currentSyncPhase
  }))
  ipcMain.handle('cloud:sync', async () => {
    return await performCloudSync(true)
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
    const activeCode = getActiveMasterNodeCode() ?? getSettingOptional('master_node_code') ?? undefined
    for (const { node_id } of nodes) {
      try {
        const node = upsertNodeStub(node_id, activeCode)
        mainWindow?.webContents.send('node:updated', node)
      } catch (err) {
        console.error('[main] failed to persist discovered node:', err)
      }
    }
    mainWindow?.webContents.send('nodes:discovered', nodes)
  })

  let cloudSyncDebounceTimer: NodeJS.Timeout | null = null

  masterNodeClient.onReading((reading) => {
    // Sanitize timestamp: if missing, unset, or dummy placeholder, use current real wall-clock time!
    const isPlaceholderTime =
      !reading.timestamp ||
      reading.timestamp === 'Unknown' ||
      reading.timestamp === '2026-01-01T00:00:00Z' ||
      reading.timestamp.startsWith('2026-01-01T00:00') ||
      reading.timestamp.startsWith('1970-01-01') ||
      isNaN(new Date(reading.timestamp).getTime())
    if (isPlaceholderTime) {
      reading.timestamp = new Date().toISOString()
    }
    console.log('[main] reading received (timestamp: %s):', reading.timestamp, reading)
    const activeCode = getActiveMasterNodeCode() ?? getSettingOptional('master_node_code') ?? undefined
    try {
      const node = upsertNodeFromReading(reading, activeCode)
      insertReading(reading, activeCode)
      mainWindow?.webContents.send('node:updated', node)
    } catch (err) {
      console.error('[main] failed to persist reading:', err)
    }
    mainWindow?.webContents.send('reading:new', reading)

    // Debounced automatic background sync to cloud (2 seconds)
    if (cloudSyncDebounceTimer) clearTimeout(cloudSyncDebounceTimer)
    cloudSyncDebounceTimer = setTimeout(() => {
      void syncQueuedReadings(false).catch((err) => {
        console.debug('[main] Background sync on reading skipped:', err instanceof Error ? err.message : String(err))
      })
    }, 2000)

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
            message: result.recommendation ?? `${result.status}: Fish Health Index ${result.score}`,
            master_node_code: activeCode
          })
          mainWindow?.webContents.send('alert:new', alert)

          // Immediately sync critical/warning alert to cloud
          if (cloudSyncDebounceTimer) clearTimeout(cloudSyncDebounceTimer)
          cloudSyncDebounceTimer = setTimeout(() => {
            void syncQueuedReadings(false).catch(() => {})
          }, 1000)
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

    // Autonomous Auto-Reconnect on Master Node restart or IP re-assignment
    const activeCode = getActiveMasterNodeCode() ?? getSettingOptional('master_node_code')
    const beaconWsUrl = `ws://${device.ip}:${device.port}`
    const isMatchingNode =
      (activeCode && (device.id.toUpperCase() === activeCode.toUpperCase() || device.id === 'AquaLoRa-Master')) ||
      (!activeCode && device.id === 'AquaLoRa-Master')

    if (isMatchingNode) {
      const currentUrl = masterNodeClient.getCurrentUrl()
      if (!masterNodeClient.isConnected() || currentUrl !== beaconWsUrl) {
        console.log(`[main] Master node presence detected at ${beaconWsUrl} (active: ${activeCode}). Auto-reconnecting...`)
        setSetting('master_node_url', beaconWsUrl)
        const pairedKeyHex = getSettingOptional('master_node_key_hex')
        const useKey =
          pairedKeyHex && !(beaconWsUrl.includes('localhost') || beaconWsUrl.includes('127.0.0.1'))
            ? Buffer.from(pairedKeyHex, 'hex')
            : undefined
        masterNodeClient.updateEndpoint(beaconWsUrl, useKey)
      }
    }
  })

  const savedMasterNodeCode = getSettingOptional('master_node_code')
  if (savedMasterNodeCode) {
    setActiveMasterNodeCode(savedMasterNodeCode)
  }

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
        await performCloudSync(false)
      } catch (err) {
        console.debug('[main] Automatic periodic cloud sync error:', err instanceof Error ? err.message : String(err))
      }
    })()
  }, CLOUD_SYNC_INTERVAL_MS)

  // Initial sync on startup (delayed 3s so renderer window is mounted and receives live animation)
  setTimeout(() => {
    void (async () => {
      try {
        await performCloudSync(false)
      } catch (err) {
        console.debug('[main] Startup cloud sync skipped (likely offline):', err instanceof Error ? err.message : String(err))
      }
    })()
  }, 3000)

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
