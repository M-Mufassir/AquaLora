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

// Sends a freshly logged-in user with zero paired nodes straight to the
// pairing wizard instead of an empty Home page — but only once per app
// session, so deliberately navigating back to Home afterwards isn't fought.
// Waits for nodesLoaded so it doesn't fire on the initial empty store state
// before the getAllNodes() fetch resolves.
function FirstRunRedirect({ nodesLoaded }: { nodesLoaded: boolean }): null {
  const navigate = useNavigate()
  const location = useLocation()
  const knownNodes = useReadingsStore((s) => s.knownNodes)
  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (hasCheckedRef.current || !nodesLoaded) return
    if (location.pathname !== '/') return
    hasCheckedRef.current = true
    if (knownNodes.length === 0) navigate('/connect', { replace: true })
  }, [knownNodes, nodesLoaded, location.pathname, navigate])

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
        <p style={{ color: 'var(--ev-c-text-2)' }}>Initializing AquaLoRa…</p>
      </div>
    )
  }

  // If this workstation has no active session, show the unified 2-step setup & sign-in flow
  if (!cloudSession || !currentUser) {
    return (
      <HashRouter>
        <ConnectDevicePage
          isOnboarding
          onComplete={(session, user) => {
            setCloudSession(session)
            setCurrentUser(user)
          }}
        />
      </HashRouter>
    )
  }

  return (
    <HashRouter>
      <div className="app-shell">
        <FirstRunRedirect nodesLoaded={nodesLoaded} />
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

          {/* Master Node Link Status */}
          {linkStatus === 'reconnecting' ? (
            <span className="nav-connection-warning">🟡 Master Node Reconnecting…</span>
          ) : (
            <span className="nav-connection-good">🟢 Master Node Connected</span>
          )}

          {/* Cloud Sync & Migration Badge */}
          {syncStatus.enabled && (
            <div className="nav-sync-group">
              <span
                className={`nav-sync-badge ${
                  syncStatus.lastError
                    ? 'error'
                    : syncStatus.pendingCount > 0
                    ? 'pending'
                    : 'synced'
                }`}
              >
                {syncStatus.lastError
                  ? '🔴 Sync Error'
                  : syncStatus.pendingCount > 0
                  ? `🟡 ${syncStatus.pendingCount} Pending Sync`
                  : '🟢 Cloud Synced'}
              </span>
              <button
                className="nav-sync-btn"
                onClick={async () => {
                  const status = await window.api.syncCloudReadings()
                  useReadingsStore.getState().setSyncStatus(status)
                }}
                title="Sync queued telemetry and alerts to cloud backend"
              >
                🔄 Sync Now
              </button>
            </div>
          )}

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
    </HashRouter>
  )
}

export default App

