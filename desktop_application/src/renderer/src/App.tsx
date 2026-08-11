import { useEffect, useState } from 'react'
import type { Reading } from '../../shared/types'

function App(): React.JSX.Element {
  const [latest, setLatest] = useState<Reading | null>(null)

  useEffect(() => {
    const unsubscribe = window.api.onReading((reading) => setLatest(reading))
    return unsubscribe
  }, [])

  return (
    <div className="dashboard">
      <h1>AquaLoRa Dashboard</h1>
      <p className="status">{latest ? `Connected — node ${latest.node_id}` : 'Waiting for Master Node...'}</p>

      {latest && (
        <div className="readings">
          <div className="reading-card">
            <span className="label">Temperature</span>
            <span className="value">{latest.temperature.toFixed(1)} &deg;C</span>
          </div>
          <div className="reading-card">
            <span className="label">Turbidity</span>
            <span className="value">{latest.turbidity.toFixed(1)} NTU</span>
          </div>
          <div className="reading-card">
            <span className="label">TDS</span>
            <span className="value">{latest.tds.toFixed(0)} ppm</span>
          </div>
          <div className="reading-card">
            <span className="label">Battery</span>
            <span className="value">{latest.battery_pct}%</span>
          </div>
          <div className="reading-card">
            <span className="label">RSSI</span>
            <span className="value">{latest.rssi} dBm</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
