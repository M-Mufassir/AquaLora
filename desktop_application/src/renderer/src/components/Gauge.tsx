import type { GaugeStatus } from '../../../shared/types'

export type { GaugeStatus }

interface GaugeProps {
  label: string
  value: number
  unit: string
  min: number
  max: number
  decimals?: number
  status?: GaugeStatus
  /** Categorical accent shown before a health status is known (e.g. --cat-temperature). */
  accent?: string
  size?: 'md' | 'sm'
}

const STATUS_COLOR: Record<GaugeStatus, string> = {
  normal: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  unknown: 'var(--ev-c-gray-1)'
}

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Gauge({
  label,
  value,
  unit,
  min,
  max,
  decimals = 1,
  status = 'unknown',
  accent,
  size = 'md'
}: GaugeProps): React.JSX.Element {
  const percent = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const dashOffset = CIRCUMFERENCE * (1 - percent)
  const color = status === 'unknown' && accent ? accent : STATUS_COLOR[status]

  return (
    <div className={`gauge${size === 'sm' ? ' gauge-sm' : ''}`}>
      <svg viewBox="0 0 100 100" className="gauge-ring">
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r={RADIUS} className="gauge-track" />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            stroke={color}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="gauge-value"
          />
        </g>
        <text x="50" y="46" textAnchor="middle" className="gauge-number">
          {value.toFixed(decimals)}
        </text>
        <text x="50" y="62" textAnchor="middle" className="gauge-unit">
          {unit}
        </text>
      </svg>
      <span className="gauge-label">{label}</span>
    </div>
  )
}

export default Gauge
