import { Link } from 'react-router-dom'
import { deriveStatusTier, deriveParamStatus } from '../../../shared/types'
import type { NodeRow } from '../../../shared/types'
import type { NodeState } from '../store/useReadingsStore'
import Gauge from './Gauge'

interface NodeSummaryCardProps {
  node: NodeRow
  state: NodeState
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const deltaSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`
  return `${Math.floor(deltaSec / 3600)}h ago`
}

function NodeSummaryCard({ node, state }: NodeSummaryCardProps): React.JSX.Element {
  const tier = deriveStatusTier(state.latestScore, state.status.online)

  return (
    <Link to={`/logs/${node.id}`} className={`node-summary-card tier-${tier.toLowerCase()}`}>
      <div className="node-summary-header">
        <span className="node-summary-name">{node.name || node.id}</span>
        <span className={`tier-badge tier-${tier.toLowerCase()}`}>{tier}</span>
      </div>
      {node.location && <span className="node-summary-location">{node.location}</span>}

      {state.latest ? (
        <>
          <div className="node-summary-gauges">
            <Gauge
              label="Temp"
              value={state.latest.temperature}
              unit="°C"
              min={0}
              max={40}
              size="sm"
              status={deriveParamStatus(state.latestScore, 'temperature')}
              accent="var(--cat-temperature)"
            />
            <Gauge
              label="Turbidity"
              value={state.latest.turbidity}
              unit="NTU"
              min={0}
              max={100}
              size="sm"
              status={deriveParamStatus(state.latestScore, 'turbidity')}
              accent="var(--cat-turbidity)"
            />
            <Gauge
              label="TDS"
              value={state.latest.tds}
              unit="ppm"
              min={0}
              max={500}
              decimals={0}
              size="sm"
              status={deriveParamStatus(state.latestScore, 'tds')}
              accent="var(--cat-tds)"
            />
          </div>
          <div className="node-summary-meta">
            <span>Battery {state.status.batteryPct ?? '--'}%</span>
            <span>RSSI {state.status.rssi ?? '--'} dBm</span>
            <span>{formatRelativeTime(state.status.lastSeen)}</span>
          </div>
        </>
      ) : (
        <span className="node-summary-empty">No readings yet</span>
      )}
    </Link>
  )
}

export default NodeSummaryCard
