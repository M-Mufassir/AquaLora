import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WifiNetwork, DiscoveredMasterNode } from '../../../shared/types'

type WizardStep = 'wifi' | 'login'

interface ConnectDevicePageProps {
  onComplete?: (session: any, user: { username: string; role: string }) => void
  isOnboarding?: boolean
}

function ConnectDevicePage({ onComplete, isOnboarding = false }: ConnectDevicePageProps): React.JSX.Element {
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

  // Step 2: Auto-derived Node & Sign-In state
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredMasterNode[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredMasterNode | null>(null)
  const [nodeCode, setNodeCode] = useState('master-node')
  const [displayName, setDisplayName] = useState('AquaLoRa Master Node')
  const [nodeWsUrl, setNodeWsUrl] = useState('ws://10.41.47.240:8081')
  const [pairingPassword, setPairingPassword] = useState('aqualora123')
  const [cloudUrl, setCloudUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [isConnectingDevice, setIsConnectingDevice] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectSuccess, setConnectSuccess] = useState(false)
  const [isNewNodeWarning, setIsNewNodeWarning] = useState(false)
  const [previousNodeCode, setPreviousNodeCode] = useState<string | null>(null)
  const [adminPortalUrl, setAdminPortalUrl] = useState<string | null>(null)

  const unsubscribeDiscoveryRef = useRef<(() => void) | null>(null)

  // On mount: check current Wi-Fi status, scan networks, start UDP discovery
  useEffect(() => {
    checkWifiStatus()
    scanWifiNetworks()
    startDiscoveryListener()

    // Check if there's an existing paired node
    window.api.getCloudSession().then((session) => {
      if (session?.nodeCode) {
        setPreviousNodeCode(session.nodeCode)
      }
    })

    window.api.getSettings().then((settings) => {
      if (settings.cloudSyncUrl) {
        setCloudUrl(settings.cloudSyncUrl)
      }
      if (settings.masterNodeUrl) {
        setNodeWsUrl(settings.masterNodeUrl)
      }
    })

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

      // Auto-select first discovered device and auto-derive form fields
      setSelectedDevice((prev) => {
        if (!prev) {
          setNodeCode(device.id)
          setNodeWsUrl(`ws://${device.ip}:${device.port || 8081}`)
          // Check if this is a different node from what was previously paired
          setPreviousNodeCode((prevCode) => {
            if (prevCode && prevCode !== device.id) {
              setIsNewNodeWarning(true)
            }
            return prevCode
          })
          return device
        }
        return prev
      })
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
      setTimeout(async () => {
        await checkWifiStatus()
        setIsConnectingWifi(false)
      }, 1500)
    } catch (err) {
      setWifiError('Could not connect to Wi-Fi. Check password or join via Windows Settings.')
      setIsConnectingWifi(false)
    }
  }

  function handleSelectDiscoveredDevice(device: DiscoveredMasterNode): void {
    setSelectedDevice(device)
    setNodeCode(device.id)
    setNodeWsUrl(`ws://${device.ip}:${device.port || 8081}`)
    setStep('login')
  }

  function handleProceedToLogin(): void {
    if (selectedDevice) {
      setNodeCode(selectedDevice.id)
      setNodeWsUrl(`ws://${selectedDevice.ip}:${selectedDevice.port || 8081}`)
    } else if (discoveredDevices.length > 0) {
      const dev = discoveredDevices[0]
      setSelectedDevice(dev)
      setNodeCode(dev.id)
      setNodeWsUrl(`ws://${dev.ip}:${dev.port || 8081}`)
    }
    setStep('login')
  }

  async function handleMasterNodeLogin(): Promise<void> {
    if (!nodeCode.trim()) {
      setConnectError('Master Node username / code is required.')
      return
    }
    if (!nodeWsUrl.trim()) {
      setConnectError('Master Node WebSocket URL is required.')
      return
    }

    setIsConnectingDevice(true)
    setConnectError(null)
    setStatusMessage('Connecting to ESP32 Master Node…')

    try {
      const result = await window.api.setupMasterNodeSession({
        nodeCode: nodeCode.trim(),
        displayName: displayName.trim() || nodeCode.trim(),
        password: pairingPassword,
        wsUrl: nodeWsUrl.trim(),
        cloudUrl: cloudUrl.trim() || undefined
      })

      if (result.session?.role === 'super_admin') {
        const portalUrl = (cloudUrl.trim() || 'https://aqualora.up.railway.app/api').replace(/\/api\/?$/, '')
        setAdminPortalUrl(portalUrl)
        setIsConnectingDevice(false)
        return
      }

      setStatusMessage(result.message || 'Master Node paired and added to local gateway.')

      let statusTimer: NodeJS.Timeout | null = null

      const unsubscribeStatus = window.api.onConnectionStatus((status) => {
        if (status === 'connected') {
          if (statusTimer) clearTimeout(statusTimer)
          setConnectSuccess(true)
          setIsConnectingDevice(false)
          unsubscribeStatus()

          setTimeout(() => {
            if (onComplete) {
              onComplete(result.session, result.user)
            } else {
              navigate('/')
            }
          }, 800)
        }
      })

      // Timeout fallback: session is configured, reconnect logic continues in background
      statusTimer = setTimeout(() => {
        unsubscribeStatus()
        setConnectSuccess(true)
        setIsConnectingDevice(false)
        if (onComplete) {
          onComplete(result.session, result.user)
        } else {
          navigate('/')
        }
      }, 4000)
    } catch (err) {
      setIsConnectingDevice(false)
      setStatusMessage(null)
      setConnectError(err instanceof Error ? err.message : 'Failed to initialize Master Node session.')
    }
  }

  const isAutoDerived = selectedDevice?.id === nodeCode || discoveredDevices.some((d) => d.id === nodeCode)

  return (
    <div className={`page connect-page ${isOnboarding ? 'onboarding-mode' : ''}`} style={isOnboarding ? { margin: '40px auto', maxWidth: '620px' } : {}}>
      {adminPortalUrl && (
        <div className="admin-redirect-modal" role="dialog" aria-modal="true" aria-labelledby="admin-redirect-title">
          <div className="admin-redirect-card">
            <div className="admin-redirect-icon">🔐</div>
            <h2 id="admin-redirect-title">Administrator account detected</h2>
            <p>The desktop application is for facility operators. Administrator accounts must use the AquaLoRa web administration console.</p>
            <button className="apply-btn admin-redirect-primary" onClick={() => void window.api.openExternal(adminPortalUrl)}>
              Open web admin console
            </button>
            <p className="admin-redirect-url">{adminPortalUrl}</p>
            <button className="admin-redirect-secondary" onClick={() => { setAdminPortalUrl(null); void window.api.cloudLogout() }}>
              Return to desktop login
            </button>
          </div>
        </div>
      )}
      {isOnboarding && (
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '28px', color: '#4aa8ff', margin: 0, fontWeight: 800 }}>AquaLoRa</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--ev-c-text-2)', fontSize: '14px' }}>
            Aquaculture Telemetry & Monitoring Gateway
          </p>
        </div>
      )}

      {!isOnboarding && <h1>Connect Master Node</h1>}
      <p className="page-subtitle" style={{ marginBottom: '20px' }}>
        {step === 'wifi'
          ? 'Step 1: Connect your computer to the same Wi-Fi network or hotspot as your ESP32.'
          : 'Step 2: Sign in with your ESP32 Master Node to link live telemetry and register with the cloud.'}
      </p>

      {/* Stepper Header */}
      <div className="wizard-steps" style={{ marginBottom: '28px' }}>
        <button
          className={`wizard-step ${step === 'wifi' ? 'active' : 'completed'}`}
          onClick={() => setStep('wifi')}
          type="button"
        >
          <div className="wizard-step-circle">{step !== 'wifi' ? '✓' : '1'}</div>
          <span className="wizard-step-label">1. Wi-Fi Connection</span>
        </button>

        <button
          className={`wizard-step ${step === 'login' ? 'active' : ''}`}
          onClick={handleProceedToLogin}
          type="button"
        >
          <div className="wizard-step-circle">2</div>
          <span className="wizard-step-label">2. ESP32 Sign-In</span>
        </button>
      </div>

      {/* STEP 1: WI-FI NETWORK */}
      {step === 'wifi' && (
        <section className="settings-section">
          <h2>Step 1: Wi-Fi / Hotspot Connection</h2>
          <p className="status">
            Ensure this computer and the ESP32 Master Node are on the same Wi-Fi router or mobile hotspot.
          </p>

          {/* Current Connection Status */}
          {currentSsid ? (
            <div
              style={{
                padding: '14px 18px',
                borderRadius: '8px',
                backgroundColor: 'rgba(12, 163, 12, 0.12)',
                border: '1px solid rgba(12, 163, 12, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                margin: '14px 0 16px'
              }}
            >
              <div>
                <span style={{ color: 'var(--status-good)', fontWeight: 600, fontSize: '14px' }}>
                  🟢 Connected to: {currentSsid}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                  Local network connection active. Ready to discover ESP32 Master Nodes.
                </p>
              </div>
              <button className="apply-btn" onClick={() => checkWifiStatus()}>
                Refresh
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '14px 18px',
                borderRadius: '8px',
                backgroundColor: 'rgba(250, 178, 25, 0.12)',
                border: '1px solid rgba(250, 178, 25, 0.3)',
                margin: '14px 0 16px'
              }}
            >
              <span style={{ color: 'var(--status-warning)', fontWeight: 600, fontSize: '14px' }}>
                🟡 Not Connected to Wi-Fi
              </span>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                Please join your shared hotspot or router before proceeding.
              </p>
            </div>
          )}

          {/* Live UDP Discovery Card */}
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
                  ⚡ Master Node Detected: {discoveredDevices[0].id}
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                  Broadcasting beacon at <strong>{discoveredDevices[0].ip}:{discoveredDevices[0].port || 8081}</strong>.
                </p>
              </div>
              <button
                className="login-submit-btn"
                onClick={() => handleSelectDiscoveredDevice(discoveredDevices[0])}
                style={{ margin: 0, padding: '8px 16px', fontSize: '13px' }}
              >
                Sign In with Node →
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

          {/* Wi-Fi Networks List */}
          {wifiNetworks.length > 0 && (
            <div style={{ marginTop: '12px', marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ev-c-text-1)' }}>
                Available Wi-Fi Networks:
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
                <div style={{ marginTop: '14px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="password"
                    placeholder={`Password for ${selectedSsid}`}
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
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

          <div className="action-row" style={{ marginTop: '24px' }}>
            {!isOnboarding && (
              <button className="apply-btn" onClick={() => navigate('/')}>
                Cancel
              </button>
            )}
            <button
              className="login-submit-btn"
              onClick={handleProceedToLogin}
              style={{ margin: 0, marginLeft: 'auto' }}
            >
              Continue to ESP32 Sign-In →
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: AUTO-DERIVED SIGN-IN */}
      {step === 'login' && (
        <section className="settings-section">
          <h2>Step 2: ESP32 Master Node Sign-In</h2>
          <p className="status">
            Sign in with your ESP32 Master Node. Telemetry encryption will be configured and your node will be registered with the cloud backend.
          </p>

          {isAutoDerived && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                margin: '12px 0 8px',
                fontSize: '13px',
                color: '#4aa8ff'
              }}
            >
              <span>⚡</span>
              <span>
                Node identity automatically derived from local ESP32 broadcast: <strong>{nodeCode}</strong>
              </span>
            </div>
          )}

          {/* New-node database reset warning */}
          {isNewNodeWarning && previousNodeCode && previousNodeCode !== nodeCode && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                margin: '0 0 16px',
                fontSize: '13px'
              }}
            >
              <strong style={{ color: '#f59e0b', display: 'block', marginBottom: '4px' }}>
                ⚠️ New Master Node Detected
              </strong>
              <p style={{ margin: '0 0 8px', color: 'var(--ev-c-text-1)', lineHeight: 1.5 }}>
                Previously paired with <code>{previousNodeCode}</code>. Signing in as{' '}
                <code>{nodeCode}</code> will <strong>reset all local telemetry data</strong>{' '}
                (readings, nodes, alerts) so this station starts fresh with the new node.
              </p>
              <p style={{ margin: 0, color: 'var(--ev-c-text-2)', fontSize: '12px' }}>
                Cloud-synced data is preserved. Confirm by clicking "Sign In &amp; Launch Dashboard".
              </p>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              padding: '18px',
              borderRadius: '8px',
              backgroundColor: 'var(--color-background-soft)',
              border: '1px solid var(--color-border)',
              margin: '16px 0'
            }}
          >
            {/* Master Node Code / Username */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ev-c-text-1)' }}>
                  Master Node Username / Code:
                </label>
                {isAutoDerived && (
                  <span style={{ fontSize: '11px', color: '#4aa8ff', fontWeight: 600 }}>
                    ✓ Auto-derived
                  </span>
                )}
              </div>
              <input
                type="text"
                value={nodeCode}
                onChange={(e) => setNodeCode(e.target.value)}
                placeholder="master-node"
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
                Identifier broadcasted by the ESP32 (e.g., <code>master-node</code>).
              </span>
            </div>

            {/* Master Node WebSocket URL */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--ev-c-text-1)' }}>
                ESP32 WebSocket Address:
              </label>
              <input
                type="text"
                value={nodeWsUrl}
                onChange={(e) => setNodeWsUrl(e.target.value)}
                placeholder="ws://10.41.47.240:8081"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--ev-c-text-1)',
                  fontSize: '14px',
                  fontFamily: 'monospace'
                }}
              />
            </div>

            {/* Facility / Station Name */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--ev-c-text-1)' }}>
                Station / Facility Name:
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="AquaLoRa Master Node"
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
            </div>

            {/* Password */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--ev-c-text-1)' }}>
                Master Node Password:
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
                Default firmware password is <code>aqualora123</code>. Derives the AES-256-GCM encryption key.
              </span>
            </div>

            {/* Advanced Settings Toggle */}
            <div>
              <button
                type="button"
                className="apply-btn"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                {showAdvanced ? 'Hide Advanced Settings ▲' : 'Cloud Server Settings ▼'}
              </button>
            </div>

            {showAdvanced && (
              <div style={{ paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--ev-c-text-2)', marginBottom: '4px' }}>
                  Cloud Backend URL (Optional):
                </label>
                <input
                  type="text"
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                  placeholder="https://aqualora.up.railway.app"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--ev-c-text-1)',
                    fontSize: '13px'
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--ev-c-text-3)', display: 'block', marginTop: '4px' }}>
                  If unreachable, AquaLoRa automatically runs in offline mode without interruption.
                </span>
              </div>
            )}
          </div>

          {statusMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                color: '#4aa8ff',
                fontSize: '13px',
                marginBottom: '12px'
              }}
            >
              ℹ️ {statusMessage}
            </div>
          )}

          {connectError && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'rgba(208, 59, 59, 0.15)',
                color: 'var(--status-critical)',
                fontSize: '13px',
                marginBottom: '12px'
              }}
            >
              ⚠️ {connectError}
            </div>
          )}

          {connectSuccess && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: 'rgba(12, 163, 12, 0.15)',
                color: 'var(--status-good)',
                fontSize: '13px',
                marginBottom: '12px'
              }}
            >
              ✅ {isNewNodeWarning ? 'New node registered! Local database reset. Opening Dashboard…' : 'Master Node paired and registered! Opening Dashboard…'}
            </div>
          )}

          <div className="action-row" style={{ marginTop: '20px' }}>
            <button className="apply-btn" onClick={() => setStep('wifi')} disabled={isConnectingDevice}>
              ← Back to Wi-Fi
            </button>
            <button
              className="login-submit-btn"
              onClick={handleMasterNodeLogin}
              disabled={isConnectingDevice || connectSuccess}
              style={{ margin: 0 }}
            >
              {isConnectingDevice ? 'Signing In & Pairing…' : 'Sign In & Launch Dashboard →'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default ConnectDevicePage
