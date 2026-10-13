import { useMemo, useState } from 'react'
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Battery,
  BatteryCharging,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Droplets,
  Edit3,
  Eye,
  Filter,
  Layers,
  MapPin,
  Maximize2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Waves,
  Wifi,
  X
} from 'lucide-react'
import {
  Alert,
  api,
  DashboardStats,
  deleteMasterNode,
  exportReadingsToCsv,
  Node,
  Reading
} from './api'
import { MiniSparkline, WaterQualityChart } from './TelemetryChart'

export const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 shadow-sm'

export const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-sky-600/20 transition hover:from-sky-500 hover:to-cyan-500 active:scale-[0.99] disabled:opacity-50'

export function formatDate(value?: string | null): string {
  if (!value) return 'N/A'
  try {
    const d = new Date(value)
    if (isNaN(d.getTime())) return String(value)
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return String(value)
  }
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Never'
  try {
    const date = new Date(value)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 10) return 'Just now'
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  } catch {
    return 'Recently'
  }
}

export function getFishHealthStatus(reading: Reading): {
  status: 'Optimal' | 'Caution' | 'Critical'
  color: 'emerald' | 'amber' | 'rose'
  reason?: string
} {
  const { temperature, ph, turbidity, tds } = reading
  if (ph != null && (ph < 6.0 || ph > 9.0)) {
    return { status: 'Critical', color: 'rose', reason: `pH out of safe range (${ph})` }
  }
  if (temperature != null && (temperature < 20 || temperature > 34)) {
    return { status: 'Critical', color: 'rose', reason: `Water temperature extreme (${temperature}°C)` }
  }
  if (turbidity != null && turbidity > 50) {
    return { status: 'Caution', color: 'amber', reason: `Elevated turbidity (${turbidity} NTU)` }
  }
  if (tds != null && tds > 1200) {
    return { status: 'Caution', color: 'amber', reason: `High TDS (${tds} ppm)` }
  }
  if (ph != null && (ph < 6.5 || ph > 8.5)) {
    return { status: 'Caution', color: 'amber', reason: `pH sub-optimal (${ph})` }
  }
  return { status: 'Optimal', color: 'emerald' }
}

