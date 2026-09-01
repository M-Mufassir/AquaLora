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
      setError('Unable to load cloud Master Node directory. Check network or enter manually.')
      setManualEntry(true)
    } finally {
      setLoadingDirectory(false)
    }
  }

  useEffect(() => {
    void fetchDirectory()
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
      setError(err?.message || 'Activation failed. Please check credentials and backend connection.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-form" onSubmit={handleSubmit} style={{ width: 340 }}>
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 32 }}>🌊</span>
        </div>
        <h1>Master Node Activation</h1>
        <p className="login-subtitle">
          Activate this workstation for your AquaLoRa facility (one-time setup)
        </p>

        {error && <p className="login-error" style={{ marginBottom: 6 }}>{error}</p>}

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
              <label htmlFor="custom-node-code">Master Node Code</label>
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
              placeholder="e.g. AQL-0001"
              value={customNodeCode}
              onChange={(e) => setCustomNodeCode(e.target.value.toUpperCase())}
              autoFocus
              required
            />
          </>
        )}

        <label htmlFor="activation-password">Node Password</label>
        <input
          id="activation-password"
          type="password"
          placeholder="Enter password"
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

        <p style={{ fontSize: 11, color: 'var(--ev-c-text-3, #888)', textAlign: 'center', margin: '8px 0 0' }}>
          This links telemetry and cloud sync securely to your facility.
        </p>
      </form>
    </div>
  )
}

export default CloudActivationScreen
