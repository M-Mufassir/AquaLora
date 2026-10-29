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
    <div className="critical-overlay" role="alertdialog" aria-modal="true" aria-labelledby="critical-alert-title">
      <div className="critical-overlay-content">
        {/* Pulsing warning beacon icon */}
        <div className="critical-beacon">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <div className="critical-header-group">
          <span className="critical-overlay-badge">
            <span className="critical-dot-pulse" />
            CRITICAL TELEMETRY ALERT
          </span>
          <h2 id="critical-alert-title">{nodeName}</h2>
        </div>

        <div className="critical-message-box">
          <p className="critical-message-text">{active.message}</p>
          <div className="critical-meta-strip">
            <span>Probe ID: <strong>{active.node_id}</strong></span>
            <span>Triggered: <strong>{new Date(active.timestamp).toLocaleTimeString()}</strong></span>
          </div>
        </div>

        <div className="critical-action-group">
          <button
            type="button"
            className="critical-overlay-ack-btn"
            onClick={handleAcknowledge}
            autoFocus
          >
            ✓ Acknowledge & Silence Alarm
          </button>
          {critical.length > 1 && (
            <span className="critical-overlay-count">
              +{critical.length - 1} additional critical warning(s) queued
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default CriticalAlertOverlay