export function Tag({
  children,
  color = 'blue'
}: {
  children: React.ReactNode
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'cyan' | 'purple'
}) {
  const styles = {
    blue: 'bg-sky-50 text-sky-700 ring-sky-200/80',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200/80',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200/80',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200/80',
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    cyan: 'bg-cyan-50 text-cyan-800 ring-cyan-200/80',
    purple: 'bg-purple-50 text-purple-700 ring-purple-200/80'
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-tight ring-1 ${
        styles[color] ?? styles.blue
      }`}
    >
      {children}
    </span>
  )
}

export function PageTitle({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">{eyebrow}</p>
        </div>
        <h1 className="mt-1 font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2.5">{action}</div>}
    </div>
  )
}

// ============================================================================
// LATEST READINGS LIVE FEED & PER-NODE CARDS
// ============================================================================
export function LiveLatestReadingsSection({
  readings,
  nodes,
  onInspectNode
}: {
  readings: Reading[]
  nodes: Node[]
  onInspectNode?: (nodeId: string) => void
}) {
  const [mode, setMode] = useState<'per_node' | 'live_stream'>('per_node')
  const [filterPond, setFilterPond] = useState<string>('all')

  // Compute the absolute latest reading for each distinct node
  const latestByNode = useMemo(() => {
    const map = new Map<string, Reading>()
    for (const r of readings) {
      const key = r.node_id
      if (!map.has(key)) {
        map.set(key, r)
      } else {
        const existing = map.get(key)!
        if (new Date(r.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
          map.set(key, r)
        }
      }
    }
    return Array.from(map.values())
  }, [readings])

  const displayedReadings = useMemo(() => {
    let list = mode === 'per_node' ? latestByNode : readings.slice(0, 24)
    if (filterPond !== 'all') {
      list = list.filter((r) => (r.pond_type || 'tilapia').toLowerCase() === filterPond.toLowerCase())
    }
    return list
  }, [mode, latestByNode, readings, filterPond])

  const pondTypes = useMemo(() => {
    const set = new Set<string>()
    readings.forEach((r) => {
      if (r.pond_type) set.add(r.pond_type)
    })
    return Array.from(set)
  }, [readings])

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
            </span>
            <h3 className="font-display text-lg font-bold text-slate-900">
              Live Sensor Readings & Ponds
            </h3>
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800">
              {latestByNode.length} Active Nodes
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Real-time telemetry stream synchronized across all IoT LoRa probe stations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Pond filter */}
          {pondTypes.length > 0 && (
            <select
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 outline-none hover:bg-slate-100"
            >
              <option value="all">All Pond Profiles</option>
              {pondTypes.map((pt) => (
                <option key={pt} value={pt}>
                  {pt.charAt(0).toUpperCase() + pt.slice(1)} Ponds
                </option>
              ))}
            </select>
          )}

          {/* View mode toggle */}
          <div className="flex rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setMode('per_node')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                mode === 'per_node'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Latest per Pond ({latestByNode.length})
            </button>
            <button
              onClick={() => setMode('live_stream')}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                mode === 'live_stream'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Stream Feed (Last {Math.min(readings.length, 24)})
            </button>
          </div>
        </div>
      </div>

      {/* Grid of live sensor cards */}
      <div className="mt-6">
        {displayedReadings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
            <Waves className="mx-auto h-10 w-10 text-slate-300" />
            <h4 className="mt-3 font-display font-bold text-slate-700">No telemetry readings received yet</h4>
            <p className="mt-1 text-sm text-slate-500">
              Sensor readings captured by the desktop gateway will automatically sync and appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayedReadings.map((reading, idx) => {
              const health = getFishHealthStatus(reading)
              return (
                <div
                  key={`${reading.node_id}-${reading.timestamp}-${idx}`}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4.5 shadow-sm transition hover:border-cyan-300 hover:shadow-md"
                >
                  {/* Top Bar: Node ID + Health Status */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-slate-900">
                            {reading.node_id}
                          </span>
                          <Tag color="cyan">{reading.pond_type || 'Tilapia'}</Tag>
                        </div>
                        {reading.master_node_code && (
                          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">
                            Facility: {reading.master_node_name || reading.master_node_code}
                          </p>
                        )}
                      </div>

                      <Tag color={health.color}>
                        {health.status === 'Optimal' && <CheckCircle2 size={11} />}
                        {health.status === 'Caution' && <AlertTriangle size={11} />}
                        {health.status === 'Critical' && <AlertOctagon size={11} />}
                        {health.status}
                      </Tag>
                    </div>

                    {/* Parameters Grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2.5">
                      {/* Temperature */}
                      <div className="rounded-xl bg-slate-50 p-2.5 transition group-hover:bg-cyan-50/50">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                          <Thermometer size={14} className="text-cyan-600" />
                          <span>Temperature</span>
                        </div>
                        <p className="mt-1 font-display text-lg font-bold text-slate-900">
                          {reading.temperature != null ? `${reading.temperature}°C` : '--'}
                        </p>
                      </div>

                      {/* pH */}
                      <div className="rounded-xl bg-slate-50 p-2.5 transition group-hover:bg-cyan-50/50">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                          <Droplets size={14} className="text-emerald-600" />
                          <span>pH Balance</span>
                        </div>
                        <p className="mt-1 font-display text-lg font-bold text-slate-900">
                          {reading.ph != null ? reading.ph.toFixed(2) : '--'}
                        </p>
                      </div>

                      {/* Turbidity */}
                      <div className="rounded-xl bg-slate-50 p-2.5 transition group-hover:bg-cyan-50/50">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                          <Waves size={14} className="text-sky-600" />
                          <span>Turbidity</span>
                        </div>
                        <p className="mt-1 font-display text-lg font-bold text-slate-900">
                          {reading.turbidity != null ? `${reading.turbidity} NTU` : '--'}
                        </p>
                      </div>

                      {/* TDS */}
                      <div className="rounded-xl bg-slate-50 p-2.5 transition group-hover:bg-cyan-50/50">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                          <Activity size={14} className="text-amber-600" />
                          <span>TDS</span>
                        </div>
                        <p className="mt-1 font-display text-lg font-bold text-slate-900">
                          {reading.tds != null ? `${reading.tds} ppm` : '--'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Footer: Battery, RSSI, Timestamp */}
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <div className="flex items-center gap-3">
                      {reading.battery_pct != null && (
                        <span
                          className={`flex items-center gap-1 font-semibold ${
                            reading.battery_pct < 25 ? 'text-rose-600' : 'text-slate-600'
                          }`}
                          title={`Probe Battery: ${reading.battery_pct}%`}
                        >
                          <Battery size={13} /> {reading.battery_pct}%
                        </span>
                      )}
                      {reading.rssi != null && (
                        <span
                          className="flex items-center gap-1 font-semibold text-slate-500"
                          title={`LoRa RSSI: ${reading.rssi} dBm`}
                        >
                          <Wifi size={13} /> {reading.rssi} dBm
                        </span>
                      )}
                    </div>
                    <span
                      className="font-medium text-slate-400"
                      title={formatDate(reading.timestamp)}
                    >
                      {formatRelativeTime(reading.timestamp)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TELEMETRY VIEW & HISTORICAL ANALYTICS
// ============================================================================
export function TelemetryView({
  readings,
  nodes,
  reload
}: {
  readings: Reading[]
  nodes: Node[]
  reload: () => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [selectedNode, setSelectedNode] = useState('all')
  const [selectedFacility, setSelectedFacility] = useState('all')
  const [healthFilter, setHealthFilter] = useState<'all' | 'Optimal' | 'Caution' | 'Critical'>('all')
  const [pageSize, setPageSize] = useState<number>(50)
  const [page, setPage] = useState<number>(1)

  const distinctNodes = useMemo(() => {
    return Array.from(new Set(readings.map((r) => r.node_id))).sort()
  }, [readings])

  const filtered = useMemo(() => {
    return readings.filter((r) => {
      if (selectedNode !== 'all' && r.node_id !== selectedNode) return false
      if (
        selectedFacility !== 'all' &&
        r.master_node_code !== selectedFacility &&
        String(r.master_node_id) !== selectedFacility
      )
        return false
      if (healthFilter !== 'all') {
        const h = getFishHealthStatus(r)
        if (h.status !== healthFilter) return false
      }
      if (search) {
        const text = `${r.node_id} ${r.pond_type ?? ''} ${r.master_node_code ?? ''} ${r.master_node_name ?? ''}`.toLowerCase()
        if (!text.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [readings, selectedNode, selectedFacility, healthFilter, search])

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const totalPages = Math.ceil(filtered.length / pageSize) || 1

  // Summary Metrics & Compliance
  const stats = useMemo(() => {
    const temps = filtered.map((r) => r.temperature).filter((v): v is number => v != null)
    const phs = filtered.map((r) => r.ph).filter((v): v is number => v != null)
    const turbidities = filtered.map((r) => r.turbidity).filter((v): v is number => v != null)
    const tdss = filtered.map((r) => r.tds).filter((v): v is number => v != null)

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
    const min = (arr: number[]) => (arr.length ? Math.min(...arr) : null)
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null)

    const tempCompliance = temps.length
      ? Math.round((temps.filter((t) => t >= 26 && t <= 30).length / temps.length) * 100)
      : 100
    const phCompliance = phs.length
      ? Math.round((phs.filter((p) => p >= 6.5 && p <= 8.5).length / phs.length) * 100)
      : 100
    const turbCompliance = turbidities.length
      ? Math.round((turbidities.filter((tb) => tb <= 30).length / turbidities.length) * 100)
      : 100
    const tdsCompliance = tdss.length
      ? Math.round((tdss.filter((td) => td <= 1000).length / tdss.length) * 100)
      : 100

    return {
      temp: {
        avg: avg(temps),
        min: min(temps),
        max: max(temps),
        compliance: tempCompliance,
        spark: temps.slice(-20)
      },
      ph: {
        avg: avg(phs),
        min: min(phs),
        max: max(phs),
        compliance: phCompliance,
        spark: phs.slice(-20)
      },
      turbidity: {
        avg: avg(turbidities),
        min: min(turbidities),
        max: max(turbidities),
        compliance: turbCompliance,
        spark: turbidities.slice(-20)
      },
      tds: {
        avg: avg(tdss),
        min: min(tdss),
        max: max(tdss),
        compliance: tdsCompliance,
        spark: tdss.slice(-20)
      }
    }
  }, [filtered])

  return (
    <div className="animate-rise space-y-7">
      <PageTitle
        eyebrow="Telemetry Intelligence"
        title="Water Quality Analytics & Chart Studio"
        description="Interactive time-series telemetry scrubber with safe range boundaries, multi-probe comparison, and statistical compliance."
        action={
          <>
            <button
              onClick={() => exportReadingsToCsv(filtered, `aqualora-telemetry-${Date.now()}.csv`)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              title="Download filtered records as CSV"
            >
              <Download size={16} /> Export CSV ({filtered.length})
            </button>
            <button onClick={() => void reload()} className={buttonClass}>
              <RefreshCw size={16} /> Refresh Stream
            </button>
          </>
        }
      />

      {/* Hero Interactive Chart Studio Card */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
        <WaterQualityChart
          readings={readings}
          nodes={nodes}
          height={380}
          showControls={true}
          defaultParam="temperature"
          initialTimeRange="24h"
          title="Telemetry Trajectory & Safety Boundaries"
          subtitle="Real-time multi-probe stream with safe zone envelopes and interactive crosshair inspection"
        />
      </div>

      {/* Parameter Analytics & Compliance Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Temperature Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-cyan-50 p-2 text-cyan-700">
                <Thermometer size={18} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Temperature
              </span>
            </div>
            <Tag color={stats.temp.compliance >= 90 ? 'emerald' : stats.temp.compliance >= 70 ? 'amber' : 'rose'}>
              {stats.temp.compliance}% Safe
            </Tag>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="font-display text-3xl font-extrabold text-slate-900">
                {stats.temp.avg != null ? `${stats.temp.avg.toFixed(1)}°C` : '--'}
              </p>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Average reading</p>
            </div>
            {stats.temp.spark.length > 1 && (
              <div className="pb-1">
                <MiniSparkline values={stats.temp.spark} color="#06b6d4" width={95} height={32} />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
            <span>Min: <strong>{stats.temp.min != null ? `${stats.temp.min.toFixed(1)}°C` : '--'}</strong></span>
            <span>Max: <strong>{stats.temp.max != null ? `${stats.temp.max.toFixed(1)}°C` : '--'}</strong></span>
            <span className="font-bold text-cyan-700">Safe: 26-30°C</span>
          </div>
        </div>

        {/* pH Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
                <Droplets size={18} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                pH Level
              </span>
            </div>
            <Tag color={stats.ph.compliance >= 90 ? 'emerald' : stats.ph.compliance >= 70 ? 'amber' : 'rose'}>
              {stats.ph.compliance}% Safe
            </Tag>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="font-display text-3xl font-extrabold text-slate-900">
                {stats.ph.avg != null ? stats.ph.avg.toFixed(2) : '--'}
              </p>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Average reading</p>
            </div>
            {stats.ph.spark.length > 1 && (
              <div className="pb-1">
                <MiniSparkline values={stats.ph.spark} color="#10b981" width={95} height={32} />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
            <span>Min: <strong>{stats.ph.min != null ? stats.ph.min.toFixed(2) : '--'}</strong></span>
            <span>Max: <strong>{stats.ph.max != null ? stats.ph.max.toFixed(2) : '--'}</strong></span>
            <span className="font-bold text-emerald-700">Safe: 6.5-8.5</span>
          </div>
        </div>

        {/* Turbidity Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-sky-50 p-2 text-sky-700">
                <Waves size={18} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Turbidity
              </span>
            </div>
            <Tag color={stats.turbidity.compliance >= 90 ? 'emerald' : stats.turbidity.compliance >= 70 ? 'amber' : 'rose'}>
              {stats.turbidity.compliance}% Safe
            </Tag>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="font-display text-3xl font-extrabold text-slate-900">
                {stats.turbidity.avg != null ? `${stats.turbidity.avg.toFixed(1)} NTU` : '--'}
              </p>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Average reading</p>
            </div>
            {stats.turbidity.spark.length > 1 && (
              <div className="pb-1">
                <MiniSparkline values={stats.turbidity.spark} color="#0ea5e9" width={95} height={32} />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
            <span>Min: <strong>{stats.turbidity.min != null ? `${stats.turbidity.min.toFixed(1)} NTU` : '--'}</strong></span>
            <span>Max: <strong>{stats.turbidity.max != null ? `${stats.turbidity.max.toFixed(1)} NTU` : '--'}</strong></span>
            <span className="font-bold text-sky-700">Safe: &lt;30 NTU</span>
          </div>
        </div>

        {/* TDS Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-amber-50 p-2 text-amber-700">
                <Activity size={18} />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Total Solids (TDS)
              </span>
            </div>
            <Tag color={stats.tds.compliance >= 90 ? 'emerald' : stats.tds.compliance >= 70 ? 'amber' : 'rose'}>
              {stats.tds.compliance}% Safe
            </Tag>
          </div>

          <div className="mt-4 flex items-end justify-between">
            <div>
              <p className="font-display text-3xl font-extrabold text-slate-900">
                {stats.tds.avg != null ? `${Math.round(stats.tds.avg)} ppm` : '--'}
              </p>
              <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Average reading</p>
            </div>
            {stats.tds.spark.length > 1 && (
              <div className="pb-1">
                <MiniSparkline values={stats.tds.spark} color="#f59e0b" width={95} height={32} />
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
            <span>Min: <strong>{stats.tds.min != null ? `${Math.round(stats.tds.min)}` : '--'}</strong></span>
            <span>Max: <strong>{stats.tds.max != null ? `${Math.round(stats.tds.max)}` : '--'}</strong></span>
            <span className="font-bold text-amber-700">Safe: &lt;1000 ppm</span>
          </div>
        </div>
      </div>

      {/* Main Filterable Telemetry Log Table */}
      <div className="rounded-3xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
        {/* Filter Controls Header */}
        <div className="flex flex-col gap-3 p-5 border-b border-slate-100 bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className={`${inputClass} pl-9 text-xs`}
                placeholder="Search node, facility, pond..."
              />
            </div>

            {/* Node Selector */}
            <select
              value={selectedNode}
              onChange={(e) => {
                setSelectedNode(e.target.value)
                setPage(1)
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none hover:bg-slate-50"
            >
              <option value="all">All Sensor Probes ({distinctNodes.length})</option>
              {distinctNodes.map((n) => (
                <option key={n} value={n}>
                  Probe: {n}
                </option>
              ))}
            </select>

            {/* Facility Selector */}
            {nodes.length > 1 && (
              <select
                value={selectedFacility}
                onChange={(e) => {
                  setSelectedFacility(e.target.value)
                  setPage(1)
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none hover:bg-slate-50"
              >
                <option value="all">All Facilities ({nodes.length})</option>
                {nodes.map((fac) => (
                  <option key={fac.id} value={fac.node_code}>
                    {fac.display_name} ({fac.node_code})
                  </option>
                ))}
              </select>
            )}

            {/* Health Status Filter */}
            <select
              value={healthFilter}
              onChange={(e) => {
                setHealthFilter(e.target.value as any)
                setPage(1)
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none hover:bg-slate-50"
            >
              <option value="all">All Health Conditions</option>
              <option value="Optimal">Optimal Only</option>
              <option value="Caution">Caution / Marginal</option>
              <option value="Critical">Critical Exception</option>
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
            <span>
              Showing <strong className="text-slate-800">{filtered.length}</strong> records
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 outline-none"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3.5">Timestamp / Probe</th>
                <th className="px-5 py-3.5">Facility / Pond</th>
                <th className="px-5 py-3.5">Temperature</th>
                <th className="px-5 py-3.5">pH Level</th>
                <th className="px-5 py-3.5">Turbidity</th>
                <th className="px-5 py-3.5">TDS Solids</th>
                <th className="px-5 py-3.5">Ecosystem Status</th>
                <th className="px-5 py-3.5">LoRa Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginated.map((r, idx) => {
                const health = getFishHealthStatus(r)
                const isTempExtreme = r.temperature != null && (r.temperature < 20 || r.temperature > 34)
                const isPhExtreme = r.ph != null && (r.ph < 6.0 || r.ph > 9.0)
                const isTurbElevated = r.turbidity != null && r.turbidity > 50

                return (
                  <tr key={`${r.node_id}-${r.timestamp}-${idx}`} className="transition hover:bg-sky-50/40">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-cyan-500" />
                        <span className="font-display font-bold text-slate-900">{r.node_id}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400 pl-4" title={r.timestamp}>
                        {formatDate(r.timestamp)}
                      </p>
                    </td>

                    <td className="px-5 py-3.5">
                      <p className="font-semibold text-slate-800">
                        {r.master_node_name || r.master_node_code || 'Main Facility'}
                      </p>
                      <span className="mt-0.5 inline-block text-[11px] font-bold uppercase tracking-wider text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-md">
                        {r.pond_type || 'Tilapia'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block font-display font-bold px-2 py-0.5 rounded-md text-xs ${
                          isTempExtreme
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-cyan-50 text-cyan-900 font-extrabold'
                        }`}
                      >
                        {r.temperature != null ? `${r.temperature}°C` : '--'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block font-display font-bold px-2 py-0.5 rounded-md text-xs ${
                          isPhExtreme
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-emerald-50 text-emerald-900 font-extrabold'
                        }`}
                      >
                        {r.ph != null ? r.ph.toFixed(2) : '--'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block font-semibold px-2 py-0.5 rounded-md text-xs ${
                          isTurbElevated
                            ? 'bg-amber-100 text-amber-800'
                            : 'text-slate-700'
                        }`}
                      >
                        {r.turbidity != null ? `${r.turbidity} NTU` : '--'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5">
                      <span className="font-semibold text-slate-700 text-xs">
                        {r.tds != null ? `${r.tds} ppm` : '--'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5">
                      <Tag color={health.color}>{health.status}</Tag>
                    </td>

                    <td className="px-5 py-3.5 text-xs text-slate-500">
                      <div className="flex items-center gap-2.5">
                        {r.battery_pct != null && (
                          <span
                            className={`font-bold ${
                              r.battery_pct < 25 ? 'text-rose-600' : 'text-slate-600'
                            }`}
                          >
                            {r.battery_pct}% bat
                          </span>
                        )}
                        {r.rssi != null && (
                          <span className="text-slate-400 font-mono text-[11px]">{r.rssi} dBm</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={8} className="px-5 py-14 text-center text-sm text-slate-500">
                    No telemetry records match your current filter selection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 p-4 text-xs font-semibold text-slate-600">
            <div>
              Page <strong className="text-slate-800">{page}</strong> of{' '}
              <strong className="text-slate-800">{totalPages}</strong>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-xl border border-slate-200 px-3.5 py-1.5 font-bold hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-xl border border-slate-200 px-3.5 py-1.5 font-bold hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// FACILITY / MASTER NODE REGISTRY VIEW
// ============================================================================
type FormState = {
  node_code: string
  display_name: string
  password: string
  contact_name: string
  contact_phone: string
  site_location: string
  pond_type: string
  role: string
}
const blankForm: FormState = {
  node_code: '',
  display_name: '',
  password: '',
  contact_name: '',
  contact_phone: '',
  site_location: '',
  pond_type: 'tilapia',
  role: 'customer'
}

export function NodesView({
  nodes,
  reload
}: {
  nodes: Node[]
  reload: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Node | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingNode, setDeletingNode] = useState<Node | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const filtered = nodes.filter((n) =>
    `${n.node_code} ${n.display_name} ${n.site_location ?? ''} ${n.contact_name ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase())
  )

  const activeCount = nodes.filter((n) => n.status === 'active').length

  const handleDelete = async () => {
    if (!deletingNode) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteMasterNode(deletingNode.id)
      await reload()
      setDeletingNode(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete facility')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="animate-rise space-y-6">
      <PageTitle
        eyebrow="Fleet Topology"
        title="Facility & Gateway Registry"
        description="Provision, manage, and monitor authorized facility master node accounts and cloud stream credentials."
        action={
          <button onClick={() => setCreating(true)} className={buttonClass}>
            <Plus size={16} /> Provision New Facility
          </button>
        }
      />

      {/* Facilities Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Registered Facilities
            </span>
            <div className="rounded-xl bg-cyan-50 p-2 text-cyan-700">
              <Server size={18} />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900">{nodes.length}</p>
          <p className="mt-1 text-xs text-slate-500">Configured gateway accounts</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active Stream Gateways
            </span>
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-emerald-700">{activeCount}</p>
          <p className="mt-1 text-xs text-slate-500">Currently authorized to ingest telemetry</p>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Administrative Accounts
            </span>
            <div className="rounded-xl bg-purple-50 p-2 text-purple-700">
              <ShieldCheck size={18} />
            </div>
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-purple-900">
            {nodes.filter((n) => n.role === 'super_admin').length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Super Admin role privileges</p>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 p-5 border-b border-slate-100 bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              Facilities Directory ({nodes.length})
            </h3>
            <p className="text-xs text-slate-500">Active gateways authorized to stream water quality telemetry.</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${inputClass} pl-9 text-xs`}
              placeholder="Search facility name or code..."
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3.5">Facility / Code</th>
                <th className="px-5 py-3.5">Contact Person</th>
                <th className="px-5 py-3.5">Location & Environment</th>
                <th className="px-5 py-3.5">Access Role</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((node) => (
                <tr key={node.id} className="transition hover:bg-sky-50/30">
                  <td className="px-5 py-4">
                    <p className="font-display font-bold text-slate-900">{node.display_name}</p>
                    <p className="mt-0.5 text-xs font-bold text-cyan-700">{node.node_code}</p>
                  </td>

                  <td className="px-5 py-4 text-xs">
                    <p className="font-semibold text-slate-800">{node.contact_name || 'Unassigned'}</p>
                    <p className="text-slate-400">{node.contact_phone || 'No phone'}</p>
                  </td>

                  <td className="px-5 py-4 text-xs">
                    <span className="flex items-center gap-1 font-semibold text-slate-700">
                      <MapPin size={13} className="text-cyan-600" />
                      {node.site_location || 'Main Site'}
                    </span>
                    <span className="mt-0.5 inline-block capitalize text-slate-400">
                      {node.pond_type || 'Tilapia'} pond
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    <Tag color={node.role === 'super_admin' ? 'purple' : 'blue'}>
                      {node.role === 'super_admin' ? 'Super Admin' : 'Facility Operator'}
                    </Tag>
                  </td>

                  <td className="px-5 py-4">
                    <Tag color={node.status === 'active' ? 'emerald' : 'rose'}>
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          node.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                      />
                      {node.status}
                    </Tag>
                  </td>

                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setEditing(node)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-cyan-700"
                        title="Edit facility parameters"
                      >
                        <Edit3 size={13} /> Edit
                      </button>
                      <button
                        onClick={() => setDeletingNode(node)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 shadow-sm transition hover:bg-rose-50 hover:border-rose-300"
                        title="Delete facility from registry"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                    No matching facilities found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deletingNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071b2d]/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-rose-100 p-3 text-rose-600">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">Decommission Facility?</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <p className="mt-4 text-sm text-slate-600 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900">{deletingNode.display_name}</strong> (<code>{deletingNode.node_code}</code>)?
              This will remove the facility master node and revoke its telemetry ingestion access.
            </p>

            {deleteError && (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                {deleteError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeletingNode(null)}
                className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                disabled={deleteBusy}
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting...' : 'Confirm Deletion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <NodeModal
          node={editing}
          close={() => {
            setCreating(false)
            setEditing(null)
          }}
          reload={reload}
        />
      )}
    </div>
  )
}

function NodeModal({
  node,
  close,
  reload
}: {
  node: Node | null
  close: () => void
  reload: () => Promise<void>
}) {
  const [form, setForm] = useState<FormState>(
    node
      ? {
          node_code: node.node_code,
          display_name: node.display_name,
          password: '',
          contact_name: node.contact_name ?? '',
          contact_phone: node.contact_phone ?? '',
          site_location: node.site_location ?? '',
          pond_type: node.pond_type ?? 'tilapia',
          role: node.role
        }
      : blankForm
  )
  const [status, setStatus] = useState(node?.status ?? 'active')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const update = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (node) {
        await api<Node>(`/admin/master-nodes/${node.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            display_name: form.display_name,
            contact_name: form.contact_name,
            contact_phone: form.contact_phone,
            site_location: form.site_location,
            pond_type: form.pond_type,
            role: form.role,
            status
          })
        })
      } else {
        await api<Node>('/master-nodes', { method: 'POST', body: JSON.stringify(form) })
      }
      await reload()
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save facility details')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071b2d]/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
      >
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">
              {node ? 'Account Settings' : 'New Master Node'}
            </p>
            <h2 className="mt-1 font-display text-xl font-bold text-slate-900">
              {node ? `Edit ${node.display_name}` : 'Provision Facility Node'}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-slate-700">Master Node Code</label>
            <input
              required
              disabled={!!node}
              value={form.node_code}
              onChange={(e) => update('node_code', e.target.value.toUpperCase())}
              className={`${inputClass} mt-1.5 uppercase disabled:bg-slate-100`}
              placeholder="e.g. AQL-0002"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700">Display / Facility Name</label>
            <input
              required
              value={form.display_name}
              onChange={(e) => update('display_name', e.target.value)}
              className={`${inputClass} mt-1.5`}
              placeholder="e.g. Bluewater Farm 1"
            />
          </div>

          {!node && (
            <div>
              <label className="block text-xs font-bold text-slate-700">Access Password</label>
              <input
                required
                minLength={6}
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                className={`${inputClass} mt-1.5`}
                placeholder="Min 6 characters"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700">Contact Operator</label>
            <input
              value={form.contact_name}
              onChange={(e) => update('contact_name', e.target.value)}
              className={`${inputClass} mt-1.5`}
              placeholder="e.g. Kamal Silva"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700">Phone Number</label>
            <input
              value={form.contact_phone}
              onChange={(e) => update('contact_phone', e.target.value)}
              className={`${inputClass} mt-1.5`}
              placeholder="+94 77 123 4567"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700">Site Location</label>
            <input
              value={form.site_location}
              onChange={(e) => update('site_location', e.target.value)}
              className={`${inputClass} mt-1.5`}
              placeholder="e.g. Negombo Lagoon East"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700">Default Pond Spec</label>
            <select
              value={form.pond_type}
              onChange={(e) => update('pond_type', e.target.value)}
              className={`${inputClass} mt-1.5`}
            >
              <option value="tilapia">Tilapia</option>
              <option value="prawn">Prawn / Shrimp</option>
              <option value="catfish">Catfish</option>
              <option value="carp">Carp</option>
              <option value="custom">Custom Threshold Profile</option>
            </select>
          </div>

          {node && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700">Account Role</label>
                <select
                  value={form.role}
                  onChange={(e) => update('role', e.target.value)}
                  className={`${inputClass} mt-1.5`}
                >
                  <option value="customer">Facility Operator</option>
                  <option value="super_admin">Super Administrator</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Facility Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={`${inputClass} mt-1.5`}
                >
                  <option value="active">Active (Online Stream Allowed)</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-7 flex justify-end gap-2.5 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button disabled={busy} className={buttonClass}>
            {busy ? 'Saving...' : node ? 'Save Changes' : 'Provision Facility'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ============================================================================
// ALERT CENTER VIEW
// ============================================================================
export function AlertsView({
  alerts,
  nodes,
  reload
}: {
  alerts: Alert[]
  nodes: Node[]
  reload: () => Promise<void>
}) {
  const [severity, setSeverity] = useState('all')
  const [selectedNode, setSelectedNode] = useState('all')

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (severity !== 'all' && a.severity.toLowerCase() !== severity.toLowerCase()) return false
      if (selectedNode !== 'all' && a.node_id !== selectedNode) return false
      return true
    })
  }, [alerts, severity, selectedNode])

  const distinctNodes = useMemo(() => {
    return Array.from(new Set(alerts.map((a) => a.node_id))).sort()
  }, [alerts])

  const criticalCount = alerts.filter((a) => a.severity.toLowerCase() === 'critical').length
  const warningCount = alerts.filter((a) => a.severity.toLowerCase() === 'warning').length

  return (
    <div className="animate-rise space-y-6">
      <PageTitle
        eyebrow="Triage Watch"
        title="Aquaculture Alert Center"
        description="Proactive warnings and exception incidents triggered by water quality threshold deviations."
        action={
          <button onClick={() => void reload()} className={buttonClass}>
            <RefreshCw size={16} /> Refresh Alerts
          </button>
        }
      />

      {/* Alert Summary Banner */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/70 p-5">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-xs font-bold uppercase tracking-wider">Critical Anomalies</span>
            <AlertOctagon size={20} />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-rose-900">{criticalCount}</p>
          <p className="mt-1 text-xs text-rose-700/80">Immediate intervention suggested</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-5">
          <div className="flex items-center justify-between text-amber-700">
            <span className="text-xs font-bold uppercase tracking-wider">Warning Deviations</span>
            <AlertTriangle size={20} />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-amber-900">{warningCount}</p>
          <p className="mt-1 text-xs text-amber-700/80">Monitor closely</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Total Incidents</span>
            <ShieldCheck size={20} className="text-cyan-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-slate-900">{alerts.length}</p>
          <p className="mt-1 text-xs text-slate-500">Across {distinctNodes.length} reporting probes</p>
        </div>
      </div>

      {/* Alerts Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
        <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
          <Filter size={14} /> Filter:
        </span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 outline-none hover:bg-slate-100"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical Only</option>
          <option value="warning">Warning Only</option>
          <option value="normal">Normal</option>
        </select>

        {distinctNodes.length > 0 && (
          <select
            value={selectedNode}
            onChange={(e) => setSelectedNode(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 outline-none hover:bg-slate-100"
          >
            <option value="all">All Reporting Nodes</option>
            {distinctNodes.map((n) => (
              <option key={n} value={n}>
                Node: {n}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Alerts List */}
      <div className="space-y-3">
        {filtered.map((alert) => {
          const isCrit = alert.severity.toLowerCase() === 'critical'
          return (
            <div
              key={alert.id}
              className={`flex flex-col gap-4 rounded-2xl border p-5 shadow-sm transition sm:flex-row sm:items-center sm:justify-between ${
                isCrit
                  ? 'border-rose-200 bg-rose-50/30 hover:bg-rose-50/50'
                  : 'border-slate-200/90 bg-white hover:bg-slate-50/60'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`rounded-xl p-3 ${
                    isCrit ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {isCrit ? <AlertOctagon size={22} /> : <AlertTriangle size={22} />}
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag color={isCrit ? 'rose' : 'amber'}>{alert.severity.toUpperCase()}</Tag>
                    <span className="font-display text-sm font-bold text-slate-900">
                      Probe {alert.node_id}
                    </span>
                    <span className="text-xs font-bold uppercase text-slate-400">
                      • {alert.parameter}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">{alert.message}</p>
                </div>
              </div>

              <div className="text-right text-xs text-slate-400">
                <p className="font-semibold text-slate-500">{formatRelativeTime(alert.timestamp)}</p>
                <p className="mt-0.5">{formatDate(alert.timestamp)}</p>
              </div>
            </div>
          )
        })}

        {!filtered.length && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-14 text-center">
            <ShieldCheck className="mx-auto h-12 w-12 text-emerald-500" />
            <h4 className="mt-3 font-display font-bold text-slate-800">All Water Parameters Safe</h4>
            <p className="mt-1 text-sm text-slate-500">
              No unresolved alerts match your selected filters.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
