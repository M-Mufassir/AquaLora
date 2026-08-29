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

function formatTick(iso: string): string {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

interface ChartRowProps {
  title: string
  data: StoredReading[]
  dataKey: keyof StoredReading
  color: string
}

function ChartRow({ title, data, dataKey, color }: ChartRowProps): React.JSX.Element {
  return (
    <div className="chart-row">
      <span className="chart-title">{title}</span>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--ev-c-gray-3)" />
          <XAxis dataKey="timestamp" tickFormatter={formatTick} stroke="var(--ev-c-text-2)" fontSize={11} />
          <YAxis stroke="var(--ev-c-text-2)" fontSize={11} width={40} />
          <Tooltip
            labelFormatter={(iso) => new Date(iso as string).toLocaleString()}
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

  useEffect(() => {
    const { startIso, endIso } = rangeToIso(preset)
    window.api.getReadingsInRange(nodeId, startIso, endIso).then(setReadings)
  }, [nodeId, preset])

  async function handleExport(): Promise<void> {
    const { startIso, endIso } = rangeToIso(preset)
    const result = await window.api.exportReadingsCsv(nodeId, startIso, endIso)
    setExportMessage(
      result.canceled ? null : `Exported ${result.count} readings to ${result.filePath}`
    )
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
          />
          <ChartRow
            title="Turbidity (NTU)"
            data={readings}
            dataKey="turbidity"
            color="var(--cat-turbidity)"
          />
          <ChartRow title="TDS (ppm)" data={readings} dataKey="tds" color="var(--cat-tds)" />
          <ChartRow title="pH" data={readings} dataKey="ph" color="#8b5cf6" />
        </>
      )}
    </div>
  )
}

export default HistoryPanel
