import { useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useReadingsStore } from './store/useReadingsStore'
import ThemeToggle from './components/ThemeToggle'
import CriticalAlertOverlay from './components/CriticalAlertOverlay'
import HomePage from './pages/HomePage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'
import ConnectDevicePage from './pages/ConnectDevicePage'
import MasterNodeProfilePage from './pages/MasterNodeProfilePage'

function WindowTitleBar({ isSyncing }: { isSyncing?: boolean }): React.JSX.Element {
  return (
    <header className="window-titlebar">
      <div className="window-titlebar-brand">
        <span
          className={`window-titlebar-mark${isSyncing ? ' mark-syncing' : ''}`}
          title={isSyncing ? 'Background cloud synchronization active' : 'AquaLoRa'}
        >
          ◈
        </span>
        <span>AquaLoRa</span>
        <span className="window-titlebar-caption">
          {isSyncing ? 'Cloud sync active…' : 'Desktop dashboard'}
        </span>
      </div>
      <div className="window-controls" aria-label="Window controls">
        <button type="button" onClick={() => window.api.windowControls.minimize()} aria-label="Minimize">
          <span className="window-icon window-icon-minimize" />
        </button>
        <button type="button" onClick={() => window.api.windowControls.toggleMaximize()} aria-label="Maximize or restore">
          <span className="window-icon window-icon-maximize" />
        </button>
        <button type="button" className="window-close" onClick={() => window.api.windowControls.close()} aria-label="Close">
          <span className="window-icon window-icon-close" />
        </button>
      </div>
    </header>
  )
}

function CloudSyncPill({
  syncStatus,
  isManualSyncing,
  onTriggerSync
}: {
  syncStatus: any
  isManualSyncing: boolean
  onTriggerSync: () => Promise<void>
}): React.JSX.Element {
  const isSyncActive = Boolean(syncStatus.isSyncing || isManualSyncing)
  const phase = syncStatus.syncPhase ?? (isSyncActive ? 'syncing' : 'idle')

  if (!syncStatus.enabled) {
    return (
      <div
        className="nav-status-pill local-only"
        title="Local database storage active. Cloud sync not configured."
      >
        <span className="pill-dot local" />
        <span>Local Storage</span>
      </div>
    )
  }

  // Active sync states with animated icons & phase feedback
  if (isSyncActive) {
    if (phase === 'uploading') {
      return (
        <button
          type="button"
          className="nav-status-pill uploading"
          title="Uploading local telemetry and configurations to cloud backend..."
          disabled
        >
          <span className="pill-upload-icon">↑</span>
          <span>Uploading{syncStatus.uploadedCount ? ` (${syncStatus.uploadedCount})` : ''}…</span>
        </button>
      )
    }

    if (phase === 'downloading') {
      return (
        <button
          type="button"
          className="nav-status-pill downloading"
          title="Downloading cloud telemetry and updates to local database..."
          disabled
        >
          <span className="pill-download-icon">↓</span>
          <span>Downloading{syncStatus.downloadedCount ? ` (${syncStatus.downloadedCount})` : ''}…</span>
        </button>
      )
    }

    return (
      <button
        type="button"
        className="nav-status-pill syncing"
        title="Checking and synchronizing telemetry with cloud backend..."
        disabled
      >
        <span className="pill-spin-icon">↻</span>
        <span>{phase === 'checking' ? 'Checking…' : 'Syncing…'}</span>
      </button>
    )
  }

  // Offline / Error state
  if (syncStatus.isOnline === false || syncStatus.lastError) {
    return (
      <button
        type="button"
        className="nav-status-pill offline clickable"
        onClick={onTriggerSync}
        title={
          syncStatus.lastError
            ? `Cloud sync error: ${syncStatus.lastError}. Click to retry.`
            : 'Cloud offline. Data cached safely in local database. Click to retry.'
        }
      >
        <span className="pill-dot offline" />
        <span>Cloud Offline</span>
      </button>
    )
  }

  // Just completed sync state
  if (phase === 'synced') {
    const summary: string[] = []
    if (syncStatus.uploadedCount) summary.push(`+${syncStatus.uploadedCount}↑`)
    if (syncStatus.downloadedCount) summary.push(`+${syncStatus.downloadedCount}↓`)
    const summaryText = summary.length ? ` (${summary.join(' ')})` : ''

    return (
      <button
        type="button"
        className="nav-status-pill synced just-synced clickable"
        onClick={onTriggerSync}
        title="Database is synchronized with cloud. Click to re-sync now."
      >
        <span className="pill-check-icon">✓</span>
        <span>Synced{summaryText}</span>
      </button>
    )
  }

  // Pending changes queued or waiting to sync
  const pendingUpload = syncStatus.pendingCount ?? 0
  const pendingDownload = syncStatus.downloadPendingCount ?? 0
  if (pendingUpload > 0 || pendingDownload > 0) {
    let label = `${pendingUpload} Pending`
    if (pendingUpload > 0 && pendingDownload > 0) {
      label = `↑${pendingUpload} ↓${pendingDownload} Sync`
    } else if (pendingDownload > 0) {
      label = `↓${pendingDownload} in Cloud`
    }

    return (
      <button
        type="button"
        className="nav-status-pill pending clickable"
        onClick={onTriggerSync}
        title={`${pendingUpload} upload(s) and ${pendingDownload} download(s) waiting. Click to sync immediately.`}
      >
        <span className="pill-dot pending" />
        <span>{label}</span>
      </button>
    )
  }

  // Fully in sync / idle
  return (
    <button
      type="button"
      className="nav-status-pill synced clickable"
      onClick={onTriggerSync}
      title={
        syncStatus.lastSyncedAt
          ? `All telemetry synchronized. Last sync: ${new Date(syncStatus.lastSyncedAt).toLocaleTimeString()}. Click to sync now.`
          : 'All telemetry synchronized with cloud. Click to sync now.'
      }
    >
      <span className="pill-dot synced" />
      <span>Cloud Synced</span>
    </button>
  )
}

