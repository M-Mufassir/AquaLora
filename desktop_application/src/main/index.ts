import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  initDb,
  insertReading,
  upsertNodeFromReading,
  getRecentReadings,
  getReadingsInRange,
  readingsToCsv,
  insertAlert,
  getRecentAlerts,
  getAllRecentAlerts,
  acknowledgeAlert,
  markStaleNodesOffline,
  userCount,
  createUser,
  verifyUser,
  listUsers,
  deleteUser,
  changePassword,
  getAllNodes,
  upsertNode,
  upsertNodeStub,
  getSetting,
  getSettingOptional,
  setSetting
} from './db'
import { MasterNodeClient } from './masterNodeClient'
import { DecisionEngine } from './decisionEngine'
import { scanNetworks, connectToNetwork, getCurrentConnection } from './wifiManager'
import { deriveKeyFromPassword } from './secureChannel'
import type { Score } from '../shared/types'

const OFFLINE_CHECK_INTERVAL_MS = 30_000
const OFFLINE_THRESHOLD_MS = 5 * 60_000

let mainWindow: BrowserWindow
const masterNodeClient = new MasterNodeClient()
const decisionEngine = new DecisionEngine()

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
    const defaultPassword = randomBytes(6).toString('hex')
    createUser('admin', defaultPassword, 'admin')
    console.log(
      `[auth] no users found — created default account. username: admin  password: ${defaultPassword}`
    )
  }

  ipcMain.handle('auth:login', (_event, username: string, password: string) =>
    verifyUser(username, password)
  )

  ipcMain.handle('readings:getRecent', (_event, nodeId: string, limit?: number) =>
    getRecentReadings(nodeId, limit)
  )

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
    soundEnabled: getSetting('sound_enabled', '1') === '1'
  }))
  ipcMain.handle(
    'settings:set',
    (_event, key: 'theme' | 'soundEnabled', value: string | boolean) => {
      if (key === 'theme') setSetting('theme', String(value))
      if (key === 'soundEnabled') setSetting('sound_enabled', value ? '1' : '0')
    }
  )

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
  // Only auto-connect if the user has actually paired with a Master Node
  // before (via the Connect Device wizard) — otherwise a fresh install, or
  // one that's never been paired, would silently dial the dev mock (if one
  // happens to be running) and populate nodes the user never asked to see.
  const pairedMasterNodeUrl = getSettingOptional('master_node_url')
  if (pairedMasterNodeUrl) {
    const pairedKeyHex = getSettingOptional('master_node_key_hex')
    masterNodeClient.connect(
      pairedMasterNodeUrl,
      pairedKeyHex ? Buffer.from(pairedKeyHex, 'hex') : undefined
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

  createWindow()

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
