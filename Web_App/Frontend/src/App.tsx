import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock,
  Database,
  Droplets,
  Gauge,
  HelpCircle,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sun,
  Thermometer,
  Waves,
  Wifi,
  X,
  XCircle
} from 'lucide-react'
import {
  Alert,
  api,
  DashboardStats,
  login,
  Node,
  Reading,
  session,
  UserSession
} from './api'
import {
  AlertsView,
  formatDate,
  formatRelativeTime,
  getFishHealthStatus,
  LiveLatestReadingsSection,
  NodesView,
  PageTitle,
  Tag,
  TelemetryView
} from './components'
import {
  FleetHealthGauge,
  MiniSparkline,
  WaterQualityChart
} from './TelemetryChart'

type View = 'overview' | 'nodes' | 'telemetry' | 'alerts'

const navItems = [
  { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
  { id: 'telemetry' as const, label: 'Telemetry & Analytics', icon: BarChart3 },
  { id: 'nodes' as const, label: 'Facility Registry', icon: Server },
  { id: 'alerts' as const, label: 'Alert Center', icon: AlertTriangle }
]

function Login({ onLogin }: { onLogin: (user: UserSession) => void }) {
  const [code, setCode] = useState('Admin')
  const [password, setPassword] = useState('Admin123')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await login(code.trim(), password)
      onLogin(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authenticate with cloud')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#071b2d] p-6 relative overflow-hidden font-sans">
      {/* Background glow elements */}
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />

      <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] bg-white shadow-2xl lg:grid-cols-[1.05fr_.95fr] z-10 border border-white/10">
        {/* Left Branding Hero */}
        <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#071e33] via-[#0b3b60] to-[#0d4f7c] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full border-[28px] border-cyan-400/15 animate-pulse" />
          <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full border-[36px] border-sky-300/10" />

          <div>
            <div className="mb-14 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-400 to-sky-300 p-2 text-[#071b2d] shadow-lg shadow-cyan-400/30">
                <Waves size={24} />
              </div>
              <div>
                <span className="font-display text-2xl font-bold tracking-tight">AquaLoRa</span>
                <span className="ml-2 rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-200">
                  Cloud Core
                </span>
              </div>
            </div>

            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">
              Operations Control Room
            </p>
            <h1 className="mt-3 font-display text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight">
              Real-time aquaculture intelligence.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-sky-100/80">
              Live multi-node telemetry stream, autonomous background cloud sync, intelligent pond health metrics, and automated alert triage.
            </p>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-6">
            <div className="flex items-center gap-3 text-xs text-sky-100/70">
              <ShieldCheck size={16} className="text-cyan-300" />
              <span>Multi-tenant secure token authentication</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-sky-100/70">
              <Activity size={16} className="text-cyan-300" />
              <span>Continuous LoRaWAN sensor synchronization</span>
            </div>
          </div>
        </div>

        {/* Right Form Card */}
        <form onSubmit={submit} className="p-8 sm:p-12 flex flex-col justify-between">
          <div>
            <div className="mb-8 lg:hidden flex items-center gap-3 text-[#0b3b60]">
              <div className="rounded-xl bg-cyan-500 p-2 text-white">
                <Waves size={22} />
              </div>
              <span className="font-display text-xl font-bold">AquaLoRa Cloud</span>
            </div>

            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Access Portal</p>
            <h2 className="mt-1 font-display text-2xl sm:text-3xl font-bold text-slate-900">
              Sign in to Dashboard
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter your Master Node code or Administrator username.
            </p>

            <div className="mt-8 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">
                  Node Code / Username
                </label>
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                  placeholder="e.g. Admin or AQL-0001"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Password</label>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10"
                  placeholder="Enter account password"
                />
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 flex items-center gap-2">
                <AlertOctagon size={16} />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="mt-8">
            <button
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 py-3.5 font-bold text-white shadow-lg shadow-sky-600/25 transition hover:from-sky-500 hover:to-cyan-500 disabled:opacity-60"
            >
              {busy ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  <span>Connecting to Cloud...</span>
                </>
              ) : (
                <>
                  <span>Open Control Room</span>
                  <ChevronRight size={18} />
                </>
              )}
            </button>

            <div className="mt-6 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 pt-4">
              <span>Admin: <code>Admin</code> / <code>Admin123</code></span>
              <span>Node: <code>AQL-0001</code></span>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<UserSession | null>(session.user)
  const [view, setView] = useState<View>('overview')
  const [mobileNav, setMobileNav] = useState(false)

  // Data states
  const [nodes, setNodes] = useState<Node[]>([])
  const [readings, setReadings] = useState<Reading[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [error, setError] = useState('')

  // Auto-refresh interval (in seconds, 0 = off)
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(10)
  const autoRefreshTimerRef = useRef<any>(null)

  // Global Facility Scope Filter
  const [globalFacility, setGlobalFacility] = useState<string>('all')

  const effectiveReadings = useMemo(() => {
    if (globalFacility === 'all') return readings
    return readings.filter(
      (r) => r.master_node_code === globalFacility || String(r.master_node_id) === globalFacility
    )
  }, [readings, globalFacility])

  const effectiveAlerts = useMemo(() => {
    if (globalFacility === 'all') return alerts
    const matchingMasterNode = nodes.find((n) => n.node_code === globalFacility)
    return alerts.filter(
      (a) =>
        (matchingMasterNode && a.master_node_id === matchingMasterNode.id) ||
        effectiveReadings.some((r) => r.node_id === a.node_id)
    )
  }, [alerts, globalFacility, nodes, effectiveReadings])

  const loadData = async (isBackground = false) => {
    if (!isBackground) setLoading(true)
    setError('')
    try {
      const isAdmin = user?.role === 'super_admin'
      const promises: [Promise<Node[]>, Promise<Reading[]>, Promise<Alert[]>, Promise<DashboardStats>] = [
        isAdmin ? api<Node[]>('/admin/master-nodes') : Promise.resolve([]),
        isAdmin
          ? api<Reading[]>('/admin/readings/history?limit=300')
          : api<Reading[]>('/readings/history?limit=300'),
        isAdmin
          ? api<Alert[]>('/admin/alerts/history?limit=200')
          : api<Alert[]>('/alerts/latest?limit=200'),
        api<DashboardStats>('/dashboard/stats').catch(() => ({
          total_facilities: nodes.length || 1,
          total_sensor_nodes: new Set(readings.map((r) => r.node_id)).size,
          total_readings: readings.length,
          critical_alerts: alerts.filter((a) => a.severity === 'critical').length,
          warning_alerts: alerts.filter((a) => a.severity === 'warning').length
        }))
      ]

      const [n, r, a, s] = await Promise.all(promises)
      setNodes(n)
      setReadings(r)
      setAlerts(a)
      setStats(s)
      setLastSyncedAt(new Date())
    } catch (err) {
      if (!isBackground) {
        setError(err instanceof Error ? err.message : 'Could not synchronize cloud telemetry')
      }
    } finally {
      if (!isBackground) setLoading(false)
    }
  }

  // Load data on user change
  useEffect(() => {
    if (user) {
      void loadData(false)
    }
  }, [user])

  // Periodic Auto-refresh
  useEffect(() => {
    if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current)
    if (user && autoRefreshInterval > 0) {
      autoRefreshTimerRef.current = setInterval(() => {
        void loadData(true)
      }, autoRefreshInterval * 1000)
    }
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current)
    }
  }, [user, autoRefreshInterval])

  if (!user) {
    return <Login onLogin={setUser} />
  }

  const criticalAlertsCount = alerts.filter((a) => a.severity.toLowerCase() === 'critical').length

  return (
    <div className="min-h-screen bg-[#f4f8fb] text-slate-800 font-sans flex flex-col">
      {/* Fixed Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-[#071b2d] p-6 text-white transition-transform lg:translate-x-0 ${
          mobileNav ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } flex flex-col justify-between`}
      >
        <div>
          {/* Logo & Brand */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-400 to-sky-300 p-2 text-[#071b2d] shadow-md shadow-cyan-400/20">
                <Waves size={22} />
              </div>
              <div>
                <span className="font-display text-xl font-bold tracking-tight">AquaLoRa</span>
                <span className="block text-[10px] font-semibold text-cyan-300/80">Cloud Operations</span>
              </div>
            </div>
            <button
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 lg:hidden"
              onClick={() => setMobileNav(false)}
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Links */}
          <div className="mt-10">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400/70">
              Navigation
            </p>
            <div className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = view === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setView(item.id)
                      setMobileNav(false)
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-semibold transition ${
                      isActive
                        ? 'bg-gradient-to-r from-sky-600 to-cyan-600 text-white shadow-lg shadow-sky-950/40 font-bold'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400'} />
                    <span>{item.label}</span>
                    {item.id === 'alerts' && criticalAlertsCount > 0 && (
                      <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-extrabold text-white animate-pulse">
                        {criticalAlertsCount}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Bottom Sidebar Widget */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
              </span>
              Cloud Sync Active
            </div>
            <span className="text-[10px] text-slate-400">
              {lastSyncedAt ? formatRelativeTime(lastSyncedAt.toISOString()) : 'Syncing'}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            Automatic background telemetry ingestion connected.
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="lg:pl-72 flex-1 flex flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-slate-200/80 bg-[#f4f8fb]/95 px-5 backdrop-blur-md sm:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm lg:hidden hover:bg-slate-50"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={18} />
            </button>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">
                AquaLoRa / {navItems.find((n) => n.id === view)?.label}
              </p>
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900">
                {view === 'overview'
                  ? `Welcome, ${user.display_name}`
                  : navItems.find((n) => n.id === view)?.label}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-4">
            {/* Global Facility Selector for Super Admin */}
            {nodes.length > 0 && (
              <div className="hidden md:flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm text-xs font-semibold text-slate-600">
                <Server size={14} className="text-cyan-600" />
                <span>Facility:</span>
                <select
                  value={globalFacility}
                  onChange={(e) => setGlobalFacility(e.target.value)}
                  className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer max-w-[170px] truncate"
                >
                  <option value="all">All Facilities ({nodes.length})</option>
                  {nodes.map((node) => (
                    <option key={node.id} value={node.node_code}>
                      {node.display_name} ({node.node_code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Auto-refresh interval selector */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm text-xs font-semibold text-slate-600">
              <Clock size={14} className="text-slate-400" />
              <span>Auto-refresh:</span>
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent font-bold text-cyan-700 outline-none cursor-pointer"
              >
                <option value={5}>Every 5s (Live)</option>
                <option value={10}>Every 10s</option>
                <option value={30}>Every 30s</option>
                <option value={0}>Manual only</option>
              </select>
            </div>

            {/* Manual Refresh Button */}
            <button
              onClick={() => void loadData(false)}
              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm transition hover:border-cyan-400 hover:text-cyan-700"
              title="Refresh telemetry immediately"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin text-cyan-600' : ''} />
            </button>

            {/* User Profile Pill */}
            <div className="hidden items-center gap-3 border-l border-slate-200 pl-4 sm:flex">
              <div className="rounded-full bg-cyan-100 p-2 text-cyan-800">
                <CircleUserRound size={18} />
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-900 leading-tight">{user.display_name}</p>
                <p className="text-[11px] font-semibold text-cyan-700">
                  {user.role === 'super_admin' ? 'Super Administrator' : user.node_code}
                </p>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={() => {
                session.token = null
                setUser(null)
              }}
              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-700"
              title="Sign out of console"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* View Router */}
        <main className="mx-auto w-full max-w-[1550px] p-5 sm:p-8 flex-1">
          {error && (
            <div className="mb-6 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              <div className="flex items-center gap-2">
                <AlertOctagon size={18} />
                <span>{error}</span>
              </div>
              <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-700">
                <X size={16} />
              </button>
            </div>
          )}

          {view === 'overview' && (
            <OverviewTab
              nodes={nodes}
              readings={effectiveReadings}
              alerts={effectiveAlerts}
              stats={stats}
              setView={setView}
              reload={() => loadData(false)}
            />
          )}

          {view === 'telemetry' && (
            <TelemetryView nodes={nodes} readings={effectiveReadings} reload={() => loadData(false)} />
          )}

          {view === 'nodes' && <NodesView nodes={nodes} reload={() => loadData(false)} />}

          {view === 'alerts' && <AlertsView alerts={effectiveAlerts} nodes={nodes} reload={() => loadData(false)} />}
        </main>
      </div>
    </div>
  )
}

// ============================================================================
// OVERVIEW TAB (COMMAND CENTER)
// ============================================================================
function OverviewTab({
  nodes,
  readings,
  alerts,
  stats,
  setView,
  reload
}: {
  nodes: Node[]
  readings: Reading[]
  alerts: Alert[]
  stats: DashboardStats | null
  setView: (v: View) => void
  reload: () => Promise<void>
}) {
  const distinctNodeIds = useMemo(() => new Set(readings.map((r) => r.node_id)), [readings])
  const activeCount = distinctNodeIds.size
  const criticalCount = alerts.filter((a) => a.severity.toLowerCase() === 'critical').length
  const warningCount = alerts.filter((a) => a.severity.toLowerCase() === 'warning').length

  // Calculate fleet health index score (0 - 100)
  const fleetHealthScore = useMemo(() => {
    if (!readings.length) return 100
    let totalScore = 0
    let count = 0

    for (const r of readings) {
      let score = 100
      if (r.temperature != null) {
        if (r.temperature < 20 || r.temperature > 34) score -= 30
        else if (r.temperature < 26 || r.temperature > 30) score -= 10
      }
      if (r.ph != null) {
        if (r.ph < 6.0 || r.ph > 9.0) score -= 30
        else if (r.ph < 6.5 || r.ph > 8.5) score -= 10
      }
      if (r.turbidity != null && r.turbidity > 30) {
        score -= Math.min(25, (r.turbidity - 30) * 1.2)
      }
      if (r.tds != null && r.tds > 1000) {
        score -= Math.min(25, (r.tds - 1000) / 40)
      }
      if (r.battery_pct != null && r.battery_pct < 20) {
        score -= 15
      }
      totalScore += Math.max(0, score)
      count++
    }

    return count ? Math.round(totalScore / count) : 100
  }, [readings])

  // Extract recent parameter arrays for sparklines and summary values
  const paramStats = useMemo(() => {
    const temps = readings.map((r) => r.temperature).filter((v): v is number => v != null)
    const phs = readings.map((r) => r.ph).filter((v): v is number => v != null)
    const turbidities = readings.map((r) => r.turbidity).filter((v): v is number => v != null)
    const tdss = readings.map((r) => r.tds).filter((v): v is number => v != null)
    const batteries = readings.map((r) => r.battery_pct).filter((v): v is number => v != null)

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
    const min = (arr: number[]) => (arr.length ? Math.min(...arr) : null)
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null)

    return {
      temp: { avg: avg(temps), min: min(temps), max: max(temps), spark: temps.slice(-20) },
      ph: { avg: avg(phs), min: min(phs), max: max(phs), spark: phs.slice(-20) },
      turbidity: { avg: avg(turbidities), min: min(turbidities), max: max(turbidities), spark: turbidities.slice(-20) },
      tds: { avg: avg(tdss), min: min(tdss), max: max(tdss), spark: tdss.slice(-20) },
      battery: { avg: avg(batteries) != null ? Math.round(avg(batteries)!) : 100 }
    }
  }, [readings])

  return (
    <div className="animate-rise space-y-7">
      {/* Top Welcome & System Pulse Banner */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Operations Pulse</p>
          </div>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950">
            Super Administrator Control Room
          </h1>
          <p className="mt-1 text-sm text-slate-500 max-w-2xl">
            Live multi-facility IoT telemetry, automated background LoRa sync, and predictive water quality analytics.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {criticalCount > 0 ? (
            <Tag color="rose">
              <AlertTriangle size={13} className="animate-pulse" /> {criticalCount} Critical Exceptions
            </Tag>
          ) : (
            <Tag color="emerald">
              <CheckCircle2 size={13} /> Fleet Telemetry Optimal
            </Tag>
          )}
          <button
            onClick={() => setView('telemetry')}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <BarChart3 size={14} className="text-cyan-600" /> Open Analytics Studio
          </button>
        </div>
      </div>

      {/* Executive Metric Cards Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {/* Fleet Health Index Card */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Fleet Health Index
            </span>
            <div className="rounded-xl bg-cyan-50 p-1.5 text-cyan-700">
              <ShieldCheck size={16} />
            </div>
          </div>

          <div className="my-2 flex justify-center">
            <FleetHealthGauge score={fleetHealthScore} size={110} />
          </div>

          <div className="border-t border-slate-100 pt-2 text-[11px] text-slate-400 flex items-center justify-between">
            <span>{readings.length} readings analyzed</span>
            <span className="font-bold text-slate-700">{activeCount} probes</span>
          </div>
        </div>

        {/* Temperature KPI Tile */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm flex flex-col justify-between transition hover:shadow-md">
          <div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Water Temp</span>
              <div className="rounded-xl bg-cyan-50 p-2 text-cyan-700">
                <Thermometer size={18} />
              </div>
            </div>
            <p className="mt-2 font-display text-3xl font-extrabold text-slate-900">
              {paramStats.temp.avg != null ? `${paramStats.temp.avg.toFixed(1)}°C` : '--'}
            </p>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Fleet mean temperature</p>
          </div>

          {paramStats.temp.spark.length > 1 && (
            <div className="my-2">
              <MiniSparkline values={paramStats.temp.spark} color="#06b6d4" width={110} height={32} />
            </div>
          )}

          <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Target: <strong>26-30°C</strong></span>
            <span className="font-bold text-cyan-700">
              {paramStats.temp.min != null ? `${paramStats.temp.min.toFixed(0)}° - ${paramStats.temp.max?.toFixed(0)}°` : ''}
            </span>
          </div>
        </div>

        {/* pH Level KPI Tile */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm flex flex-col justify-between transition hover:shadow-md">
          <div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">pH Level</span>
              <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
                <Droplets size={18} />
              </div>
            </div>
            <p className="mt-2 font-display text-3xl font-extrabold text-slate-900">
              {paramStats.ph.avg != null ? paramStats.ph.avg.toFixed(2) : '--'}
            </p>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Acidity / Alkalinity</p>
          </div>

          {paramStats.ph.spark.length > 1 && (
            <div className="my-2">
              <MiniSparkline values={paramStats.ph.spark} color="#10b981" width={110} height={32} />
            </div>
          )}

          <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Target: <strong>6.5-8.5</strong></span>
            <span className="font-bold text-emerald-700">
              {paramStats.ph.min != null ? `${paramStats.ph.min.toFixed(1)} - ${paramStats.ph.max?.toFixed(1)}` : ''}
            </span>
          </div>
        </div>

        {/* Water Clarity (Turbidity & TDS) KPI Tile */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm flex flex-col justify-between transition hover:shadow-md">
          <div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Clarity & Solids</span>
              <div className="rounded-xl bg-sky-50 p-2 text-sky-700">
                <Waves size={18} />
              </div>
            </div>
            <p className="mt-2 font-display text-2xl font-extrabold text-slate-900">
              {paramStats.turbidity.avg != null ? `${paramStats.turbidity.avg.toFixed(1)} NTU` : '--'}
            </p>
            <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
              TDS: <strong>{paramStats.tds.avg != null ? `${Math.round(paramStats.tds.avg)} ppm` : '--'}</strong>
            </p>
          </div>

          {paramStats.turbidity.spark.length > 1 && (
            <div className="my-2">
              <MiniSparkline values={paramStats.turbidity.spark} color="#0ea5e9" width={110} height={32} />
            </div>
          )}

          <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-xs text-slate-500">
            <span>Target: <strong>&lt;30 NTU</strong></span>
            <span className="font-bold text-sky-700">&lt;1000 ppm</span>
          </div>
        </div>

        {/* Monitored Probes & LoRa Link KPI Tile */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm flex flex-col justify-between transition hover:shadow-md">
          <div>
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-bold uppercase tracking-wider">Probe Network</span>
              <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700">
                <Wifi size={18} />
              </div>
            </div>
            <p className="mt-2 font-display text-3xl font-extrabold text-slate-900">{activeCount}</p>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5">Active sensor nodes</p>
          </div>

          <div className="my-3 space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span>Avg Battery:</span>
              <strong className="text-slate-800">{paramStats.battery.avg}%</strong>
            </div>
            <div className="flex items-center justify-between">
              <span>Facilities:</span>
              <strong className="text-slate-800">{nodes.length} registered</strong>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-2 text-xs flex items-center justify-between">
            <span className="text-emerald-700 font-bold flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> LoRa Online
            </span>
            <button
              onClick={() => setView('nodes')}
              className="text-cyan-700 hover:text-cyan-900 font-bold"
            >
              Manage &rarr;
            </button>
          </div>
        </div>
      </div>

      {/* Hero Live Telemetry Trends Studio (Primary User Request!) */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
        <WaterQualityChart
          readings={readings}
          nodes={nodes}
          height={350}
          defaultParam="temperature"
          initialTimeRange="24h"
          showControls={true}
          title="Fleet Telemetry Trajectory Studio"
          subtitle="Real-time multi-probe sensor trajectory with safety boundaries and interactive time scrubbing"
        />
      </div>

      {/* Live Probe Monitor Grid Matrix */}
      <LiveLatestReadingsSection
        readings={readings}
        nodes={nodes}
        onInspectNode={() => setView('telemetry')}
      />

      {/* Lower Dashboard Hub: Alerts Feed & Facility Directory */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Recent Alerts Feed */}
        <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                <h3 className="font-display text-lg font-bold text-slate-900">Recent Alert Incidents</h3>
              </div>
              <p className="text-xs text-slate-500">Threshold deviations requiring operator attention.</p>
            </div>
            <button
              onClick={() => setView('alerts')}
              className="flex items-center gap-1 text-xs font-bold text-cyan-700 hover:text-cyan-900"
            >
              Alert Center ({alerts.length}) <ChevronRight size={14} />
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {alerts.slice(0, 5).map((alert) => {
              const isCrit = alert.severity.toLowerCase() === 'critical'
              return (
                <div
                  key={alert.id}
                  className={`flex items-start justify-between rounded-2xl p-4 text-xs transition ${
                    isCrit ? 'bg-rose-50/70 text-rose-950 border border-rose-100' : 'bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {isCrit ? (
                        <AlertOctagon size={18} className="text-rose-600" />
                      ) : (
                        <AlertTriangle size={18} className="text-amber-600" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{alert.message}</p>
                      <p className="mt-1 text-slate-500">
                        Probe: <strong className="text-slate-700">{alert.node_id}</strong> • Parameter: <span className="uppercase font-semibold">{alert.parameter}</span>
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold text-slate-400 whitespace-nowrap ml-2">
                    {formatRelativeTime(alert.timestamp)}
                  </span>
                </div>
              )
            })}
            {!alerts.length && (
              <div className="py-10 text-center">
                <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
                <p className="text-sm font-bold text-slate-700">All Water Parameters Safe</p>
                <p className="text-xs text-slate-400 mt-1">Zero alert deviations reported across all probes.</p>
              </div>
            )}
          </div>
        </section>

        {/* Connected Facilities Overview */}
        <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-500" />
                <h3 className="font-display text-lg font-bold text-slate-900">Connected Facilities</h3>
              </div>
              <p className="text-xs text-slate-500">Authorized master gateways streaming water quality telemetry.</p>
            </div>
            <button
              onClick={() => setView('nodes')}
              className="flex items-center gap-1 text-xs font-bold text-cyan-700 hover:text-cyan-900"
            >
              Registry <ChevronRight size={14} />
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {nodes.slice(0, 5).map((node) => (
              <div
                key={node.id}
                className="flex items-center justify-between rounded-2xl border border-slate-100 p-3.5 text-xs hover:bg-slate-50 transition"
              >
                <div>
                  <p className="font-bold text-slate-900 text-sm">{node.display_name}</p>
                  <p className="text-[11px] font-semibold text-cyan-700 mt-0.5">{node.node_code}</p>
                </div>
                <div className="text-right">
                  <Tag color={node.status === 'active' ? 'emerald' : 'rose'}>{node.status}</Tag>
                  <p className="mt-1 text-[11px] text-slate-400">{node.site_location || 'Main Site'}</p>
                </div>
              </div>
            ))}
            {!nodes.length && (
              <p className="py-10 text-center text-xs text-slate-400">
                Single facility session connected.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
