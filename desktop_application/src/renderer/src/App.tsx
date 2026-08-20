import { useEffect } from 'react'
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useReadingsStore } from './store/useReadingsStore'
import LoginScreen from './components/LoginScreen'
import ThemeToggle from './components/ThemeToggle'
import CriticalAlertOverlay from './components/CriticalAlertOverlay'
import HomePage from './pages/HomePage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'

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

  useEffect(() => {
    window.api.getSettings().then((settings) => {
      setSettings(settings)
      document.documentElement.dataset.theme = settings.theme
    })
  }, [setSettings])

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

    window.api.getAllNodes().then(setKnownNodes)
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

  if (!currentUser) {
    return <LoginScreen onLogin={(username, role) => setCurrentUser({ username, role })} />
  }

  return (
    <HashRouter>
      <div className="app-shell">
        <nav className="top-nav">
          <span className="app-title">AquaLoRa</span>
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Home
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Logs
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Settings
          </NavLink>
          <div className="nav-spacer" />
          {linkStatus === 'reconnecting' && (
            <span className="nav-connection-warning">Reconnecting…</span>
          )}
          <span className="nav-user">
            {currentUser.username} <span className="nav-user-role">({currentUser.role})</span>
          </span>
          <button className="logout-btn" onClick={() => setCurrentUser(null)}>
            Log out
          </button>
          <ThemeToggle />
        </nav>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/logs/:nodeId" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>

        <CriticalAlertOverlay />
      </div>
    </HashRouter>
  )
}

export default App
