import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { StoredReading } from '../../../shared/types'

interface HistoryPanelProps {
  nodeId: string
}

type RangePreset = '1h' | '24h' | '7d' | 'all'

const RANGE_MS: Record<Exclude<RangePreset, 'all'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
}

const EPOCH_START = '1970-01-01T00:00:00.000Z'

function rangeToIso(preset: RangePreset): { startIso: string; endIso: string } {
  const endIso = new Date().toISOString()
  if (preset === 'all') return { startIso: EPOCH_START, endIso }
  return { startIso: new Date(Date.now() - RANGE_MS[preset]).toISOString(), endIso }
}

function formatTick(iso: string, preset: RangePreset): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const ss = d.getSeconds().toString().padStart(2, '0')

  if (preset === '1h') {
    return `${hh}:${mm}:${ss}`
  }
  if (preset === '24h') {
    return `${hh}:${mm}`
  }
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${day}/${month} ${hh}:${mm}`
}

interface ChartRowProps {
  title: string
  data: StoredReading[]
  dataKey: keyof StoredReading
  color: string
  preset: RangePreset
}

function ChartRow({ title, data, dataKey, color, preset }: ChartRowProps): React.JSX.Element {
  return (
    <div className="chart-row">
      <span className="chart-title">{title}</span>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--ev-c-gray-3)" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(iso) => formatTick(iso, preset)}
            stroke="var(--ev-c-text-2)"
            fontSize={11}
          />
          <YAxis stroke="var(--ev-c-text-2)" fontSize={11} width={40} />
          <Tooltip
            labelFormatter={(iso) => {
              const d = new Date(iso as string)
              return isNaN(d.getTime()) ? String(iso) : d.toLocaleString()
            }}
            contentStyle={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              color: 'var(--ev-c-text-1)'
            }}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function HistoryPanel({ nodeId }: HistoryPanelProps): React.JSX.Element {
  const [preset, setPreset] = useState<RangePreset>('1h')
  const [readings, setReadings] = useState<StoredReading[]>([])
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [isSyncingCloud, setIsSyncingCloud] = useState(false)

  const reloadData = (): void => {
    const { startIso, endIso } = rangeToIso(preset)
    window.api.getReadingsInRange(nodeId, startIso, endIso).then((rows) => {
      // Sort ascending by timestamp for correct graph direction
      const sorted = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      setReadings(sorted)
    })
  }

  useEffect(() => {
    reloadData()

    // 1. Live stream new incoming readings into chart
    const unsubReading = window.api.onReading((reading) => {
      if (reading.node_id === nodeId) {
        reloadData()
      }
    })

    // 2. Reload when background cloud sync brings in historical data
    const unsubSync = window.api.onSyncStatus((status) => {
      if (status.syncPhase === 'synced' || status.syncPhase === 'idle') {
        reloadData()
      }
    })

    return () => {
      unsubReading()
      unsubSync()
    }
  }, [nodeId, preset])

  async function handleExport(): Promise<void> {
    const { startIso, endIso } = rangeToIso(preset)
    const result = await window.api.exportReadingsCsv(nodeId, startIso, endIso)
    setExportMessage(
      result.canceled ? null : `Exported ${result.count} readings to ${result.filePath}`
    )
  }

  async function handleCloudSync(): Promise<void> {
    setIsSyncingCloud(true)
    setExportMessage('Syncing missing readings from cloud backend...')
    try {
      const status = await window.api.syncCloudReadings()
      reloadData()
      const dlCount = status.downloadedCount ?? 0
      setExportMessage(
        dlCount > 0
          ? `Successfully synced ${dlCount} new readings from cloud!`
          : 'Cloud sync complete — local history is already up to date.'
      )
    } catch (err: any) {
      setExportMessage(`Cloud sync warning: ${err.message || String(err)}`)
    } finally {
      setIsSyncingCloud(false)
    }
  }

  return (
    <div className="history-panel">
      <div className="history-controls">
        {(['1h', '24h', '7d', 'all'] as RangePreset[]).map((p) => (
          <button
            key={p}
            className={`range-btn${p === preset ? ' active' : ''}`}
            onClick={() => setPreset(p)}
          >
            {p === 'all' ? 'All' : `Last ${p}`}
          </button>
        ))}
        <button
          className="range-btn sync-btn"
          onClick={handleCloudSync}
          disabled={isSyncingCloud}
          title="Download older/missing readings from the cloud backend"
        >
          {isSyncingCloud ? 'Syncing...' : 'Sync Cloud'}
        </button>
        <button className="range-btn export-btn" onClick={handleExport} disabled={readings.length === 0}>
          Export CSV
        </button>
      </div>

      {exportMessage && <p className="export-message">{exportMessage}</p>}

      {readings.length === 0 ? (
        <p className="status">No readings in this range yet.</p>
      ) : (
        <>
          <ChartRow
            title="Temperature (°C)"
            data={readings}
            dataKey="temperature"
            color="var(--cat-temperature)"
            preset={preset}
          />
          <ChartRow
            title="Turbidity (NTU)"
            data={readings}
            dataKey="turbidity"
            color="var(--cat-turbidity)"
            preset={preset}
          />
          <ChartRow
            title="TDS (ppm)"
            data={readings}
            dataKey="tds"
            color="var(--cat-tds)"
            preset={preset}
          />
          <ChartRow
            title="pH"
            data={readings}
            dataKey="ph"
            color="#8b5cf6"
            preset={preset}
          />
        </>
      )}
    </div>
  )
}

export default HistoryPanel
