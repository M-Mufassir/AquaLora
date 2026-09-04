import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WifiNetwork, DiscoveredMasterNode } from '../../../shared/types'

type WizardStep = 'wifi' | 'discovery' | 'login'

function ConnectDevicePage(): React.JSX.Element {
  const navigate = useNavigate()

  const [step, setStep] = useState<WizardStep>('wifi')

  // Step 1: Wi-Fi state
  const [currentSsid, setCurrentSsid] = useState<string | null>(null)
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([])
  const [isScanningWifi, setIsScanningWifi] = useState(false)
  const [selectedSsid, setSelectedSsid] = useState<string>('')
  const [wifiPassword, setWifiPassword] = useState<string>('')
  const [isConnectingWifi, setIsConnectingWifi] = useState(false)
  const [wifiError, setWifiError] = useState<string | null>(null)

  // Step 2: Discovery state
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredMasterNode[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredMasterNode | null>(null)
  const [manualIp, setManualIp] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)

  // Step 3: Pairing / Login state
  const [pairingPassword, setPairingPassword] = useState('aqualora123')
  const [isConnectingDevice, setIsConnectingDevice] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectSuccess, setConnectSuccess] = useState(false)

  const unsubscribeDiscoveryRef = useRef<(() => void) | null>(null)

  // On mount: check current Wi-Fi status, scan networks, and start discovery listener
  useEffect(() => {
    checkWifiStatus()
    scanWifiNetworks()
    startDiscoveryListener()

    return () => {
      if (unsubscribeDiscoveryRef.current) {
        unsubscribeDiscoveryRef.current()
      }
      window.api.stopDiscovery().catch(() => {})
    }
  }, [])

  function startDiscoveryListener(): void {
    window.api.startDiscovery().catch(console.warn)

    if (unsubscribeDiscoveryRef.current) {
      unsubscribeDiscoveryRef.current()
    }

    unsubscribeDiscoveryRef.current = window.api.onDeviceDiscovered((device) => {
      setDiscoveredDevices((prev) => {
        const index = prev.findIndex((d) => d.ip === device.ip)
        if (index >= 0) {
          const updated = [...prev]
          updated[index] = device
          return updated
        }
        return [...prev, device]
      })

      // Automatically select if it's the first discovered device
      setSelectedDevice((prev) => prev ?? device)
    })
  }

  async function checkWifiStatus(): Promise<void> {
    try {
      const status = await window.api.getWifiStatus()
      setCurrentSsid(status.ssid)
      if (status.ssid) {
        setSelectedSsid(status.ssid)
      }
    } catch (err) {
      console.warn('Failed to get Wi-Fi status:', err)
    }
  }

  async function scanWifiNetworks(): Promise<void> {
    setIsScanningWifi(true)
    setWifiError(null)
    try {
      const networks = await window.api.scanWifi()
      setWifiNetworks(networks)
    } catch (err) {
      setWifiError('Failed to scan Wi-Fi networks.')
      console.error(err)
    } finally {
      setIsScanningWifi(false)
    }
  }

  async function handleConnectWifi(): Promise<void> {
    if (!selectedSsid) return
    setIsConnectingWifi(true)
    setWifiError(null)
    try {
      await window.api.connectWifi(selectedSsid, wifiPassword)
      // Verify connection after short delay
      setTimeout(async () => {
        await checkWifiStatus()
        setIsConnectingWifi(false)
      }, 1500)
    } catch (err) {
      setWifiError('Could not connect to Wi-Fi. Check password or join via Windows.')
      setIsConnectingWifi(false)
    }
  }

  // Switch to UDP Discovery step
  function startDiscoveryProcess(): void {
    setStep('discovery')
    startDiscoveryListener()
  }

  // Handle proceed from Discovery to Pairing/Login
  function handleSelectDevice(device: DiscoveredMasterNode): void {
    setSelectedDevice(device)
    setStep('login')
  }

  function handleManualProceed(): void {
    if (!manualIp.trim()) return
    const customDevice: DiscoveredMasterNode = {
      id: 'Manual Node',
      ip: manualIp.trim().replace(/^ws:\/\//, '').split(':')[0],
      port: Number(manualIp.trim().split(':')[1] || 8081),
      lastSeen: new Date().toISOString()
    }
    setSelectedDevice(customDevice)
    setStep('login')
  }

  // Connect to Master Node via WebSocket
  async function handleFinalConnect(): Promise<void> {
    if (!selectedDevice) return
    setIsConnectingDevice(true)
    setConnectError(null)

    const wsUrl = `ws://${selectedDevice.ip}:${selectedDevice.port || 8081}`

    try {
      // Connect WebSocket in main process
      await window.api.connectMasterNode(wsUrl, pairingPassword)
      await window.api.setSetting('masterNodeUrl', wsUrl)

      let hasConnected = false
      let statusTimer: NodeJS.Timeout | null = null

      // Listen for connection status
      const unsubscribeStatus = window.api.onConnectionStatus((status) => {
        if (status === 'connected') {
          hasConnected = true
          if (statusTimer) clearTimeout(statusTimer)
          setConnectSuccess(true)
          setIsConnectingDevice(false)
          unsubscribeStatus()

          // Automatically redirect to Dashboard after brief success display
          setTimeout(() => {
            navigate('/')
          }, 1200)
        }
      })

      // Timeout in case ESP32 is unreachable or credentials mismatch
      statusTimer = setTimeout(() => {
        if (!hasConnected) {
          setIsConnectingDevice(false)
          setConnectError(
            'Master Node did not respond within 8 seconds. Please check that the ESP32 is running and the pairing password is correct.'
          )
          unsubscribeStatus()
        }
      }, 8000)
    } catch (err) {
      setIsConnectingDevice(false)
      setConnectError(err instanceof Error ? err.message : 'Connection failed.')
    }
  }

  return (
    <div className="page connect-page">
      <h1>Connect Master Node</h1>
      <p className="page-subtitle">
        Pair your AquaLoRa ESP32 telemetry gateway to monitor fish and prawn ponds in real-time.
      </p>

      {/* Stepper Header */}
      <div className="wizard-steps">
        <button
          className={`wizard-step ${step === 'wifi' ? 'active' : 'completed'}`}
          onClick={() => setStep('wifi')}
        >
          <div className="wizard-step-circle">{step !== 'wifi' ? '✓' : '1'}</div>
          <span className="wizard-step-label">1. Wi-Fi Network</span>
        </button>

        <button
          className={`wizard-step ${step === 'discovery' ? 'active' : step === 'login' ? 'completed' : ''}`}
          onClick={() => startDiscoveryProcess()}
        >
          <div className="wizard-step-circle">{step === 'login' ? '✓' : '2'}</div>
          <span className="wizard-step-label">2. Auto-Discovery</span>
        </button>

        <button
          className={`wizard-step ${step === 'login' ? 'active' : ''}`}
          onClick={() => selectedDevice && setStep('login')}
          disabled={!selectedDevice}
        >
          <div className="wizard-step-circle">3</div>
          <span className="wizard-step-label">3. Device Pairing</span>
        </button>
      </div>

      {/* STEP 1: WI-FI / HOTSPOT CONNECTION */}
      {step === 'wifi' && (
        <section className="settings-section">
          <h2>Step 1: Check Wi-Fi / Hotspot Connection</h2>
          <p className="status">
            Ensure this computer and the ESP32 Master Node are on the same Wi-Fi router or mobile hotspot.
          </p>

          {currentSsid ? (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(12, 163, 12, 0.12)',
                border: '1px solid rgba(12, 163, 12, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                margin: '12px 0 16px'
              }}
            >
              <div>
                <span style={{ color: 'var(--status-good)', fontWeight: 600 }}>
                  🟢 Connected to: {currentSsid}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                  Your desktop is ready to discover local ESP32 Master Nodes.
                </p>
              </div>
              <button className="apply-btn" onClick={() => checkWifiStatus()}>
                Refresh
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(250, 178, 25, 0.12)',
                border: '1px solid rgba(250, 178, 25, 0.3)',
                margin: '12px 0 16px'
              }}
            >
              <span style={{ color: 'var(--status-warning)', fontWeight: 600 }}>
                🟡 Not Connected to Wi-Fi
              </span>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                Please join the shared hotspot or router before proceeding.
              </p>
            </div>
          )}

          {discoveredDevices.length > 0 && (
            <div
              style={{
                padding: '14px 18px',
                borderRadius: '8px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px'
              }}
            >
              <div>
                <strong style={{ color: '#4aa8ff', fontSize: '14px' }}>
                  ⚡ Master Node Found: {discoveredDevices[0].id} ({discoveredDevices[0].ip})
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                  Beacon received via UDP port 8082. You can pair immediately without entering an IP.
                </p>
              </div>
              <button
                className="login-submit-btn"
                onClick={() => {
                  setSelectedDevice(discoveredDevices[0])
                  setStep('login')
                }}
                style={{ margin: 0, padding: '8px 16px', fontSize: '13px' }}
              >
                Pair Now →
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              className="apply-btn"
              onClick={scanWifiNetworks}
              disabled={isScanningWifi}
            >
              {isScanningWifi ? 'Scanning Networks…' : '🔄 Scan Wi-Fi Networks'}
            </button>
            <button
              className="apply-btn"
              onClick={() => window.api.openWifiSettings()}
            >
              Open Windows Settings
            </button>
          </div>

          {wifiError && <p style={{ color: 'var(--status-critical)', fontSize: '13px' }}>{wifiError}</p>}

          {/* Wi-Fi Networks list */}
          {wifiNetworks.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ev-c-text-1)' }}>
                Nearby Wi-Fi Networks:
              </label>
              <ul className="wifi-list" style={{ marginTop: '8px' }}>
                {wifiNetworks.map((net) => {
                  const isSelected = selectedSsid === net.ssid
                  return (
                    <li
                      key={net.ssid}
                      className={`wifi-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedSsid(net.ssid)}
                    >
                      <span className="wifi-ssid">
                        📶 <strong>{net.ssid}</strong> {net.ssid === currentSsid && '(Active)'}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                        {net.security || 'WPA2'}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {selectedSsid && selectedSsid !== currentSsid && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="password"
                    placeholder={`Password for ${selectedSsid}`}
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-background)',
                      color: 'var(--ev-c-text-1)'
                    }}
                  />
                  <button
                    className="login-submit-btn"
                    onClick={handleConnectWifi}
                    disabled={isConnectingWifi}
                    style={{ margin: 0, whiteSpace: 'nowrap' }}
                  >
                    {isConnectingWifi ? 'Connecting…' : 'Connect Wi-Fi'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="action-row">
            <button className="apply-btn" onClick={() => navigate('/')}>
              Cancel
            </button>
            <button
              className="login-submit-btn"
              onClick={startDiscoveryProcess}
              style={{ margin: 0 }}
            >
              Proceed to Device Discovery →
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: UDP AUTO-DISCOVERY */}
      {step === 'discovery' && (
        <section className="settings-section discovery-panel">
          <h2>Step 2: Searching for AquaLoRa Master Node</h2>
          <p className="status">
            Listening for automatic UDP broadcast beacons from the ESP32 on port 8082...
          </p>

          <div className="radar-container">
            <div className="radar-ping">📡</div>
            <strong style={{ color: 'var(--ev-c-text-1)', fontSize: '14px' }}>
              Scanning local network…
            </strong>
            <span style={{ fontSize: '12px', color: 'var(--ev-c-text-2)', marginTop: '4px' }}>
              Make sure your ESP32 Master Node is powered on and connected to the hotspot.
            </span>
          </div>

          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '14px', margin: 0, color: 'var(--ev-c-text-1)' }}>
                Discovered Devices ({discoveredDevices.length})
              </h3>
              <button
                className="apply-btn"
                onClick={() => setShowManualInput(!showManualInput)}
                style={{ fontSize: '11px' }}
              >
                {showManualInput ? 'Hide Manual Entry' : 'Manual IP Entry'}
              </button>
            </div>

            {discoveredDevices.length === 0 && !showManualInput && (
              <p style={{ fontSize: '13px', color: 'var(--ev-c-text-3)', marginTop: '12px' }}>
                Waiting for the first UDP beacon… (broadcasts every 3 seconds)
              </p>
            )}

            <div className="device-card-list">
              {discoveredDevices.map((device) => {
                const isSelected = selectedDevice?.ip === device.ip
                return (
                  <div
                    key={device.ip}
                    className={`device-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectDevice(device)}
                  >
                    <div className="device-card-info">
                      <div className="device-id-row">
                        <span className="device-id">⚡ {device.id}</span>
                        <span className="device-badge">Auto Discovered</span>
                      </div>
                      <div className="device-meta">
                        <span>IP: <strong>{device.ip}</strong></span>
                        <span>Port: {device.port || 8081}</span>
                        <span>Mode: {device.mode || 'STA'}</span>
                      </div>
                    </div>
                    <button
                      className="login-submit-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectDevice(device)
                      }}
                      style={{ margin: 0, padding: '6px 14px', fontSize: '12px' }}
                    >
                      Pair Device →
                    </button>
                  </div>
                )
              })}
            </div>

            {showManualInput && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--color-background-soft)',
                  border: '1px solid var(--color-border)'
                }}
              >
                <label style={{ fontSize: '12px', color: 'var(--ev-c-text-2)', display: 'block', marginBottom: '6px' }}>
                  Manual Endpoint (e.g. 192.168.43.55:8081 or localhost:8081):
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="192.168.1.100:8081"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-background)',
                      color: 'var(--ev-c-text-1)'
                    }}
                  />
                  <button
                    className="login-submit-btn"
                    onClick={handleManualProceed}
                    style={{ margin: 0 }}
                  >
                    Pair Manual IP
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="action-row">
            <button className="apply-btn" onClick={() => setStep('wifi')}>
              ← Back to Wi-Fi
            </button>
            {selectedDevice && (
              <button
                className="login-submit-btn"
                onClick={() => setStep('login')}
                style={{ margin: 0 }}
              >
                Proceed to Pairing ({selectedDevice.id}) →
              </button>
            )}
          </div>
        </section>
      )}

      {/* STEP 3: PAIRING / LOGIN */}
      {step === 'login' && selectedDevice && (
        <section className="settings-section">
          <h2>Step 3: Pair with {selectedDevice.id}</h2>
          <p className="status">
            Authenticate the encrypted AES-256-GCM WebSocket link between this desktop app and your ESP32 Master Node.
          </p>

          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: 'var(--color-background-soft)',
              border: '1px solid var(--color-border)',
              margin: '16px 0'
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '8px', fontSize: '13px' }}>
              <span style={{ color: 'var(--ev-c-text-2)' }}>Device ID:</span>
              <strong style={{ color: 'var(--ev-c-text-1)' }}>{selectedDevice.id}</strong>

              <span style={{ color: 'var(--ev-c-text-2)' }}>IP Address:</span>
              <strong style={{ color: 'var(--ev-c-text-1)' }}>{selectedDevice.ip}</strong>

              <span style={{ color: 'var(--ev-c-text-2)' }}>WebSocket Port:</span>
              <strong style={{ color: 'var(--ev-c-text-1)' }}>{selectedDevice.port || 8081}</strong>

              <span style={{ color: 'var(--ev-c-text-2)' }}>Target URL:</span>
              <code style={{ color: '#4aa8ff' }}>ws://{selectedDevice.ip}:{selectedDevice.port || 8081}</code>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '14px 0' }} />

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--ev-c-text-1)' }}>
                Master Node Pairing Secret:
              </label>
              <input
                type="password"
                value={pairingPassword}
                onChange={(e) => setPairingPassword(e.target.value)}
                placeholder="aqualora123"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--ev-c-text-1)',
                  fontSize: '14px'
                }}
              />
              <span style={{ fontSize: '11px', color: 'var(--ev-c-text-3)', display: 'block', marginTop: '4px' }}>
                Default firmware secret is <code>aqualora123</code>. Derives the AES-256-GCM encryption key.
              </span>
            </div>
          </div>

          {connectError && (
            <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: 'rgba(208, 59, 59, 0.15)', color: 'var(--status-critical)', fontSize: '13px', marginBottom: '12px' }}>
              ⚠️ {connectError}
            </div>
          )}

          {connectSuccess && (
            <div style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: 'rgba(12, 163, 12, 0.15)', color: 'var(--status-good)', fontSize: '13px', marginBottom: '12px' }}>
              ✅ Successfully connected to Master Node! Opening Dashboard…
            </div>
          )}

          <div className="action-row">
            <button className="apply-btn" onClick={() => setStep('discovery')}>
              ← Back to Discovery
            </button>
            <button
              className="login-submit-btn"
              onClick={handleFinalConnect}
              disabled={isConnectingDevice || connectSuccess}
              style={{ margin: 0 }}
            >
              {isConnectingDevice ? 'Establishing Secure Link…' : 'Pair & Enter Dashboard →'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default ConnectDevicePage
