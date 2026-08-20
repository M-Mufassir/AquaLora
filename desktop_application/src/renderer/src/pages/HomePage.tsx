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

  const counts = useMemo(() => {
    const c = { Good: 0, Warning: 0, Critical: 0, Offline: 0 }
    for (const node of knownNodes) {
      const state = nodesById[node.id] ?? EMPTY_NODE_STATE
      c[deriveStatusTier(state.latestScore, state.status.online)]++
    }
    return c
  }, [knownNodes, nodesById])

  const recentAlerts = alerts.slice(0, 8)

  return (
    <div className="page home-page">
      <div>
        <h1>Fleet Overview</h1>
        <p className="page-subtitle">
          Live status across every registered node — click a card for full detail and history.
        </p>
      </div>

      <div className="home-stats">
        <div className="stat-tile">
          <span className="stat-tile-value">{knownNodes.length}</span>
          <span className="stat-tile-label">Total Nodes</span>
        </div>
        <div className="stat-tile stat-good">
          <span className="stat-tile-value">{counts.Good}</span>
          <span className="stat-tile-label">Good</span>
        </div>
        <div className="stat-tile stat-warning">
          <span className="stat-tile-value">{counts.Warning}</span>
          <span className="stat-tile-label">Warning</span>
        </div>
        <div className="stat-tile stat-critical">
          <span className="stat-tile-value">{counts.Critical}</span>
          <span className="stat-tile-label">Critical</span>
        </div>
        <div className="stat-tile stat-offline">
          <span className="stat-tile-value">{counts.Offline}</span>
          <span className="stat-tile-label">Offline</span>
        </div>
      </div>

      <h2 className="home-section-title">Nodes</h2>
      {knownNodes.length === 0 ? (
        <p className="status">No nodes yet — add one from the Logs page.</p>
      ) : (
        <div className="node-summary-grid">
          {knownNodes.map((node) => (
            <NodeSummaryCard key={node.id} node={node} state={nodesById[node.id] ?? EMPTY_NODE_STATE} />
          ))}
        </div>
      )}

      <h2 className="home-section-title">Recent Alerts</h2>
      {recentAlerts.length === 0 ? (
        <p className="status">No alerts recorded yet.</p>
      ) : (
        <div className="home-alerts-feed">
          {recentAlerts.map((alert) => {
            const node = knownNodes.find((n) => n.id === alert.node_id)
            return (
              <Link
                key={alert.id}
                to={`/logs/${alert.node_id}`}
                className={`feed-item severity-${alert.severity.toLowerCase()}`}
              >
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
