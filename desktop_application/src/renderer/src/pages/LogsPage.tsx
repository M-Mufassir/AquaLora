import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useReadingsStore, EMPTY_NODE_STATE } from '../store/useReadingsStore'
import { deriveStatusTier, deriveParamStatus } from '../../../shared/types'
import NodeList from '../components/NodeList'
import Gauge from '../components/Gauge'
import NodeStatusBar from '../components/NodeStatusBar'
import AlertList from '../components/AlertList'
import HistoryPanel from '../components/HistoryPanel'

function LogsPage(): React.JSX.Element {
  const { nodeId } = useParams<{ nodeId?: string }>()
  const navigate = useNavigate()
  const knownNodes = useReadingsStore((s) => s.knownNodes)
  const nodesById = useReadingsStore((s) => s.nodesById)
  const alerts = useReadingsStore((s) => s.alerts)
  const acknowledge = useReadingsStore((s) => s.acknowledge)

  useEffect(() => {
    if (!nodeId && knownNodes.length > 0) {
      navigate(`/logs/${knownNodes[0].id}`, { replace: true })
    }
  }, [nodeId, knownNodes, navigate])

  const selectedNode = knownNodes.find((n) => n.id === nodeId) ?? null
  const state = (nodeId && nodesById[nodeId]) || EMPTY_NODE_STATE
  const nodeAlerts = alerts.filter((a) => a.node_id === nodeId)
  const tier = deriveStatusTier(state.latestScore, state.status.online)

  async function handleAcknowledge(id: number): Promise<void> {
    acknowledge(id)
    await window.api.acknowledgeAlert(id)
  }

  return (
    <div className="page logs-page">
      <aside className="logs-sidebar">
        <NodeList nodes={knownNodes} nodesById={nodesById} selectedNodeId={nodeId ?? null} />
      </aside>

      <section className="logs-detail">
        {!selectedNode ? (
          <p className="status">
            Select a node, or pair a Master Node from Settings to get started.
          </p>
        ) : (
          <>
            <div className="detail-hero">
              <div className="detail-hero-content">
                <div className="detail-topline">
                  <span className="section-kicker">Node Overview</span>
                  <span className={`tier-badge tier-${tier.toLowerCase()}`}>{tier}</span>
                </div>
                <h1>{selectedNode.name || selectedNode.id}</h1>
                <div className="detail-meta-row">
                  {selectedNode.location && <span>{selectedNode.location}</span>}
                  <span>ID: {selectedNode.id}</span>
                  <span>{selectedNode.pond_type ? selectedNode.pond_type.toUpperCase() : 'UNASSIGNED'}</span>
                </div>
              </div>
              <div className="detail-stat-grid">
                <div className="detail-stat-pill">
                  <span className="detail-stat-label">Battery</span>
                  <strong>{state.status.batteryPct ?? '--'}%</strong>
                </div>
                <div className="detail-stat-pill">
                  <span className="detail-stat-label">Signal</span>
                  <strong>{state.status.rssi ?? '--'} dBm</strong>
                </div>
                <div className="detail-stat-pill">
                  <span className="detail-stat-label">Last Seen</span>
                  <strong>{state.status.lastSeen ? new Date(state.status.lastSeen).toLocaleString() : 'Never'}</strong>
                </div>
              </div>
            </div>

            <NodeStatusBar nodeId={selectedNode.id} status={state.status} />
            <AlertList alerts={nodeAlerts} onAcknowledge={handleAcknowledge} />

            <div className="detail-panel-block">
              <h2 className="home-section-title">Live</h2>
              {state.latest ? (
                <div className="gauges">
                  <Gauge
                    label="Temperature"
                    value={state.latest.temperature}
                    unit="°C"
                    min={0}
                    max={40}
                    status={deriveParamStatus(state.latestScore, 'temperature')}
                    accent="var(--cat-temperature)"
                  />
                  <Gauge
                    label="Turbidity"
                    value={state.latest.turbidity}
                    unit="NTU"
                    min={0}
                    max={100}
                    status={deriveParamStatus(state.latestScore, 'turbidity')}
                    accent="var(--cat-turbidity)"
                  />
                  <Gauge
                    label="TDS"
                    value={state.latest.tds}
                    unit="ppm"
                    min={0}
                    max={500}
                    decimals={0}
                    status={deriveParamStatus(state.latestScore, 'tds')}
                    accent="var(--cat-tds)"
                  />
                </div>
              ) : (
                <p className="status">Waiting for a reading from this node...</p>
              )}
            </div>

            <div className="detail-panel-block">
              <h2 className="home-section-title">History</h2>
              <HistoryPanel nodeId={selectedNode.id} />
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default LogsPage
