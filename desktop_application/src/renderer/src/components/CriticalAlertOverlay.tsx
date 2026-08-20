import { useEffect, useMemo } from 'react'
import { useReadingsStore } from '../store/useReadingsStore'
import { useAlertSound } from '../hooks/useAlertSound'

const SOUND_REPEAT_MS = 1500

function CriticalAlertOverlay(): React.JSX.Element | null {
  const alerts = useReadingsStore((s) => s.alerts)
  const soundEnabled = useReadingsStore((s) => s.settings.soundEnabled)
  const acknowledge = useReadingsStore((s) => s.acknowledge)
  const knownNodes = useReadingsStore((s) => s.knownNodes)
  const { playCritical } = useAlertSound()

  const critical = useMemo(
    () => alerts.filter((a) => a.severity === 'Critical' && !a.acknowledged),
    [alerts]
  )
  const active = critical[0] ?? null

  useEffect(() => {
    if (!active || !soundEnabled) return
    playCritical()
    const interval = setInterval(playCritical, SOUND_REPEAT_MS)
    return () => clearInterval(interval)
  }, [active, soundEnabled, playCritical])

  if (!active) return null

  async function handleAcknowledge(): Promise<void> {
    acknowledge(active!.id)
    await window.api.acknowledgeAlert(active!.id)
  }

  const nodeName = knownNodes.find((n) => n.id === active.node_id)?.name || active.node_id

  return (
    <div className="critical-overlay">
      <div className="critical-overlay-content">
        <span className="critical-overlay-badge">CRITICAL</span>
        <h2>{nodeName}</h2>
        <p>{active.message}</p>
        <button className="critical-overlay-ack-btn" onClick={handleAcknowledge}>
          Acknowledge
        </button>
        {critical.length > 1 && (
          <p className="critical-overlay-count">+{critical.length - 1} more critical alert(s)</p>
        )}
      </div>
    </div>
  )
}

export default CriticalAlertOverlay
