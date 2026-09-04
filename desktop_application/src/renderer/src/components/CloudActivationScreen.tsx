import { useEffect, useState } from 'react'

interface CloudActivationScreenProps {
  onActivated: (session: {
    token: string
    masterNodeId: number
    nodeCode: string
    displayName: string
    role: string
  }) => void
}

interface DirectoryNode {
  node_code: string
  display_name: string
}

function CloudActivationScreen({ onActivated }: CloudActivationScreenProps): React.JSX.Element {
  const [nodes, setNodes] = useState<DirectoryNode[]>([])
  const [selectedNodeCode, setSelectedNodeCode] = useState('')
  const [customNodeCode, setCustomNodeCode] = useState('')
  const [password, setPassword] = useState('')
  const [loadingDirectory, setLoadingDirectory] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualEntry, setManualEntry] = useState(false)
  const [discoveredDevice, setDiscoveredDevice] = useState<{ id: string; ip: string; port: number } | null>(null)

  async function fetchDirectory(): Promise<void> {
    setLoadingDirectory(true)
    setError(null)
    try {
      const list = await window.api.getCloudDirectory()
      setNodes(list)
      if (list.length > 0 && !selectedNodeCode) {
        setSelectedNodeCode(list[0].node_code)
      }
    } catch (err: any) {
      console.warn('[CloudActivation] Directory fetch failed:', err)
      setManualEntry(true)
    } finally {
      setLoadingDirectory(false)
    }
  }

  useEffect(() => {
    void fetchDirectory()

    // Listen for local UDP discovered ESP32 devices to auto-derive node name
    window.api.startDiscovery().catch(() => {})
    const unsub = window.api.onDeviceDiscovered((dev) => {
      setDiscoveredDevice({ id: dev.id, ip: dev.ip, port: dev.port })
      setCustomNodeCode((prev) => (prev ? prev : dev.id))
    })

    return () => {
      unsub()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const targetCode = manualEntry ? customNodeCode.trim() : selectedNodeCode.trim()
    if (!targetCode) {
      setError('Please select or enter a Master Node code.')
      return
    }
    if (!password) {
      setError('Please enter the Master Node password.')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      const session = await window.api.cloudLogin(targetCode, password)
      onActivated(session)
    } catch (err: any) {
      setError(
        err?.message ||
          'Cloud activation failed. If your cloud backend is offline, you can click "Continue in Offline / Local Mode" below.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLocalOfflineMode(): Promise<void> {
    setError(null)
    setSubmitting(true)
    try {
      const nodeName = customNodeCode.trim() || discoveredDevice?.id || 'master-node'
      const session = await window.api.activateLocalSession(nodeName)
      if (discoveredDevice?.ip) {
        const wsUrl = `ws://${discoveredDevice.ip}:${discoveredDevice.port || 8081}`
        await window.api.connectMasterNode(wsUrl, password || 'aqualora123').catch(() => {})
      }
      onActivated(session)
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize local mode.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-form" onSubmit={handleSubmit} style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 32 }}>🌊</span>
        </div>
        <h1>Master Node Activation</h1>
        <p className="login-subtitle">
          Activate this workstation for your AquaLoRa facility (one-time setup)
        </p>

        {/* Auto-discovered node banner */}
        {discoveredDevice && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 6,
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary, #38bdf8)' }}>
                ⚡ Local Node Found: {discoveredDevice.id}
              </span>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ev-c-text-2)' }}>
                IP: {discoveredDevice.ip}:{discoveredDevice.port || 8081}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCustomNodeCode(discoveredDevice.id)
                setManualEntry(true)
              }}
              style={{
                background: 'var(--color-primary, #38bdf8)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Auto-fill
            </button>
          </div>
        )}

        {error && <p className="login-error" style={{ marginBottom: 10 }}>{error}</p>}

        {!manualEntry && nodes.length > 0 ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="select-master-node">Select Master Node</label>
              <button
                type="button"
                onClick={fetchDirectory}
                disabled={loadingDirectory}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ev-c-text-2)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                🔄 {loadingDirectory ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <select
              id="select-master-node"
              value={selectedNodeCode}
              onChange={(e) => setSelectedNodeCode(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14,
                marginBottom: 4
              }}
            >
              {nodes.map((n) => (
                <option key={n.node_code} value={n.node_code}>
                  {n.node_code} — {n.display_name}
                </option>
              ))}
            </select>
            <div style={{ textAlign: 'right', marginTop: -2, marginBottom: 4 }}>
              <button
                type="button"
                onClick={() => setManualEntry(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary, #38bdf8)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Type code manually
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="custom-node-code">Master Node Code / ID</label>
              {nodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManualEntry(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-primary, #38bdf8)',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Choose from list
                </button>
              )}
            </div>
            <input
              id="custom-node-code"
              type="text"
              placeholder="e.g. master-node or AQL-001"
              value={customNodeCode}
              onChange={(e) => setCustomNodeCode(e.target.value)}
              autoFocus
              required
            />
          </>
        )}

        <label htmlFor="activation-password">Node Password</label>
        <input
          id="activation-password"
          type="password"
          placeholder="Enter password (default: aqualora123)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          className="login-submit-btn"
          disabled={submitting}
          style={{ marginTop: 12 }}
        >
          {submitting ? 'Authenticating…' : 'Activate Workstation'}
        </button>

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            type="button"
            onClick={handleLocalOfflineMode}
            disabled={submitting}
            style={{
              background: 'none',
              border: '1px solid var(--color-border, #444)',
              borderRadius: 6,
              color: 'var(--ev-c-text-1)',
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
              width: '100%'
            }}
          >
            ⚡ Continue in Offline / Local Mode (Skip Cloud)
          </button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--ev-c-text-3, #888)', textAlign: 'center', margin: '8px 0 0' }}>
          This links telemetry and cloud sync securely to your facility.
        </p>
      </form>
    </div>
  )
}

export default CloudActivationScreen
