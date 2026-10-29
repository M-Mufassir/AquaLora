import { useMemo, useState, useRef } from 'react'
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Droplets,
  Layers,
  Sparkles,
  Thermometer,
  Waves,
  Zap,
  Clock,
  Filter,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  Wifi
} from 'lucide-react'
import { Reading, Node } from './api'

export type ParamKey = 'temperature' | 'ph' | 'turbidity' | 'tds' | 'battery_pct' | 'rssi'
export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d' | 'all'

export interface ParamMeta {
  key: ParamKey
  label: string
  unit: string
  color: string
  gradientFrom: string
  gradientTo: string
  safeMin: number
  safeMax: number
  icon: any
  decimals: number
}

export const PARAM_CONFIG: Record<ParamKey, ParamMeta> = {
  temperature: {
    key: 'temperature',
    label: 'Temperature',
    unit: '°C',
    color: '#06b6d4',
    gradientFrom: 'rgba(6, 182, 212, 0.45)',
    gradientTo: 'rgba(6, 182, 212, 0.02)',
    safeMin: 26,
    safeMax: 30,
    icon: Thermometer,
    decimals: 1
  },
  ph: {
    key: 'ph',
    label: 'pH Level',
    unit: 'pH',
    color: '#10b981',
    gradientFrom: 'rgba(16, 185, 129, 0.45)',
    gradientTo: 'rgba(16, 185, 129, 0.02)',
    safeMin: 6.5,
    safeMax: 8.5,
    icon: Droplets,
    decimals: 2
  },
  turbidity: {
    key: 'turbidity',
    label: 'Turbidity',
    unit: 'NTU',
    color: '#0ea5e9',
    gradientFrom: 'rgba(14, 165, 233, 0.45)',
    gradientTo: 'rgba(14, 165, 233, 0.02)',
    safeMin: 0,
    safeMax: 25,
    icon: Waves,
    decimals: 1
  },
  tds: {
    key: 'tds',
    label: 'Total Dissolved Solids',
    unit: 'ppm',
    color: '#f59e0b',
    gradientFrom: 'rgba(245, 158, 11, 0.45)',
    gradientTo: 'rgba(245, 158, 11, 0.02)',
    safeMin: 100,
    safeMax: 300,
    icon: Activity,
    decimals: 0
  },
  battery_pct: {
    key: 'battery_pct',
    label: 'Probe Battery',
    unit: '%',
    color: '#a855f7',
    gradientFrom: 'rgba(168, 85, 247, 0.45)',
    gradientTo: 'rgba(168, 85, 247, 0.02)',
    safeMin: 20,
    safeMax: 100,
    icon: Zap,
    decimals: 0
  },
  rssi: {
    key: 'rssi',
    label: 'LoRa Signal',
    unit: 'dBm',
    color: '#64748b',
    gradientFrom: 'rgba(100, 116, 139, 0.4)',
    gradientTo: 'rgba(100, 116, 139, 0.02)',
    safeMin: -90,
    safeMax: -40,
    icon: Wifi,
    decimals: 0
  }
}

// Generate smooth cubic bezier SVG path from coordinates
function generateSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = i < points.length - 2 ? points[i + 2] : p2

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  return d
}

// Format timestamp for display
function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return isoString
  }
}

function formatShortTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// ----------------------------------------------------------------------------
// INTERACTIVE WATER QUALITY CHART
// ----------------------------------------------------------------------------
export function WaterQualityChart({
  readings,
  nodes,
  defaultParam = 'temperature',
  initialTimeRange = '24h',
  height = 360,
  compact = false,
  showControls = true,
  title,
  subtitle
}: {
  readings: Reading[]
  nodes?: Node[]
  defaultParam?: ParamKey | 'all'
  initialTimeRange?: TimeRange
  height?: number
  compact?: boolean
  showControls?: boolean
  title?: string
  subtitle?: string
}) {
  const [activeParam, setActiveParam] = useState<ParamKey | 'all'>(defaultParam)
  const [timeRange, setTimeRange] = useState<TimeRange>(initialTimeRange)
  const [selectedNode, setSelectedNode] = useState<string>('all')
  const [selectedFacility, setSelectedFacility] = useState<string>('all')
  const [chartType, setChartType] = useState<'area' | 'line'>('area')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Multi-param toggle visibility in 'all' mode
  const [visibleParams, setVisibleParams] = useState<Record<ParamKey, boolean>>({
    temperature: true,
    ph: true,
    turbidity: true,
    tds: true,
    battery_pct: false,
    rssi: false
  })

  // Distinct facilities and nodes for dropdown filters
  const distinctFacilities = useMemo(() => {
    const map = new Map<string, string>()
    readings.forEach((r) => {
      const code = r.master_node_code || String(r.master_node_id || '')
      if (code) {
        map.set(code, r.master_node_name || code)
      }
    })
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }))
  }, [readings])

  const distinctNodes = useMemo(() => {
    return Array.from(new Set(readings.map((r) => r.node_id))).sort()
  }, [readings])

  // Filter readings by time range, facility, and node
  const filteredReadings = useMemo(() => {
    const now = Date.now()
    let cutoff = 0
    if (timeRange === '1h') cutoff = now - 1 * 60 * 60 * 1000
    else if (timeRange === '6h') cutoff = now - 6 * 60 * 60 * 1000
    else if (timeRange === '24h') cutoff = now - 24 * 60 * 60 * 1000
    else if (timeRange === '7d') cutoff = now - 7 * 24 * 60 * 60 * 1000
    else if (timeRange === '30d') cutoff = now - 30 * 24 * 60 * 60 * 1000

    return readings
      .filter((r) => {
        if (!r.timestamp) return false
        const t = new Date(r.timestamp).getTime()
        if (cutoff > 0 && t < cutoff) return false
        if (selectedNode !== 'all' && r.node_id !== selectedNode) return false
        if (
          selectedFacility !== 'all' &&
          r.master_node_code !== selectedFacility &&
          String(r.master_node_id) !== selectedFacility
        )
          return false
        return true
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [readings, timeRange, selectedNode, selectedFacility])

  // ViewBox & Layout Dimensions
  const svgWidth = 1000
  const svgHeight = height
  const padLeft = 65
  const padRight = 35
  const padTop = 30
  const padBottom = 45
  const innerWidth = svgWidth - padLeft - padRight
  const innerHeight = svgHeight - padTop - padBottom

  // Single Parameter Calculations
  const isSingleParam = activeParam !== 'all'
  const paramMeta = isSingleParam ? PARAM_CONFIG[activeParam] : null

  // Calculate Value Range & Coordinates
  const { dataPoints, minVal, maxVal, avgVal, safeZone } = useMemo(() => {
    if (!isSingleParam || !paramMeta || filteredReadings.length === 0) {
      return { dataPoints: [], minVal: 0, maxVal: 100, avgVal: 0, safeZone: null }
    }

    const values = filteredReadings
      .map((r) => r[paramMeta.key] as number | undefined)
      .filter((v): v is number => v != null && !isNaN(v))

    if (values.length === 0) {
      return { dataPoints: [], minVal: 0, maxVal: 100, avgVal: 0, safeZone: null }
    }

    const minRaw = Math.min(...values)
    const maxRaw = Math.max(...values)
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length

    // Expand bounds slightly and encompass safe range for visual reference
    let yMin = Math.min(minRaw, paramMeta.safeMin)
    let yMax = Math.max(maxRaw, paramMeta.safeMax)
    const span = yMax - yMin || 1
    yMin = Math.max(0, yMin - span * 0.12)
    yMax = yMax + span * 0.12

    // Map readings to pixel coordinates
    const points: { x: number; y: number; reading: Reading; value: number }[] = []
    const count = filteredReadings.length

    filteredReadings.forEach((reading, index) => {
      const val = reading[paramMeta.key] as number | undefined
      if (val != null && !isNaN(val)) {
        const x = padLeft + (count === 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth)
        const yRatio = (val - yMin) / (yMax - yMin)
        const y = padTop + innerHeight - yRatio * innerHeight
        points.push({ x, y, reading, value: val })
      }
    })

    // Safe zone rect coordinates
    const safeTopRatio = (paramMeta.safeMax - yMin) / (yMax - yMin)
    const safeBottomRatio = (paramMeta.safeMin - yMin) / (yMax - yMin)
    const safeZoneY = padTop + innerHeight - safeTopRatio * innerHeight
    const safeZoneHeight = (safeTopRatio - safeBottomRatio) * innerHeight

    return {
      dataPoints: points,
      minVal: minRaw,
      maxVal: maxRaw,
      avgVal: avg,
      safeZone: { y: safeZoneY, height: safeZoneHeight }
    }
  }, [filteredReadings, isSingleParam, paramMeta, innerWidth, innerHeight, padLeft, padTop])

  // Multi-Parameter Lines (Normalized 0-100% for comparative overlay)
  const multiLines = useMemo(() => {
    if (activeParam !== 'all' || filteredReadings.length === 0) return []

    const keys: ParamKey[] = ['temperature', 'ph', 'turbidity', 'tds']
    const count = filteredReadings.length

    return keys
      .filter((k) => visibleParams[k])
      .map((key) => {
        const meta = PARAM_CONFIG[key]
        const vals = filteredReadings
          .map((r) => r[key] as number | undefined)
          .filter((v): v is number => v != null && !isNaN(v))

        const min = vals.length ? Math.min(...vals) : 0
        const max = vals.length ? Math.max(...vals) : 100
        const span = max - min || 1

        const points = filteredReadings
          .map((reading, index) => {
            const val = reading[key] as number | undefined
            if (val == null || isNaN(val)) return null
            const x = padLeft + (count === 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth)
            const ratio = (val - min) / span
            const y = padTop + innerHeight - ratio * innerHeight
            return { x, y, reading, value: val }
          })
          .filter(Boolean) as { x: number; y: number; reading: Reading; value: number }[]

        const linePath = generateSmoothPath(points)
        return { key, meta, points, path: linePath }
      })
  }, [activeParam, filteredReadings, visibleParams, innerWidth, innerHeight, padLeft, padTop])

  // SVG Paths for single param
  const linePath = useMemo(() => generateSmoothPath(dataPoints), [dataPoints])
  const areaPath = useMemo(() => {
    if (dataPoints.length === 0) return ''
    const baseLineY = padTop + innerHeight
    const first = dataPoints[0]
    const last = dataPoints[dataPoints.length - 1]
    return `${linePath} L ${last.x.toFixed(1)} ${baseLineY} L ${first.x.toFixed(1)} ${baseLineY} Z`
  }, [linePath, dataPoints, padTop, innerHeight])

  // Grid Horizontal Lines & Ticks (5 intervals)
  const gridTicks = useMemo(() => {
    if (!isSingleParam) {
      return [0, 25, 50, 75, 100].map((pct) => ({
        y: padTop + innerHeight - (pct / 100) * innerHeight,
        label: `${pct}%`
      }))
    }
    const ticks = []
    const count = 5
    for (let i = 0; i <= count; i++) {
      const ratio = i / count
      const y = padTop + innerHeight - ratio * innerHeight
      const val = minVal + ratio * (maxVal - minVal)
      ticks.push({
        y,
        label: `${val.toFixed(paramMeta?.decimals ?? 1)}${paramMeta?.unit ? ` ${paramMeta.unit}` : ''}`
      })
    }
    return ticks
  }, [isSingleParam, minVal, maxVal, paramMeta, innerHeight, padTop])

  // X-axis Time Labels
  const timeLabels = useMemo(() => {
    if (filteredReadings.length === 0) return []
    const count = Math.min(6, filteredReadings.length)
    const labels = []
    for (let i = 0; i < count; i++) {
      const idx = Math.floor((i / (count - 1 || 1)) * (filteredReadings.length - 1))
      const reading = filteredReadings[idx]
      const x = padLeft + (i / (count - 1 || 1)) * innerWidth
      labels.push({ x, text: formatShortTime(reading.timestamp) })
    }
    return labels
  }, [filteredReadings, innerWidth, padLeft])

  // Mouse interaction handler
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dataPoints.length === 0 && multiLines.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth

    // Find closest index
    const points = isSingleParam ? dataPoints : multiLines[0]?.points || []
    if (!points.length) return

    let closestIdx = 0
    let minDist = Infinity
    points.forEach((pt, idx) => {
      const dist = Math.abs(pt.x - mouseX)
      if (dist < minDist) {
        minDist = dist
        closestIdx = idx
      }
    })

    setHoverIndex(closestIdx)
  }

  const activeHoverPoint =
    hoverIndex !== null && isSingleParam && dataPoints[hoverIndex] ? dataPoints[hoverIndex] : null

  const activeHoverReading =
    hoverIndex !== null && filteredReadings[hoverIndex] ? filteredReadings[hoverIndex] : null

  return (
    <div
      ref={containerRef}
      className={`rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden transition-all duration-300 ${
        compact ? 'p-4 sm:p-5' : 'p-6'
      }`}
    >
      {/* Header Controls & Title */}
      {showControls && (
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-700">
                Live Sensor Intelligence
              </p>
            </div>
            <h3 className="mt-1 font-display text-lg sm:text-xl font-bold text-slate-900">
              {title || 'Water Quality Telemetry Studio'}
            </h3>
            <p className="text-xs text-slate-500">
              {subtitle || 'Interactive multi-probe parameter telemetry curves and target threshold monitoring.'}
            </p>
          </div>

          {/* Time Range Selector & Param Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Time Ranges */}
            <div className="flex items-center rounded-xl bg-slate-100 dark:bg-black/20 p-1 border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-600 dark:text-slate-300">
              {(['1h', '6h', '24h', '7d', '30d', 'all'] as TimeRange[]).map((tr) => (
                <button
                  key={tr}
                  onClick={() => setTimeRange(tr)}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    timeRange === tr
                      ? 'bg-white dark:bg-[#0b2230] text-cyan-700 dark:text-cyan-400 shadow-sm font-extrabold'
                      : 'hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tr.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Facility Filter */}
            {distinctFacilities.length > 1 && (
              <select
                value={selectedFacility}
                onChange={(e) => setSelectedFacility(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#071926] px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none hover:bg-slate-50 dark:hover:bg-white/5"
              >
                <option value="all">All Facilities ({distinctFacilities.length})</option>
                {distinctFacilities.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
            )}

            {/* Node Filter */}
            {distinctNodes.length > 1 && (
              <select
                value={selectedNode}
                onChange={(e) => setSelectedNode(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#071926] px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none hover:bg-slate-50 dark:hover:bg-white/5"
              >
                <option value="all">All Probes ({distinctNodes.length})</option>
                {distinctNodes.map((id) => (
                  <option key={id} value={id}>
                    Probe {id}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Parameter Switch Tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveParam('all')}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
            activeParam === 'all'
              ? 'bg-slate-900 dark:bg-cyan-600 text-white shadow-md'
              : 'border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
          }`}
        >
          <Layers size={13} />
          <span>Multi-Param Overlay</span>
        </button>

        {(['temperature', 'ph', 'turbidity', 'tds'] as ParamKey[]).map((key) => {
          const meta = PARAM_CONFIG[key]
          const Icon = meta.icon
          const isActive = activeParam === key
          return (
            <button
              key={key}
              onClick={() => setActiveParam(key)}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                isActive
                  ? 'text-white shadow-md'
                  : 'border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
              style={{
                backgroundColor: isActive ? meta.color : undefined
              }}
            >
              <Icon size={14} />
              <span>{meta.label}</span>
              <span className="text-[10px] opacity-80">({meta.unit})</span>
            </button>
          )
        })}
      </div>

      {/* Main SVG Chart Area */}
      <div className="relative mt-4 w-full">
        {filteredReadings.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/5 p-12 text-center"
            style={{ height }}
          >
            <BarChart3 className="text-slate-300 dark:text-slate-600" size={36} />
            <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">No telemetry recorded for this filter</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 max-w-sm">
              Adjust your time range or node filters to inspect sensor data streams.
            </p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-b from-slate-50/60 to-white dark:from-[#061722]/80 dark:to-[#071926] border border-slate-100 dark:border-white/10 p-2">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-auto overflow-visible select-none"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                {/* Area Gradient for Single Parameter */}
                {paramMeta && (
                  <linearGradient id={`grad-${paramMeta.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={paramMeta.color} stopOpacity="0.32" />
                    <stop offset="85%" stopColor={paramMeta.color} stopOpacity="0.04" />
                    <stop offset="100%" stopColor={paramMeta.color} stopOpacity="0.0" />
                  </linearGradient>
                )}

                {/* Drop shadow filter for active point */}
                <filter id="point-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#06b6d4" floodOpacity="0.6" />
                </filter>
              </defs>

              {/* Target Safety Zone (Translucent Band with Boundary Lines) */}
              {isSingleParam && safeZone && (
                <g className="safety-band">
                  <rect
                    x={padLeft}
                    y={safeZone.y}
                    width={innerWidth}
                    height={safeZone.height}
                    fill="rgba(16, 185, 129, 0.06)"
                    rx="4"
                  />
                  {/* Upper safety boundary */}
                  <line
                    x1={padLeft}
                    y1={safeZone.y}
                    x2={padLeft + innerWidth}
                    y2={safeZone.y}
                    stroke="rgba(16, 185, 129, 0.35)"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                  <text
                    x={padLeft + 10}
                    y={safeZone.y - 5}
                    fontSize="10"
                    fontWeight="700"
                    fill="#10b981"
                  >
                    Target Max: {paramMeta?.safeMax} {paramMeta?.unit}
                  </text>

                  {/* Lower safety boundary */}
                  <line
                    x1={padLeft}
                    y1={safeZone.y + safeZone.height}
                    x2={padLeft + innerWidth}
                    y2={safeZone.y + safeZone.height}
                    stroke="rgba(16, 185, 129, 0.35)"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                  <text
                    x={padLeft + 10}
                    y={safeZone.y + safeZone.height + 12}
                    fontSize="10"
                    fontWeight="700"
                    fill="#10b981"
                  >
                    Target Min: {paramMeta?.safeMin} {paramMeta?.unit}
                  </text>
                </g>
              )}

              {/* Horizontal Grid lines & Y-axis labels */}
              {gridTicks.map((tick, i) => (
                <g key={i}>
                  <line
                    x1={padLeft}
                    y1={tick.y}
                    x2={padLeft + innerWidth}
                    y2={tick.y}
                    className="stroke-slate-200 dark:stroke-white/10"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 10}
                    y={tick.y + 3.5}
                    textAnchor="end"
                    fontSize="10"
                    fontWeight="600"
                    fill="#94a3b8"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {/* X-axis Bottom Line */}
              <line
                x1={padLeft}
                y1={padTop + innerHeight}
                x2={padLeft + innerWidth}
                y2={padTop + innerHeight}
                stroke="#cbd5e1"
                strokeWidth="1.5"
              />

              {/* X-axis Time Labels */}
              {timeLabels.map((lbl, i) => (
                <text
                  key={i}
                  x={lbl.x}
                  y={padTop + innerHeight + 22}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill="#64748b"
                >
                  {lbl.text}
                </text>
              ))}

              {/* Single Parameter Area & Curve */}
              {isSingleParam && paramMeta && (
                <g>
                  {chartType === 'area' && areaPath && (
                    <path d={areaPath} fill={`url(#grad-${paramMeta.key})`} />
                  )}
                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke={paramMeta.color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Discrete Point Circles */}
                  {dataPoints.length < 50 &&
                    dataPoints.map((pt, i) => (
                      <circle
                        key={i}
                        cx={pt.x}
                        cy={pt.y}
                        r="3.5"
                        fill="#ffffff"
                        stroke={paramMeta.color}
                        strokeWidth="2"
                        className="transition-transform hover:scale-150"
                      />
                    ))}
                </g>
              )}

              {/* Multi-Parameter Mode Curves */}
              {!isSingleParam &&
                multiLines.map((line) => (
                  <g key={line.key}>
                    <path
                      d={line.path}
                      fill="none"
                      stroke={line.meta.color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    {line.points.length < 35 &&
                      line.points.map((pt, idx) => (
                        <circle
                          key={idx}
                          cx={pt.x}
                          cy={pt.y}
                          r="3"
                          fill="#ffffff"
                          stroke={line.meta.color}
                          strokeWidth="2"
                        />
                      ))}
                  </g>
                ))}

              {/* Hover Crosshair & Snap Point */}
              {activeHoverPoint && isSingleParam && paramMeta && (
                <g className="pointer-events-none">
                  {/* Vertical Guide Line */}
                  <line
                    x1={activeHoverPoint.x}
                    y1={padTop}
                    x2={activeHoverPoint.x}
                    y2={padTop + innerHeight}
                    stroke={paramMeta.color}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    opacity="0.75"
                  />

                  {/* Pulsating Glowing Outer Ring */}
                  <circle
                    cx={activeHoverPoint.x}
                    cy={activeHoverPoint.y}
                    r="8"
                    fill={paramMeta.color}
                    opacity="0.25"
                    className="animate-ping"
                  />

                  {/* Marker Dot */}
                  <circle
                    cx={activeHoverPoint.x}
                    cy={activeHoverPoint.y}
                    r="5"
                    fill="#ffffff"
                    stroke={paramMeta.color}
                    strokeWidth="3"
                  />
                </g>
              )}
            </svg>

            {/* Floating Rich Tooltip */}
            {hoverIndex !== null && activeHoverReading && (
              <div
                className="absolute z-20 pointer-events-none rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#0b2230]/95 p-3 shadow-xl backdrop-blur-md transition-all text-xs text-slate-800 dark:text-slate-100"
                style={{
                  top: '16px',
                  right: '16px',
                  minWidth: '220px'
                }}
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-2">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-white">
                    <span className="flex h-2 w-2 rounded-full bg-cyan-500" />
                    <span>Probe {activeHoverReading.node_id}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    {formatTimestamp(activeHoverReading.timestamp)}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1.5">
                  {isSingleParam && paramMeta ? (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">{paramMeta.label}:</span>
                      <span
                        className="font-display font-extrabold text-sm"
                        style={{ color: paramMeta.color }}
                      >
                        {Number(activeHoverReading[paramMeta.key])?.toFixed(paramMeta.decimals)} {paramMeta.unit}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Temp:</span>
                        <span className="font-bold text-cyan-600">
                          {activeHoverReading.temperature != null ? `${activeHoverReading.temperature}°C` : '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">pH:</span>
                        <span className="font-bold text-emerald-600">
                          {activeHoverReading.ph != null ? activeHoverReading.ph.toFixed(2) : '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Turbidity:</span>
                        <span className="font-bold text-sky-600">
                          {activeHoverReading.turbidity != null ? `${activeHoverReading.turbidity} NTU` : '--'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">TDS:</span>
                        <span className="font-bold text-amber-600">
                          {activeHoverReading.tds != null ? `${activeHoverReading.tds} ppm` : '--'}
                        </span>
                      </div>
                    </>
                  )}

                  {activeHoverReading.master_node_name && (
                    <p className="text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
                      Facility: {activeHoverReading.master_node_name}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Summary Bar for Single Parameter */}
      {isSingleParam && paramMeta && filteredReadings.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-100 pt-4">
          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Period Average
            </span>
            <p className="mt-0.5 font-display text-base font-bold text-slate-900">
              {avgVal.toFixed(paramMeta.decimals)} {paramMeta.unit}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Min Recorded
            </span>
            <p className="mt-0.5 font-display text-base font-bold text-emerald-600">
              {minVal.toFixed(paramMeta.decimals)} {paramMeta.unit}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Max Recorded
            </span>
            <p className="mt-0.5 font-display text-base font-bold text-rose-600">
              {maxVal.toFixed(paramMeta.decimals)} {paramMeta.unit}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 p-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Safe Target Band
            </span>
            <p className="mt-0.5 font-display text-base font-bold text-cyan-700">
              {paramMeta.safeMin} – {paramMeta.safeMax} {paramMeta.unit}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// INLINE MINI SPARKLINE FOR STAT TILES
// ----------------------------------------------------------------------------
export function MiniSparkline({
  values,
  color = '#06b6d4',
  width = 90,
  height = 30
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
}) {
  const path = useMemo(() => {
    if (!values || values.length < 2) return ''
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const pad = 2

    const points = values.map((v, i) => ({
      x: pad + (i / (values.length - 1)) * (width - pad * 2),
      y: height - pad - ((v - min) / span) * (height - pad * 2)
    }))

    return generateSmoothPath(points)
  }, [values, width, height])

  if (!path) return null

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ----------------------------------------------------------------------------
// GLOBAL FLEET WATER QUALITY HEALTH GAUGE (0 - 100)
// ----------------------------------------------------------------------------
export function FleetHealthGauge({
  score = 92,
  size = 110
}: {
  score?: number
  size?: number
}) {
  const radius = (size - 18) / 2
  const circ = 2 * Math.PI * radius
  const strokeDashoffset = circ - (score / 100) * circ

  let color = '#10b981' // emerald
  let label = 'Optimal'
  if (score < 70) {
    color = '#f43f5e'
    label = 'Critical'
  } else if (score < 85) {
    color = '#f59e0b'
    label = 'Caution'
  }

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-slate-200 dark:stroke-white/10"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-2xl font-black text-slate-900 dark:text-white leading-none">{score}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 mt-1">{label}</span>
      </div>
    </div>
  )
}
