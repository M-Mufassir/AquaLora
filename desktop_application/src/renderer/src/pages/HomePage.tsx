import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReadingsStore, EMPTY_NODE_STATE } from '../store/useReadingsStore'
import { deriveStatusTier } from '../../../shared/types'
import NodeSummaryCard from '../components/NodeSummaryCard'

function formatRelativeTime(iso: string): string {
  const deltaSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`
  return `${Math.floor(deltaSec / 86400)}d ago`
}

function HomePage(): React.JSX.Element {
  const knownNodes = useReadingsStore((s) => s.knownNodes)
  const nodesById = useReadingsStore((s) => s.nodesById)
  const alerts = useReadingsStore((s) => s.alerts)
  const syncStatus = useReadingsStore((s) => s.syncStatus)
  const linkStatus = useReadingsStore((s) => s.linkStatus)

  const counts = useMemo(() => {
    const c = { Good: 0, Warning: 0, Critical: 0, Offline: 0 }
    for (const node of knownNodes) {
      const state = nodesById[node.id] ?? EMPTY_NODE_STATE
      c[deriveStatusTier(state.latestScore, state.status.online)]++
    }
    return c
  }, [knownNodes, nodesById])

  // Fleet wide sensor statistics
  const fleetAverages = useMemo(() => {
    const temps: number[] = []
    const phs: number[] = []
    const turbs: number[] = []
    const tdss: number[] = []

    for (const node of knownNodes) {
      const state = nodesById[node.id]
      if (state?.latest) {
        if (state.latest.temperature != null) temps.push(state.latest.temperature)
        if (state.latest.ph != null) phs.push(state.latest.ph)
        if (state.latest.turbidity != null) turbs.push(state.latest.turbidity)
        if (state.latest.tds != null) tdss.push(state.latest.tds)
      }
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
    return {
      temp: avg(temps),
      ph: avg(phs),
      turb: avg(turbs),
      tds: avg(tdss),
      activeCount: temps.length
    }
  }, [knownNodes, nodesById])

  // Overall Fleet Water Health Index (0-100)
  const healthIndex = useMemo(() => {
    if (!knownNodes.length) return 100
    if (counts.Critical > 0) return Math.max(35, 100 - counts.Critical * 30 - counts.Warning * 15)
    if (counts.Warning > 0) return Math.max(65, 100 - counts.Warning * 15)
    return 98
  }, [knownNodes, counts])

  const recentAlerts = alerts.slice(0, 6)

  return (
    <div className="page home-page">
      {/* Executive Command Header */}
      <div className="home-hero-header">
        <div>
          <div className="hero-status-row">
            <span className={`pulse-indicator ${linkStatus === 'connected' ? 'pulse-green' : 'pulse-amber'}`} />
            <span className="hero-kicker">
              {linkStatus === 'connected' ? 'HARDWARE LORA LINK ONLINE' : 'AUTONOMOUS RECONNECTING'}
            </span>
            <span className="hero-badge">STATION CORE</span>
          </div>
          <h1 className="hero-title">Telemetry Control Center</h1>
          <p className="page-subtitle">
            Autonomous multi-probe LoRa receiver • Local SQLite cache • Azure Cloud Telemetry Ingestion
          </p>
        </div>

        <div className="hero-actions">
          <Link to="/connect" className="hero-btn secondary">
            + Connect Probe
          </Link>
          <button
            type="button"
            className="hero-btn primary"
            onClick={async () => {
              const status = await window.api.syncCloudReadings()
              useReadingsStore.getState().setSyncStatus(status)
            }}
          >
            🔄 Sync Cloud Now
          </button>
        </div>
      </div>

      {/* Primary KPI & Health Score Matrix */}
      <div className="home-executive-grid">
        {/* Master Water Quality Index Card */}
        <div className="executive-card wqi-card">
          <div className="card-topline">
            <span className="card-label">Fleet Health Index</span>
            <span className={`card-health-tag ${healthIndex >= 85 ? 'good' : healthIndex >= 60 ? 'warning' : 'critical'}`}>
              {healthIndex >= 85 ? 'Optimal' : healthIndex >= 60 ? 'Advisory' : 'Alert'}
            </span>
          </div>
          <div className="wqi-display">
            <div className="wqi-score-wrap">
              <span className="wqi-score">{healthIndex}</span>
              <span className="wqi-max">/100</span>
            </div>
            <div className="wqi-details">
              <span className="wqi-status-text">
                {counts.Critical > 0
                  ? `${counts.Critical} probe(s) breaching threshold`
                  : counts.Warning > 0
                  ? `${counts.Warning} probe(s) in warning range`
                  : 'All aquatic parameters in safe range'}
              </span>
              <span className="wqi-subtext">{knownNodes.length} registered pond probes</span>
            </div>
          </div>
          <div className="wqi-progress-bar">
            <div
              className={`wqi-progress-fill ${healthIndex >= 85 ? 'good' : healthIndex >= 60 ? 'warning' : 'critical'}`}
              style={{ width: `${healthIndex}%` }}
            />
          </div>
        </div>

        {/* Fleet Mean Temperature */}
        <div className="executive-card param-card">
          <div className="card-topline">
            <span className="card-label">Mean Water Temp</span>
            <span className="param-icon temp">🌡️</span>
          </div>
          <div className="param-value-wrap">
            <span className="param-value">{fleetAverages.temp != null ? `${fleetAverages.temp.toFixed(1)}°C` : '--'}</span>
            <span className="param-target">Safe: 26.0 - 30.0°C</span>
          </div>
          <div className="param-footer">
            <span className="param-trend">Live sensor stream</span>
            <span className="param-unit">DS18B20 1-Wire</span>
          </div>
        </div>

        {/* Fleet Mean pH */}
        <div className="executive-card param-card">
          <div className="card-topline">
            <span className="card-label">Mean pH Level</span>
            <span className="param-icon ph">🧪</span>
          </div>
          <div className="param-value-wrap">
            <span className="param-value">{fleetAverages.ph != null ? fleetAverages.ph.toFixed(2) : '--'}</span>
            <span className="param-target">Safe: 6.50 - 8.50</span>
          </div>
          <div className="param-footer">
            <span className="param-trend">Acidity / Alkalinity</span>
            <span className="param-unit">Analog Probe</span>
          </div>
        </div>

        {/* Fleet Mean Turbidity */}
        <div className="executive-card param-card">
          <div className="card-topline">
            <span className="card-label">Mean Turbidity</span>
            <span className="param-icon turb">🌊</span>
          </div>
          <div className="param-value-wrap">
            <span className="param-value">{fleetAverages.turb != null ? `${fleetAverages.turb.toFixed(1)} NTU` : '--'}</span>
            <span className="param-target">Safe: &lt; 30 NTU</span>
          </div>
          <div className="param-footer">
            <span className="param-trend">Water Clarity</span>
            <span className="param-unit">Optical Sensor</span>
          </div>
        </div>

        {/* Fleet Mean TDS */}
        <div className="executive-card param-card">
          <div className="card-topline">
            <span className="card-label">Mean TDS</span>
            <span className="param-icon tds">💧</span>
          </div>
          <div className="param-value-wrap">
            <span className="param-value">{fleetAverages.tds != null ? `${Math.round(fleetAverages.tds)} ppm` : '--'}</span>
            <span className="param-target">Safe: &lt; 500 ppm</span>
          </div>
          <div className="param-footer">
            <span className="param-trend">Dissolved Solids</span>
            <span className="param-unit">Conductivity</span>
          </div>
        </div>
      </div>

      {/* Fleet Probe Status Breakdown Strip */}
      <div className="home-stats-strip">
        <div className="stat-pill-item">
          <span className="stat-pill-val">{knownNodes.length}</span>
          <span className="stat-pill-lbl">Total Probes</span>
        </div>
        <div className="stat-pill-item stat-good">
          <span className="stat-pill-val">{counts.Good}</span>
          <span className="stat-pill-lbl">Healthy (Good)</span>
        </div>
        <div className="stat-pill-item stat-warning">
          <span className="stat-pill-val">{counts.Warning}</span>
          <span className="stat-pill-lbl">Warning</span>
        </div>
        <div className="stat-pill-item stat-critical">
          <span className="stat-pill-val">{counts.Critical}</span>
          <span className="stat-pill-lbl">Critical Breaches</span>
        </div>
        <div className="stat-pill-item stat-offline">
          <span className="stat-pill-val">{counts.Offline}</span>
          <span className="stat-pill-lbl">Offline</span>
        </div>
      </div>

      {/* Live 4-Sensor Telemetry Grid */}
      <div className="home-section-header">
        <div>
          <h2 className="home-section-title">Registered Pond Nodes (4-Sensor Live Telemetry)</h2>
          <p className="home-section-subtitle">Real-time parameters: Temperature, Turbidity, TDS, and pH</p>
        </div>
        <Link to="/logs" className="section-link">
          Detailed Logs & History &rarr;
        </Link>
      </div>

      {knownNodes.length === 0 ? (
        <div className="empty-nodes-card">
          <div className="empty-icon">📡</div>
          <h3>No Slave Nodes Registered</h3>
          <p>Pair your first LoRa sensor node using the Connect Device wizard.</p>
          <Link to="/connect" className="hero-btn primary" style={{ marginTop: '12px' }}>
            Open Connect Wizard
          </Link>
        </div>
      ) : (
        <div className="node-summary-grid">
          {knownNodes.map((node) => (
            <NodeSummaryCard key={node.id} node={node} state={nodesById[node.id] ?? EMPTY_NODE_STATE} />
          ))}
        </div>
      )}

      {/* Cloud Synchronization Architecture Banner */}
      <div className="cloud-migration-card">
        <div className="cloud-card-header">
          <div className="cloud-title-group">
            <span className="cloud-icon">☁️</span>
            <div>
              <h3>Cloud Telemetry Pipeline</h3>
              <p className="cloud-subtitle">
                3-Layer Distributed Architecture: Slave Nodes (LoRa) → Desktop Master (SQLite) → Azure Cloud (FastAPI) → Web/Mobile
              </p>
            </div>
          </div>
          <button
            type="button"
            className="cloud-sync-action-btn"
            onClick={async () => {
              const status = await window.api.syncCloudReadings()
              useReadingsStore.getState().setSyncStatus(status)
            }}
          >
            🔄 Sync Now
          </button>
        </div>
        <div className="cloud-stats-row">
          <div className="cloud-stat-item">
            <span className="cloud-stat-label">Cloud Target</span>
            <span className="cloud-stat-val truncate" title={syncStatus.url || 'Azure Backend'}>
              {syncStatus.url ? 'Azure App Service (Connected)' : 'Local Offline Mode'}
            </span>
          </div>
          <div className="cloud-stat-item">
            <span className="cloud-stat-label">Outbox Pending</span>
            <span className={`cloud-stat-val ${syncStatus.pendingCount ? 'highlight' : ''}`}>
              {syncStatus.pendingCount || 0} reading(s)
            </span>
          </div>
          <div className="cloud-stat-item">
            <span className="cloud-stat-label">Last Synchronization</span>
            <span className="cloud-stat-val">
              {syncStatus.lastSyncedAt ? formatRelativeTime(syncStatus.lastSyncedAt) : 'Never'}
            </span>
          </div>
          <div className="cloud-stat-item">
            <span className="cloud-stat-label">Engine Status</span>
            <span className="cloud-stat-val text-good">
              {syncStatus.isSyncing ? 'Syncing...' : 'Ready / Active'}
            </span>
          </div>
        </div>
      </div>

      {/* Recent Alerts Feed */}
      <div className="home-section-header">
        <div>
          <h2 className="home-section-title">Telemetry Incidents & Threshold Violations</h2>
          <p className="home-section-subtitle">Real-time alerts triggered by pond water quality deviations</p>
        </div>
        <span className="alerts-count-badge">{alerts.length} Total Incidents</span>
      </div>

      {recentAlerts.length === 0 ? (
        <div className="empty-alerts-card">
          <span className="empty-check">✓</span>
          <span>Zero active threshold alerts. All telemetry streams are healthy.</span>
        </div>
      ) : (
        <div className="home-alerts-feed">
          {recentAlerts.map((alert) => {
            const node = knownNodes.find((n) => n.id === alert.node_id)
            const isCritical = alert.severity === 'Critical'
            return (
              <Link
                key={alert.id}
                to={`/logs/${alert.node_id}`}
                className={`feed-item severity-${alert.severity.toLowerCase()}`}
              >
                <span className="feed-item-icon">{isCritical ? '🛑' : '⚠️'}</span>
                <span className="feed-item-node">{node?.name || alert.node_id}</span>
                <span className="feed-item-message">{alert.message}</span>
                <span className="feed-item-time">{formatRelativeTime(alert.timestamp)}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default HomePage
