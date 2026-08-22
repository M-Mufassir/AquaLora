import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WifiNetwork, NodeListMessage } from '../../../shared/types'

// The gateway IP any ESP32 running WiFi.softAP() hands out by default —
// the dashboard doesn't need to discover this, it's fixed by the AP mode.
const MCU_MASTER_NODE_URL = 'ws://192.168.4.1:8081'
const MOCK_MASTER_NODE_URL = 'ws://localhost:8081'

type Step = 'scan' | 'password' | 'linking' | 'discovered'

function signalBars(signalLevel: number): number {
  if (signalLevel >= 75) return 4
  if (signalLevel >= 50) return 3
  if (signalLevel >= 25) return 2
  return 1
}

function ConnectDevicePage(): React.JSX.Element {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('scan')
  const [scanning, setScanning] = useState(false)
  const [networks, setNetworks] = useState<WifiNetwork[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [selectedSsid, setSelectedSsid] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [discoveredNodes, setDiscoveredNodes] = useState<NodeListMessage['nodes']>([])
  const [encrypted, setEncrypted] = useState(false)

  useEffect(() => {
    if (step !== 'linking') return
    return window.api.onNodesDiscovered((nodes) => {
      setDiscoveredNodes(nodes)
      setStep('discovered')
    })
  }, [step])

  async function handleScan(): Promise<void> {
    setScanning(true)
    setScanError(null)
    try {
      const results = await window.api.scanWifi()
      setNetworks(results)
    } catch (err) {
      setScanError(
        'Could not scan for WiFi networks — the adapter may be off, or Windows blocked it.'
      )
      console.error(err)
    } finally {
      setScanning(false)
    }
  }

  function selectNetwork(ssid: string): void {
    setSelectedSsid(ssid)
    setPassword('')
    setJoinError(null)
    setStep('password')
  }

  async function handleJoin(): Promise<void> {
    if (!selectedSsid) return
    setJoining(true)
    setJoinError(null)
    try {
      await window.api.connectWifi(selectedSsid, password)
      startLinking(MCU_MASTER_NODE_URL, password)
    } catch (err) {
      setJoinError(
        `Couldn't join "${selectedSsid}" automatically — this can happen if Windows requires elevated permissions to add a network profile.`
      )
      console.error(err)
    } finally {
      setJoining(false)
    }
  }

  // pw drives end-to-end encryption (AES-256-GCM, derived from this same
  // WiFi password — see secureChannel.ts): omit it only for the dev mock,
  // which speaks plain JSON and wouldn't understand an encrypted envelope.
  function startLinking(url: string = MCU_MASTER_NODE_URL, pw?: string): void {
    setDiscoveredNodes([])
    setEncrypted(!!pw)
    setStep('linking')
    window.api.connectMasterNode(url, pw)
  }

  async function handleOpenWifiSettings(): Promise<void> {
    await window.api.openWifiSettings()
  }

  return (
    <div className="page connect-page">
      <h1>Connect Device</h1>
      <p className="page-subtitle">
        Pair with the Master Node&apos;s own WiFi network, then it hands over its detected sensor
        nodes automatically — no manual setup needed.
      </p>

      {step === 'scan' && (
        <section className="settings-section">
          <h2>1. Enable WiFi &amp; Scan</h2>
          <button className="login-submit-btn" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Enable WiFi & Scan for Devices'}
          </button>
          {scanError && (
            <>
              <p className="login-error">{scanError}</p>
              <button className="apply-btn" onClick={handleOpenWifiSettings}>
                Open Windows WiFi Settings
              </button>
            </>
          )}

          {networks.length > 0 && (
            <ul className="wifi-list">
              {networks.map((n) => (
                <li key={n.ssid} className="wifi-item" onClick={() => selectNetwork(n.ssid)}>
                  <span className="wifi-ssid">
                    {n.ssid}
                    {/aqualora/i.test(n.ssid) && <span className="tier-badge tier-good">MCU</span>}
                  </span>
                  <span className="signal-bars">
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`signal-bar${i <= signalBars(n.signalLevel) ? ' filled' : ''}`}
                      />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {import.meta.env.DEV && (
            <button className="apply-btn" onClick={() => startLinking(MOCK_MASTER_NODE_URL)}>
              Skip pairing — use local mock (dev only)
            </button>
          )}
        </section>
      )}

      {step === 'password' && selectedSsid && (
        <section className="settings-section">
          <h2>2. Connect to &quot;{selectedSsid}&quot;</h2>
          <label htmlFor="wifi-password">Password</label>
          <input
            id="wifi-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <p className="modal-hint">
            {password
              ? 'Sensor data will be end-to-end encrypted using this password.'
              : 'No password — data will be sent unencrypted. Only do this on a network you trust.'}
          </p>
          {joinError && (
            <>
              <p className="login-error">{joinError}</p>
              <p className="status">
                You can also join this network from Windows directly, then continue here.
              </p>
              <div className="modal-actions">
                <button className="apply-btn" onClick={handleOpenWifiSettings}>
                  Open Windows WiFi Settings
                </button>
                <button
                  className="apply-btn"
                  onClick={() => startLinking(MCU_MASTER_NODE_URL, password)}
                >
                  I&apos;ve connected manually — Continue
                </button>
              </div>
            </>
          )}
          <div className="modal-actions">
            <button className="apply-btn" onClick={() => setStep('scan')}>
              Back
            </button>
            <button className="login-submit-btn" onClick={handleJoin} disabled={joining}>
              {joining ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </section>
      )}

      {step === 'linking' && (
        <section className="settings-section">
          <h2>3. Linking to Master Node…</h2>
          <p className="status">
            Connecting {encrypted ? '(encrypted)' : '(plain — dev mock)'} and waiting for it to
            report its sensor nodes.
          </p>
          <button className="apply-btn" onClick={() => setStep('scan')}>
            Cancel
          </button>
        </section>
      )}

      {step === 'discovered' && (
        <section className="settings-section">
          <h2>
            Connected{encrypted ? ' (encrypted)' : ''} — {discoveredNodes.length} node(s) detected
          </h2>
          <ul className="wifi-list">
            {discoveredNodes.map((n) => (
              <li key={n.node_id} className="wifi-item">
                <span className="wifi-ssid">{n.node_id}</span>
              </li>
            ))}
          </ul>
          <button className="login-submit-btn" onClick={() => navigate('/')}>
            Continue to Dashboard
          </button>
        </section>
      )}
    </div>
  )
}

export default ConnectDevicePage
