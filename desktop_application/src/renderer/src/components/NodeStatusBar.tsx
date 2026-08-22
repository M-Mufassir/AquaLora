import { useEffect, useState } from 'react'
import type { NodeStatus } from '../store/useReadingsStore'

interface NodeStatusBarProps {
  nodeId: string | null
  status: NodeStatus
}

function rssiToBars(rssi: number | null): number {
  if (rssi === null) return 0
  if (rssi >= -60) return 4
  if (rssi >= -70) return 3
  if (rssi >= -80) return 2
  if (rssi >= -90) return 1
  return 0
}

function formatRelativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return 'never'
  const deltaSec = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`
  return `${Math.floor(deltaSec / 3600)}h ago`
}

function NodeStatusBar({ nodeId, status }: NodeStatusBarProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [minutes, setMinutes] = useState(30)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  const bars = rssiToBars(status.rssi)

  async function handleApplyInterval(): Promise<void> {
    await window.api.setSamplingInterval(minutes)
    setApplyMessage(`Sent: sample every ${minutes} min`)
    setTimeout(() => setApplyMessage(null), 4000)
  }

  return (
    <div className="node-status-bar">
      <span className={`status-pill ${status.online ? 'online' : 'offline'}`}>
        {nodeId ?? 'no node'} — {status.online ? 'Online' : 'Offline'}
      </span>

      <span className="node-metric" title={`RSSI ${status.rssi ?? '--'} dBm`}>
        <span className="signal-bars">
          {[1, 2, 3, 4].map((i) => (
            <i key={i} className={`signal-bar${i <= bars ? ' filled' : ''}`} />
          ))}
        </span>
      </span>

      <span className="node-metric">
        Battery {status.batteryPct !== null ? `${status.batteryPct}%` : '--'}
      </span>

      <span className="node-metric">Last seen {formatRelativeTime(status.lastSeen, now)}</span>

      <span className="node-metric interval-control">
        <label htmlFor="interval-input">Interval</label>
        <input
          id="interval-input"
          type="number"
          min={1}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        />
        <span>min</span>
        <button className="apply-btn" onClick={handleApplyInterval} disabled={!status.online}>
          Apply
        </button>
      </span>

      {applyMessage && <span className="apply-message">{applyMessage}</span>}
    </div>
  )
}

export default NodeStatusBar
