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
  const [showSwitchWifi, setShowSwitchWifi] = useState(false)

  // Step 2: Auto-derived Node & Sign-In state
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredMasterNode[]>([])
  const [selectedDeviceKey, setSelectedDeviceKey] = useState<string>('')
  const [nodeCode, setNodeCode] = useState('master-node')
  const [displayName, setDisplayName] = useState('AquaLoRa Master Node')
  const [nodeWsUrl, setNodeWsUrl] = useState('ws://10.41.47.240:8081')
  const [pairingPassword, setPairingPassword] = useState('aqualora123')
  const [showPassword, setShowPassword] = useState(false)
  const [cloudUrl, setCloudUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isManualMode, setIsManualMode] = useState(false)

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

      // Auto-select first discovered device if none explicitly picked
      setSelectedDeviceKey((prevKey) => {
        if (!prevKey || prevKey === '__manual__') {
          const code = device.code || device.id
          setNodeCode(code)
          setNodeWsUrl(`ws://${device.ip}:${device.port || 8081}`)
          if (device.code === 'AQL-TEST' || device.id === 'test-master-node') {
            setPairingPassword('testmaster123')
          } else if (device.code === 'AQL-0001' || device.id === 'master-node') {
            setPairingPassword('aqualora123')
          }
          setIsManualMode(false)
          setPreviousNodeCode((prevCode) => {
            if (prevCode && prevCode !== code) {
              setIsNewNodeWarning(true)
            }
            return prevCode
          })
          return device.ip
        }
        return prevKey
      })
    })
  }

  function handleDeviceSelectChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const key = e.target.value
    setSelectedDeviceKey(key)

    if (key === '__manual__') {
      setIsManualMode(true)
      return
    }

    setIsManualMode(false)
    const dev = discoveredDevices.find((d) => d.ip === key)
    if (dev) {
      const code = dev.code || dev.id
      setNodeCode(code)
      setNodeWsUrl(`ws://${dev.ip}:${dev.port || 8081}`)
      if (dev.code === 'AQL-TEST' || dev.id === 'test-master-node') {
        setPairingPassword('testmaster123')
      } else if (dev.code === 'AQL-0001' || dev.id === 'master-node') {
        setPairingPassword('aqualora123')
      }
      if (previousNodeCode && previousNodeCode !== code) {
        setIsNewNodeWarning(true)
      } else {
        setIsNewNodeWarning(false)
      }
    }
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
    setSelectedDeviceKey(device.ip)
    const code = device.code || device.id
    setNodeCode(code)
    setNodeWsUrl(`ws://${device.ip}:${device.port || 8081}`)
    if (device.code === 'AQL-TEST' || device.id === 'test-master-node') {
      setPairingPassword('testmaster123')
    } else if (device.code === 'AQL-0001' || device.id === 'master-node') {
      setPairingPassword('aqualora123')
    }
    setIsManualMode(false)
    setStep('login')
  }

  function handleProceedToLogin(): void {
    if (!selectedDeviceKey && discoveredDevices.length > 0) {
      const dev = discoveredDevices[0]
      setSelectedDeviceKey(dev.ip)
      const code = dev.code || dev.id
      setNodeCode(code)
      setNodeWsUrl(`ws://${dev.ip}:${dev.port || 8081}`)
      if (dev.code === 'AQL-TEST' || dev.id === 'test-master-node') {
        setPairingPassword('testmaster123')
      } else if (dev.code === 'AQL-0001' || dev.id === 'master-node') {
        setPairingPassword('aqualora123')
      }
      setIsManualMode(false)
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

  const activeDiscoveredNode = discoveredDevices.find((d) => d.ip === selectedDeviceKey)

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
          : 'Step 2: Select your Master Node and enter its password to connect.'}
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
          <span className="wizard-step-label">2. Master Node Pairing</span>
        </button>
      </div>

      {/* STEP 1: WI-FI NETWORK */}
      {step === 'wifi' && (
        <section className="settings-section">
          <h2>Step 1: Wi-Fi / Hotspot Connection</h2>
          <p className="status">
            Ensure this computer and the ESP32 Master Node are on the same Wi-Fi router or mobile hotspot.
          </p>

          {/* Current Connection Status Card */}
          {currentSsid ? (
            <div
              style={{
                padding: '18px 20px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 78, 59, 0.25))',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                margin: '16px 0 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>📶</span>
                    <span style={{ color: 'var(--status-good)', fontWeight: 700, fontSize: '16px' }}>
                      Connected to: {currentSsid}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        backgroundColor: 'rgba(16, 185, 129, 0.2)',
                        color: 'var(--status-good)',
                        fontWeight: 600
                      }}
                    >
                      Active System Wi-Fi
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)', lineHeight: 1.4 }}>
                    Derived automatically from your Windows connection. Your ESP32 Master Node and laptop communicate across this network.
                  </p>
                </div>
                <button
                  type="button"
                  className="apply-btn"
                  onClick={() => checkWifiStatus()}
                  style={{ fontSize: '12px', padding: '6px 12px' }}
                >
                  🔄 Refresh Status
                </button>
              </div>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="login-submit-btn"
                  onClick={handleProceedToLogin}
                  style={{ margin: 0, padding: '10px 22px', fontSize: '13px', flex: 1, minWidth: '220px' }}
                >
                  Proceed with Current Network →
                </button>
                <button
                  type="button"
                  className="apply-btn"
                  onClick={() => setShowSwitchWifi(!showSwitchWifi)}
                  style={{ fontSize: '13px', padding: '10px 16px' }}
                >
                  {showSwitchWifi ? '▲ Hide Wi-Fi Switcher' : '⚙️ Switch Wi-Fi Network'}
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '16px 20px',
                borderRadius: '10px',
                backgroundColor: 'rgba(250, 178, 25, 0.12)',
                border: '1px solid rgba(250, 178, 25, 0.35)',
                margin: '16px 0 20px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>🟡</span>
                <span style={{ color: 'var(--status-warning)', fontWeight: 600, fontSize: '15px' }}>
                  Not Connected to Wi-Fi
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                Please join your mobile phone hotspot or Wi-Fi router below so this app can discover the Master Node.
              </p>
            </div>
          )}

          {/* Live UDP Discovery Card in Step 1 */}
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
                  ⚡ {discoveredDevices.length} Master Node{discoveredDevices.length > 1 ? 's' : ''} Detected
                </strong>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--ev-c-text-2)' }}>
                  Found <strong>{discoveredDevices[0].id}</strong> at <code>{discoveredDevices[0].ip}:{discoveredDevices[0].port || 8081}</code>.
                </p>
              </div>
              <button
                className="login-submit-btn"
                onClick={() => handleSelectDiscoveredDevice(discoveredDevices[0])}
                style={{ margin: 0, padding: '8px 16px', fontSize: '13px' }}
              >
                Proceed to Pair →
              </button>
            </div>
          )}

          {/* Switch Wi-Fi Network / System Settings Section */}
          {(!currentSsid || showSwitchWifi) && (
            <div
              style={{
                marginTop: '16px',
                padding: '18px',
                borderRadius: '8px',
                backgroundColor: 'var(--color-background-soft)',
                border: '1px solid var(--color-border)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <strong style={{ fontSize: '13px', color: 'var(--ev-c-text-1)' }}>
                  ⚙️ Wi-Fi Network Settings (Switch Connection)
                </strong>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="apply-btn"
                    onClick={scanWifiNetworks}
                    disabled={isScanningWifi}
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                  >
                    {isScanningWifi ? 'Scanning…' : '🔄 Scan Networks'}
                  </button>
                  <button
                    className="apply-btn"
                    onClick={() => window.api.openWifiSettings()}
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                  >
                    Windows Wi-Fi Settings
                  </button>
                </div>
              </div>

              {wifiError && <p style={{ color: 'var(--status-critical)', fontSize: '13px', marginBottom: '10px' }}>{wifiError}</p>}

              {/* Wi-Fi Networks List */}
              {wifiNetworks.length > 0 && (
                <div style={{ marginTop: '8px' }}>
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
                            📶 <strong>{net.ssid}</strong> {net.ssid === currentSsid && '(Current Active)'}
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
              Continue to Master Node Selection →
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: MASTER NODE DROPDOWN & PASSWORD PAIRING */}
      {step === 'login' && (
        <section className="settings-section">
          <h2>Step 2: Master Node Selection &amp; Sign-In</h2>
          <p className="status">
            Choose the detected ESP32 Master Node from the list and enter its pairing password.
          </p>

          {/* New-node database reset warning */}
          {isNewNodeWarning && previousNodeCode && previousNodeCode !== nodeCode && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                margin: '14px 0',
                fontSize: '13px'
              }}
            >
              <strong style={{ color: '#f59e0b', display: 'block', marginBottom: '4px' }}>
                ⚠️ Switching Master Node Target
              </strong>
              <p style={{ margin: '0 0 6px', color: 'var(--ev-c-text-1)', lineHeight: 1.5 }}>
                Previously paired with <code>{previousNodeCode}</code>. Connecting to{' '}
                <code>{nodeCode}</code> will reset local telemetry so this workstation starts clean with the new gateway.
              </p>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              padding: '20px',
              borderRadius: '8px',
              backgroundColor: 'var(--color-background-soft)',
              border: '1px solid var(--color-border)',
              margin: '16px 0'
            }}
          >
            {/* 1. MASTER NODE DROPDOWN SELECTOR */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ev-c-text-1)' }}>
                  Select Master Node:
                </label>
                <button
                  type="button"
                  className="apply-btn"
                  onClick={() => {
                    window.api.startDiscovery().catch(() => {})
                  }}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                >
                  🔄 Scan Again
                </button>
              </div>

              <select
                value={isManualMode ? '__manual__' : selectedDeviceKey}
                onChange={handleDeviceSelectChange}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--ev-c-text-1)',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                {discoveredDevices.length === 0 ? (
                  <option value="" disabled>
                    🔍 Scanning network for Master Nodes...
                  </option>
                ) : (
                  discoveredDevices.map((dev) => (
                    <option key={dev.ip} value={dev.ip}>
                      ⚡ {dev.name ? `${dev.name} (${dev.code || dev.id})` : dev.id} — {dev.ip}:{dev.port || 8081} ({dev.mode || 'STA'})
                    </option>
                  ))
                )}
                <option value="__manual__">⚙️ Enter Custom / Manual IP Address...</option>
              </select>

              {activeDiscoveredNode && !isManualMode && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(56, 211, 159, 0.12)',
                    border: '1px solid rgba(56, 211, 159, 0.3)',
                    fontSize: '12px',
                    color: 'var(--status-good)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🟢</span>
                  <span>
                    Detected <strong>{activeDiscoveredNode.name || activeDiscoveredNode.id}</strong> ({activeDiscoveredNode.code || activeDiscoveredNode.id}) on <code>{activeDiscoveredNode.ip}</code> (WebSocket Port {activeDiscoveredNode.port || 8081})
                  </span>
                </div>
              )}

              {discoveredDevices.length === 0 && !isManualMode && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(59, 130, 246, 0.08)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    fontSize: '12px',
                    color: 'var(--ev-c-text-2)',
                    lineHeight: 1.5
                  }}
                >
                  <span style={{ color: '#4aa8ff', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                    🔍 Listening for Master Node presence beacons...
                  </span>
                  <span>
                    When your Master Node joins Wi-Fi, it will automatically appear in this dropdown. You can also select <strong>"Enter Custom / Manual IP Address..."</strong> above.
                  </span>
                </div>
              )}
            </div>

            {/* If Manual Mode is picked, show direct IP input */}
            {isManualMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--ev-c-text-2)' }}>
                    Manual WebSocket Address:
                  </label>
                  <input
                    type="text"
                    value={nodeWsUrl}
                    onChange={(e) => setNodeWsUrl(e.target.value)}
                    placeholder="ws://10.41.47.240:8081 or ws://aqualora.local:8081"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-background)',
                      color: 'var(--ev-c-text-1)',
                      fontSize: '13px',
                      fontFamily: 'monospace'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: 'var(--ev-c-text-2)' }}>
                    Master Node Code:
                  </label>
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
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>
            )}

            {/* 2. PASSWORD INPUT */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--ev-c-text-1)' }}>
                Master Node Password:
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={pairingPassword}
                  onChange={(e) => setPairingPassword(e.target.value)}
                  placeholder="aqualora123"
                  style={{
                    width: '100%',
                    padding: '10px 40px 10px 14px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--ev-c-text-1)',
                    fontSize: '14px'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '15px',
                    padding: 0,
                    opacity: 0.7
                  }}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--ev-c-text-3)', display: 'block', marginTop: '4px' }}>
                Default password is <code>aqualora123</code>. Derives the AES-256-GCM telemetry encryption key.
              </span>
            </div>

            {/* 3. ADVANCED SETTINGS COLLAPSIBLE */}
            <div style={{ marginTop: '4px' }}>
              <button
                type="button"
                className="apply-btn"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                {showAdvanced ? 'Hide Advanced Options ▲' : '⚙️ Advanced Options ▼'}
              </button>
            </div>

            {showAdvanced && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--ev-c-text-2)', marginBottom: '4px' }}>
                    Facility / Station Name:
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="AquaLoRa Master Node"
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
                </div>

                {!isManualMode && (
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: 'var(--ev-c-text-2)', marginBottom: '4px' }}>
                      Resolved WebSocket URI:
                    </label>
                    <input
                      type="text"
                      value={nodeWsUrl}
                      readOnly
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-background-mute)',
                        color: 'var(--ev-c-text-2)',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                    />
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: 'var(--ev-c-text-2)', marginBottom: '4px' }}>
                    Cloud Sync API URL (Optional):
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
                    If unreachable, AquaLoRa automatically operates in local offline mode without interruption.
                  </span>
                </div>
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
              ✅ {isNewNodeWarning ? 'Master Node paired & registered! Resetting local telemetry…' : 'Master Node paired & registered! Launching Dashboard…'}
            </div>
          )}

          <div className="action-row" style={{ marginTop: '20px' }}>
            <button className="apply-btn" onClick={() => setStep('wifi')} disabled={isConnectingDevice}>
              ← Back to Wi-Fi
            </button>
            <button
              className="login-submit-btn"
              onClick={handleMasterNodeLogin}
              disabled={isConnectingDevice || connectSuccess || (!nodeWsUrl.trim() && !activeDiscoveredNode)}
              style={{ margin: 0 }}
            >
              {isConnectingDevice ? 'Connecting & Pairing…' : '🚀 Connect & Launch Dashboard →'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default ConnectDevicePage
