import { useEffect, useState } from 'react'

interface DiscoveredNode {
  node_id: string
}

interface InitialSetupScreenProps {
  onActivated: (session: {
    token: string
    masterNodeId: number
    nodeCode: string
    displayName: string
    role: string
  }) => void
}

type SetupStep = 'connection' | 'login'

function InitialSetupScreen({ onActivated }: InitialSetupScreenProps): React.JSX.Element {
  const [step, setStep] = useState<SetupStep>('connection')
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPassword, setWifiPassword] = useState('')
  const [masterNodeUrl, setMasterNodeUrl] = useState('ws://192.168.1.50:8081')
  const [pairingPassword, setPairingPassword] = useState('aqualora123')
  const [cloudPassword, setCloudPassword] = useState('')
  const [nodes, setNodes] = useState<DiscoveredNode[]>([])
  const [selectedNodeCode, setSelectedNodeCode] = useState('')
  const [currentWifi, setCurrentWifi] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Connect the desktop to the same Wi-Fi network as the ESP32.')

  useEffect(() => {
    let active = true
    void window.api.getSettings().then((settings) => {
      if (!active) return
      setWifiSsid(settings.savedWifiSsid ?? '')
      setMasterNodeUrl(settings.masterNodeUrl ?? 'ws://192.168.1.50:8081')
      setCloudPassword('')
    })
    void window.api.getWifiStatus().then((state) => {
      if (active) setCurrentWifi(state.ssid)
    })

    const unsubscribeNodes = window.api.onNodesDiscovered((discovered) => {
      if (!active) return
      const nextNodes = discovered.filter((node) => node.node_id).map((node) => ({ node_id: node.node_id }))
      setNodes(nextNodes)
      if (nextNodes.length > 0) {
        setSelectedNodeCode(nextNodes[0].node_id)
        setStep('login')
        setStatus('ESP32 connected. Enter the cloud password for this facility.')
      }
    })
    const unsubscribeStatus = window.api.onConnectionStatus((connectionStatus) => {
      if (!active) return
      setStatus(connectionStatus === 'connected' ? 'ESP32 WebSocket connected. Waiting for node identity...' : 'ESP32 connection lost. Retrying...')
    })

    return () => {
      active = false
      unsubscribeNodes()
      unsubscribeStatus()
    }
  }, [])

  async function connectDevice(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    if (!wifiSsid.trim() || !masterNodeUrl.trim() || !pairingPassword.trim()) {
      setError('Wi-Fi SSID, ESP32 URL, and pairing password are required.')
      return
    }

    setBusy(true)
    setNodes([])
    setSelectedNodeCode('')
    setStatus('Connecting to Wi-Fi and ESP32...')
    try {
      await window.api.setSetting('savedWifiSsid', wifiSsid.trim())
      await window.api.setSetting('savedWifiPassword', wifiPassword)
      await window.api.setSetting('masterNodeUrl', masterNodeUrl.trim())
      await window.api.connectWifi(wifiSsid.trim(), wifiPassword)
      const wifiState = await window.api.getWifiStatus()
      setCurrentWifi(wifiState.ssid)
      await window.api.connectMasterNode(masterNodeUrl.trim(), pairingPassword.trim())
      setStatus('ESP32 connection started. Waiting for its node identity...')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to Wi-Fi or ESP32.')
      setStatus('Connection failed. Check that both devices use the same Wi-Fi.')
    } finally {
      setBusy(false)
    }
  }

  async function loginToCloud(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    if (!selectedNodeCode || !cloudPassword) {
      setError('Enter the password for the discovered facility.')
      return
    }

    setBusy(true)
    try {
      const session = await window.api.cloudLogin(selectedNodeCode, cloudPassword)
      onActivated(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cloud login failed. Ask an administrator to create this facility first.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-form" onSubmit={step === 'connection' ? connectDevice : loginToCloud} style={{ width: 390 }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 32 }}>🌊</span>
        </div>
        <h1>{step === 'connection' ? 'Connect AquaLora device' : 'Sign in to facility'}</h1>
        <p className="login-subtitle">{status}</p>
        {error && <p className="login-error">{error}</p>}

        {step === 'connection' ? (
          <>
            <label htmlFor="wifi-ssid">Wi-Fi network</label>
            <input id="wifi-ssid" value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} placeholder="Farm Wi-Fi name" required />
            <label htmlFor="wifi-password">Wi-Fi password</label>
            <input id="wifi-password" type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} placeholder="Router password" />
            <label htmlFor="master-node-url">ESP32 WebSocket URL</label>
            <input id="master-node-url" value={masterNodeUrl} onChange={(event) => setMasterNodeUrl(event.target.value)} placeholder="ws://192.168.1.50:8081" required />
            <label htmlFor="pairing-password">ESP32 pairing password</label>
            <input id="pairing-password" type="password" value={pairingPassword} onChange={(event) => setPairingPassword(event.target.value)} required />
            <button type="submit" className="login-submit-btn" disabled={busy}>{busy ? 'Connecting...' : 'Connect Wi-Fi and ESP32'}</button>
            <p className="login-subtitle">Current desktop Wi-Fi: {currentWifi ?? 'not connected'}</p>
          </>
        ) : (
          <>
            <label htmlFor="facility-code">Facility username</label>
            {nodes.length > 1 ? (
              <select id="facility-code" value={selectedNodeCode} onChange={(event) => setSelectedNodeCode(event.target.value)}>
                {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
              </select>
            ) : (
              <input id="facility-code" value={selectedNodeCode} readOnly />
            )}
            <label htmlFor="cloud-password">Facility password</label>
            <input id="cloud-password" type="password" value={cloudPassword} onChange={(event) => setCloudPassword(event.target.value)} placeholder="Enter facility password" required />
            <button type="submit" className="login-submit-btn" disabled={busy}>{busy ? 'Signing in...' : 'Sign in and start sync'}</button>
            <button type="button" className="apply-btn" onClick={() => { setStep('connection'); setError(null) }}>Back to connection</button>
          </>
        )}
      </form>
    </div>
  )
}

export default InitialSetupScreen
