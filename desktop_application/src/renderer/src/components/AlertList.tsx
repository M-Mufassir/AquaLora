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
      {active.map((alert) => (
        <div key={alert.id} className={`alert-item severity-${alert.severity.toLowerCase()}`}>
          <div className="alert-body">
            <span className="alert-severity">{alert.severity}</span>
            <span className="alert-message">{alert.message}</span>
            <span className="alert-time">{new Date(alert.timestamp).toLocaleTimeString()}</span>
          </div>
          <button className="alert-ack-btn" onClick={() => onAcknowledge(alert.id)}>
            Acknowledge
          </button>
        </div>
      ))}
    </div>
  )
}

export default AlertList
