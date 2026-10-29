import type { Alert } from '../../../shared/types'

interface AlertListProps {
  alerts: Alert[]
  onAcknowledge: (id: number) => void
}

function AlertList({ alerts, onAcknowledge }: AlertListProps): React.JSX.Element | null {
  const active = alerts.filter((a) => !a.acknowledged)
  if (active.length === 0) return null

  return (
    <div className="alert-list">
      {active.map((alert) => {
        const isCritical = alert.severity === 'Critical'
        return (
          <div
            key={alert.id}
            className={`alert-item severity-${alert.severity.toLowerCase()}`}
          >
            <div className="alert-indicator-icon">
              {isCritical ? '🛑' : '⚠️'}
            </div>
            <div className="alert-body">
              <div className="alert-topline">
                <span className="alert-severity">{alert.severity}</span>
                <span className="alert-node-tag">{alert.node_id}</span>
                <span className="alert-time">{new Date(alert.timestamp).toLocaleTimeString()}</span>
              </div>
              <span className="alert-message">{alert.message}</span>
            </div>
            <button
              type="button"
              className="alert-ack-btn"
              onClick={() => onAcknowledge(alert.id)}
              title="Acknowledge this alert incident"
            >
              ✓ Ack
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default AlertList