// Sends a freshly logged-in user with zero paired nodes straight to the
// pairing wizard instead of an empty Home page — but only once per app
// session, so deliberately navigating back to Home afterwards isn't fought.
// Waits for nodesLoaded so it doesn't fire on the initial empty store state
// before the getAllNodes() fetch resolves.
function FirstRunRedirect({
  nodesLoaded,
  hasSession
}: {
  nodesLoaded: boolean
  hasSession: boolean
}): null {
  const navigate = useNavigate()
  const location = useLocation()
  const knownNodes = useReadingsStore((s) => s.knownNodes)
  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (hasCheckedRef.current || !nodesLoaded) return
    if (location.pathname !== '/') return
    hasCheckedRef.current = true
    if (!hasSession && knownNodes.length === 0) navigate('/connect', { replace: true })
  }, [knownNodes, nodesLoaded, location.pathname, navigate, hasSession])

  return null
}

function App(): React.JSX.Element {
  const currentUser = useReadingsStore((s) => s.currentUser)
  const setCurrentUser = useReadingsStore((s) => s.setCurrentUser)
  const linkStatus = useReadingsStore((s) => s.linkStatus)
  const setReading = useReadingsStore((s) => s.setReading)
  const setScore = useReadingsStore((s) => s.setScore)
  const addAlert = useReadingsStore((s) => s.addAlert)
  const setAlerts = useReadingsStore((s) => s.setAlerts)
  const setLinkStatus = useReadingsStore((s) => s.setLinkStatus)
  const setNodeOffline = useReadingsStore((s) => s.setNodeOffline)
  const setKnownNodes = useReadingsStore((s) => s.setKnownNodes)
  const upsertKnownNode = useReadingsStore((s) => s.upsertKnownNode)
  const setSettings = useReadingsStore((s) => s.setSettings)
  const setSyncStatus = useReadingsStore((s) => s.setSyncStatus)
  const [nodesLoaded, setNodesLoaded] = useState(false)
  const [cloudSessionChecked, setCloudSessionChecked] = useState(false)
  const [cloudSession, setCloudSession] = useState<any | null>(null)
  const [isManualSyncing, setIsManualSyncing] = useState(false)

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setSettings(settings)
      document.documentElement.dataset.theme = settings.theme
    })

    window.api.getCloudSession().then((session) => {
      setCloudSession(session)
      setCloudSessionChecked(true)

      // Auto-restore session for the operator
      if (session) {
        setCurrentUser({ username: session.nodeCode, role: session.role || 'operator' })
        window.api.validateCloudSession().then((valid) => {
          if (!valid) {
            console.warn('[App] Stored cloud session is no longer valid on backend.')
          }
        })
      }
    })

    window.api.getSyncStatus().then(setSyncStatus)
    const unsubscribe = window.api.onSyncStatus((status) => setSyncStatus(status))
    return () => unsubscribe()
  }, [setSettings, setSyncStatus, setCurrentUser])

  useEffect(() => {
    if (!currentUser) return

    const unsubReading = window.api.onReading((reading) => setReading(reading))
    const unsubScore = window.api.onScore((score) => setScore(score))
    const unsubAlert = window.api.onAlert((alert) => addAlert(alert))
    const unsubConnection = window.api.onConnectionStatus((status) => setLinkStatus(status))
    const unsubNodeStatus = window.api.onNodeStatus((update) => {
      if (!update.online) setNodeOffline(update.node_id)
    })
    const unsubNodeUpdated = window.api.onNodeUpdated((node) => upsertKnownNode(node))

    window.api.getAllNodes().then((nodes) => {
      setKnownNodes(nodes)
      window.api.getLatestReadingsByNode().then((latest) => {
        Object.values(latest).forEach((reading) =>
          setReading({ ...reading, battery_pct: 0, rssi: 0 })
        )
      })
      setNodesLoaded(true)
    })
    window.api.getAllRecentAlerts().then(setAlerts)

    return () => {
      unsubReading()
      unsubScore()
      unsubAlert()
      unsubConnection()
      unsubNodeStatus()
      unsubNodeUpdated()
    }
  }, [
    currentUser,
    setReading,
    setScore,
    addAlert,
    setAlerts,
    setLinkStatus,
    setNodeOffline,
    setKnownNodes,
    upsertKnownNode
  ])

  const syncStatus = useReadingsStore((s) => s.syncStatus)

  if (!cloudSessionChecked) {
    return (
      <div className="login-screen">
        <WindowTitleBar />
        <p style={{ color: 'var(--ev-c-text-2)' }}>Initializing AquaLoRa…</p>
      </div>
    )
  }

  // If this workstation has no active session, show the unified 2-step setup & sign-in flow
  if (!cloudSession || !currentUser) {
    return (
      <>
        <WindowTitleBar />
        <HashRouter>
          <ConnectDevicePage
            isOnboarding
            onComplete={(session, user) => {
              setCloudSession(session)
              setCurrentUser(user)
            }}
          />
        </HashRouter>
      </>
    )
  }

  return (
    <HashRouter>
      <>
        <WindowTitleBar isSyncing={Boolean(syncStatus.isSyncing || isManualSyncing)} />
        <div className="app-shell">
        <FirstRunRedirect nodesLoaded={nodesLoaded} hasSession={Boolean(cloudSession || currentUser)} />
        <nav className="top-nav">
          <span className="app-title">AquaLoRa</span>
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Home
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Logs
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            Node Profile
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            Settings
          </NavLink>
          <NavLink
            to="/connect"
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            Connect Device
          </NavLink>
          <div className="nav-spacer" />

          {/* 1. Master Node Status Pill */}
          {linkStatus === 'connected' ? (
            <div
              className="nav-status-pill connected"
              title="ESP32 hardware link active via encrypted WebSocket"
            >
              <span className="pill-dot live" />
              <span>{cloudSession?.nodeCode || currentUser.username || 'Master Node'} Live</span>
            </div>
          ) : (
            <div
              className="nav-status-pill reconnecting"
              title="ESP32 link disconnected. Autonomous background reconnect active..."
            >
              <span className="pill-dot reconnecting" />
              <span>Reconnecting…</span>
            </div>
          )}

          {/* 2. Cloud Connection & Animated Sync Pill */}
          <CloudSyncPill
            syncStatus={syncStatus}
            isManualSyncing={isManualSyncing}
            onTriggerSync={async () => {
              if (isManualSyncing) return
              setIsManualSyncing(true)
              try {
                const status = await window.api.syncCloudReadings()
                useReadingsStore.getState().setSyncStatus(status)
              } catch (err) {
                console.warn('[App] Manual sync failed:', err)
              } finally {
                setIsManualSyncing(false)
              }
            }}
          />

          <span className="nav-user">
            {currentUser.username} <span className="nav-user-role">({currentUser.role})</span>
          </span>
          <button
            className="logout-btn"
            onClick={async () => {
              await window.api.cloudLogout()
              setCloudSession(null)
              setCurrentUser(null)
            }}
          >
            Log out
          </button>
          <ThemeToggle />
        </nav>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/logs/:nodeId" element={<LogsPage />} />
            <Route path="/profile" element={<MasterNodeProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/connect" element={<ConnectDevicePage />} />
          </Routes>
        </main>

        <CriticalAlertOverlay />
        </div>
      </>
    </HashRouter>
  )
}

export default App

