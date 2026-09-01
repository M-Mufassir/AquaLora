import { useEffect, useState } from 'react'
import { useReadingsStore } from '../store/useReadingsStore'
import ThemeToggle from '../components/ThemeToggle'
import {
  DEFAULT_POND_PROFILES,
  POND_LABELS,
  POND_TYPES,
  getDefaultPondProfile,
  type NodeRow,
  type PondThresholdProfile
} from '../../../shared/types'

type SettingsTab = 'default' | 'connection' | 'ponds' | 'thresholds' | 'cloud'

type ThresholdTemplateDraft = {
  id?: number
  name: string
  profile: PondThresholdProfile
}

const EMPTY_PROFILE: PondThresholdProfile = {
  temperature: { min: 26, max: 30 },
  turbidity: { min: 0, max: 25 },
  tds: { min: 100, max: 300 },
  ph: { min: 6.5, max: 8.5 }
}

function SettingsPage(): React.JSX.Element {
  const settings = useReadingsStore((s) => s.settings)
  const knownNodes = useReadingsStore((s) => s.knownNodes)
  const removeNode = useReadingsStore((s) => s.removeNode)
  const clearNodeReadings = useReadingsStore((s) => s.clearNodeReadings)
  const setSoundEnabled = useReadingsStore((s) => s.setSoundEnabled)
  const syncStatus = useReadingsStore((s) => s.syncStatus)
  const [activeTab, setActiveTab] = useState<SettingsTab>('default')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [nodeForm, setNodeForm] = useState({
    id: '',
    name: '',
    location: '',
    pondType: 'tilapia' as keyof typeof POND_LABELS
  })
  const [savedWifiSsid, setSavedWifiSsid] = useState(settings.savedWifiSsid ?? '')
  const [savedWifiPassword, setSavedWifiPassword] = useState(settings.savedWifiPassword ?? '')
  const [cloudSyncUrl, setCloudSyncUrl] = useState(settings.cloudSyncUrl ?? '')
  const [masterNodeUrl, setMasterNodeUrl] = useState(settings.masterNodeUrl ?? 'ws://localhost:8081')
  const [currentWifiSsid, setCurrentWifiSsid] = useState<string | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminFeedback, setAdminFeedback] = useState<string | null>(null)
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null)
  const [pondFeedback, setPondFeedback] = useState<string | null>(null)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [locationDrafts, setLocationDrafts] = useState<Record<string, string>>({})
  const [customProfiles, setCustomProfiles] = useState<Record<string, PondThresholdProfile>>({})
  const [savedThresholds, setSavedThresholds] = useState<ThresholdTemplateDraft[]>([])
  const [thresholdSelections, setThresholdSelections] = useState<Record<string, string>>({})
  const [thresholdDraft, setThresholdDraft] = useState<ThresholdTemplateDraft>({
    name: 'Custom Farm',
    profile: { ...DEFAULT_POND_PROFILES.tilapia }
  })

  // ── Cloud Sync state ─────────────────────────────────────────────────────
  const [cloudProfile, setCloudProfile] = useState<any>(null)
  const [cloudProfileLoading, setCloudProfileLoading] = useState(false)
  const [cloudProfileFeedback, setCloudProfileFeedback] = useState<string | null>(null)
  const [cloudProfileDraft, setCloudProfileDraft] = useState({ display_name: '', contact_name: '', contact_phone: '', site_location: '' })
  const [readingsSyncLoading, setReadingsSyncLoading] = useState(false)
  const [readingsSyncFeedback, setReadingsSyncFeedback] = useState<string | null>(null)
  const [nodesSyncLoading, setNodesSyncLoading] = useState(false)
  const [nodesFetchLoading, setNodesFetchLoading] = useState(false)
  const [nodesSyncFeedback, setNodesSyncFeedback] = useState<string | null>(null)
  const [cloudPwdCurrent, setCloudPwdCurrent] = useState('')
  const [cloudPwdNew, setCloudPwdNew] = useState('')
  const [cloudPwdConfirm, setCloudPwdConfirm] = useState('')
  const [cloudPwdLoading, setCloudPwdLoading] = useState(false)
  const [cloudPwdFeedback, setCloudPwdFeedback] = useState<string | null>(null)

  const selectedNode = knownNodes.find((node) => node.id === selectedNodeId) ?? null

  const totalPonds = knownNodes.length
  const onlinePonds = knownNodes.filter((node) => node.status === 'online').length
  const customProfilePonds = knownNodes.filter((node) => node.pond_type === 'custom').length
  const farmOverviewStats = [
    { label: 'Total ponds', value: String(totalPonds) },
    { label: 'Online', value: String(onlinePonds) },
    { label: 'Custom profiles', value: String(customProfilePonds) },
    { label: 'Selected', value: selectedNode ? selectedNode.name || selectedNode.id : 'None' }
  ]

  useEffect(() => {
    if (!knownNodes.length) {
      setSelectedNodeId(null)
      setNodeForm({ id: '', name: '', location: '', pondType: 'tilapia' })
      return
    }

    if (!selectedNodeId || !knownNodes.some((node) => node.id === selectedNodeId)) {
      const firstNode = knownNodes[0]
      setSelectedNodeId(firstNode.id)
    }
  }, [knownNodes, selectedNodeId])

  useEffect(() => {
    if (selectedNode) {
      setNodeForm({
        id: selectedNode.id,
        name: selectedNode.name ?? '',
        location: selectedNode.location ?? '',
        pondType: (selectedNode.pond_type ?? 'tilapia') as keyof typeof POND_LABELS
      })
    } else if (!selectedNodeId) {
      setNodeForm({ id: '', name: '', location: '', pondType: 'tilapia' })
    }
  }, [selectedNode, selectedNodeId])

  useEffect(() => {
    const nextNameDrafts: Record<string, string> = {}
    const nextLocationDrafts: Record<string, string> = {}
    const nextProfiles: Record<string, PondThresholdProfile> = {}

    for (const node of knownNodes) {
      nextNameDrafts[node.id] = node.name ?? ''
      nextLocationDrafts[node.id] = node.location ?? ''
      nextProfiles[node.id] = node.custom_profile ?? getDefaultPondProfile(node.pond_type ?? 'tilapia')
    }

    setNameDrafts(nextNameDrafts)
    setLocationDrafts(nextLocationDrafts)
    setCustomProfiles(nextProfiles)
  }, [knownNodes])

  useEffect(() => {
    void window.api.getThresholdProfiles().then((items) => {
      setSavedThresholds(
        items.map((item) => ({
          id: item.id,
          name: item.name,
          profile: item.profile ?? { ...DEFAULT_POND_PROFILES.tilapia }
        }))
      )
    })
  }, [])

  useEffect(() => {
    window.api.getWifiStatus().then((state) => setCurrentWifiSsid(state.ssid))
  }, [])

  useEffect(() => {
    setSavedWifiSsid(settings.savedWifiSsid ?? '')
    setSavedWifiPassword(settings.savedWifiPassword ?? '')
    setCloudSyncUrl(settings.cloudSyncUrl ?? '')
  }, [settings.savedWifiSsid, settings.savedWifiPassword, settings.cloudSyncUrl])

  async function handleSoundToggle(): Promise<void> {
    const next = !settings.soundEnabled
    setSoundEnabled(next)
    await window.api.setSetting('soundEnabled', next)
  }

  async function handleSaveConnectionSettings(): Promise<void> {
    const trimmedSsid = savedWifiSsid.trim()
    const trimmedNodeUrl = masterNodeUrl.trim()
    const trimmedCloudUrl = cloudSyncUrl.trim()

    if (!trimmedSsid || !trimmedNodeUrl) {
      setConnectionFeedback('WiFi SSID and Master Node URL are required.')
      return
    }

    await window.api.setSetting('savedWifiSsid', trimmedSsid)
    await window.api.setSetting('savedWifiPassword', savedWifiPassword)
    await window.api.setSetting('masterNodeUrl', trimmedNodeUrl)
    if (trimmedCloudUrl) {
      await window.api.setSetting('cloudSyncUrl', trimmedCloudUrl)
    }

    try {
      await window.api.connectWifi(trimmedSsid, savedWifiPassword)
      const state = await window.api.getWifiStatus()
      setCurrentWifiSsid(state.ssid)
      await window.api.connectMasterNode(trimmedNodeUrl, savedWifiPassword || undefined)
      setConnectionFeedback('Connection settings saved and the app is trying to connect.')
      const nextStatus = await window.api.getSyncStatus()
      useReadingsStore.getState().setSyncStatus(nextStatus)
    } catch (error) {
      setConnectionFeedback('The connection could not be established. Check the WiFi SSID, password, and Master Node URL.')
      console.error(error)
    }
  }

  async function handleSyncNow(): Promise<void> {
    const nextStatus = await window.api.syncCloudReadings()
    useReadingsStore.getState().setSyncStatus(nextStatus)
  }

  // ── Cloud Sync handlers ──────────────────────────────────────────────────
  async function handleCloudReadingsSync(): Promise<void> {
    setReadingsSyncLoading(true)
    setReadingsSyncFeedback(null)
    try {
      const result = await window.api.syncCloudReadings()
      useReadingsStore.getState().setSyncStatus(result)
      setReadingsSyncFeedback(`✅ Synced ${result.synced ?? 0} reading(s) — ${result.pending ?? 0} pending.`)
    } catch (err: any) {
      setReadingsSyncFeedback(`❌ ${err.message ?? 'Sync failed'}`)
    } finally {
      setReadingsSyncLoading(false)
    }
  }

  async function handleNodesSyncToCloud(): Promise<void> {
    setNodesSyncLoading(true)
    setNodesSyncFeedback(null)
    try {
      const result = await window.api.syncNodesCloud()
      setNodesSyncFeedback(`✅ Uploaded ${result.received} node config(s) to cloud.`)
    } catch (err: any) {
      setNodesSyncFeedback(`❌ ${err.message ?? 'Upload failed'}`)
    } finally {
      setNodesSyncLoading(false)
    }
  }

  async function handleNodesFetchFromCloud(): Promise<void> {
    setNodesFetchLoading(true)
    setNodesSyncFeedback(null)
    try {
      const cloudNodes = await window.api.fetchNodesCloud()
      // Update local store with fetched configs
      for (const cn of cloudNodes) {
        useReadingsStore.getState().upsertKnownNode({
          id: cn.node_id,
          name: cn.name ?? null,
          location: cn.location ?? null,
          pond_type: (cn.pond_type as any) ?? 'tilapia',
          custom_profile: cn.custom_profile ?? null,
          status: 'offline',
          last_seen: null,
          battery_pct: null,
          lora_rssi: null
        })
      }
      setNodesSyncFeedback(`✅ Pulled ${cloudNodes.length} node config(s) from cloud into local DB.`)
    } catch (err: any) {
      setNodesSyncFeedback(`❌ ${err.message ?? 'Fetch failed'}`)
    } finally {
      setNodesFetchLoading(false)
    }
  }

  async function handleCloudProfileSync(): Promise<void> {
    setCloudProfileLoading(true)
    setCloudProfileFeedback(null)
    try {
      const profile = await window.api.getCloudProfile()
      setCloudProfile(profile)
      setCloudProfileDraft({
        display_name: profile.display_name ?? '',
        contact_name: profile.contact_name ?? '',
        contact_phone: profile.contact_phone ?? '',
        site_location: profile.site_location ?? ''
      })
      setCloudProfileFeedback('✅ Profile loaded from cloud.')
    } catch (err: any) {
      setCloudProfileFeedback(`❌ ${err.message ?? 'Could not load profile'}`)
    } finally {
      setCloudProfileLoading(false)
    }
  }

  async function handleCloudProfileUpload(): Promise<void> {
    setCloudProfileLoading(true)
    setCloudProfileFeedback(null)
    try {
      await window.api.updateCloudProfile({
        display_name: cloudProfileDraft.display_name.trim() || undefined,
        contact_name: cloudProfileDraft.contact_name.trim() || null,
        contact_phone: cloudProfileDraft.contact_phone.trim() || null,
        site_location: cloudProfileDraft.site_location.trim() || null
      })
      setCloudProfileFeedback('✅ Profile uploaded to cloud successfully.')
    } catch (err: any) {
      setCloudProfileFeedback(`❌ ${err.message ?? 'Upload failed'}`)
    } finally {
      setCloudProfileLoading(false)
    }
  }

  async function handleCloudPasswordUpload(): Promise<void> {
    if (!cloudPwdCurrent || !cloudPwdNew) {
      setCloudPwdFeedback('❌ Please fill in both current and new password.')
      return
    }
    if (cloudPwdNew !== cloudPwdConfirm) {
      setCloudPwdFeedback('❌ New password and confirmation do not match.')
      return
    }
    setCloudPwdLoading(true)
    setCloudPwdFeedback(null)
    try {
      await window.api.changeCloudPassword(cloudPwdCurrent, cloudPwdNew)
      setCloudPwdCurrent('')
      setCloudPwdNew('')
      setCloudPwdConfirm('')
      setCloudPwdFeedback('✅ Cloud password changed successfully.')
    } catch (err: any) {
      setCloudPwdFeedback(`❌ ${err.message ?? 'Password change failed'}`)
    } finally {
      setCloudPwdLoading(false)
    }
  }

  async function handleAdminPasswordChange(): Promise<void> {
    if (!adminPassword.trim()) {
      setAdminFeedback('Password cannot be empty.')
      return
    }
    await window.api.changeUserPassword('Admin', adminPassword)
    setAdminPassword('')
    setAdminFeedback('Admin password updated successfully.')
  }

  function resetNodeForm(): void {
    setNodeForm({ id: '', name: '', location: '', pondType: 'tilapia' })
    setSelectedNodeId(knownNodes[0]?.id ?? null)
  }

  async function handleSaveNodeForm(): Promise<void> {
    const trimmedId = nodeForm.id.trim()
    if (!trimmedId) {
      setPondFeedback('Node ID is required.')
      return
    }

    const updated = await window.api.upsertNode(
      trimmedId,
      nodeForm.name.trim(),
      nodeForm.location.trim()
    )
    await window.api.setNodePondType(trimmedId, nodeForm.pondType)
    useReadingsStore.getState().upsertKnownNode(updated)
    useReadingsStore.getState().upsertKnownNode({
      ...updated,
      pond_type: nodeForm.pondType,
      custom_profile: null
    })
    setSelectedNodeId(trimmedId)
    setPondFeedback(`Saved node ${trimmedId}.`)
  }

  async function handleDeleteReadings(nodeId: string): Promise<void> {
    const deleted = await window.api.deleteNodeReadings(nodeId)
    clearNodeReadings(nodeId)
    setPondFeedback(`Deleted ${deleted} reading(s) for ${nodeId}.`)
  }

  async function handleDeletePond(nodeId: string): Promise<void> {
    const deleted = await window.api.deleteNode(nodeId)
    if (deleted > 0) {
      removeNode(nodeId)
      setPondFeedback(`Deleted pond ${nodeId}.`)
      if (selectedNodeId === nodeId) {
        const next = knownNodes.find((node) => node.id !== nodeId)
        setSelectedNodeId(next?.id ?? null)
      }
    }
  }

  function updateNodeName(nodeId: string, value: string): void {
    setNameDrafts((current) => ({ ...current, [nodeId]: value }))
  }

  function updateNodeLocation(nodeId: string, value: string): void {
    setLocationDrafts((current) => ({ ...current, [nodeId]: value }))
  }

  function updateCustomProfile(nodeId: string, key: keyof PondThresholdProfile, field: 'min' | 'max', value: string): void {
    const nextValue = Number(value)
    setCustomProfiles((current) => {
      const base = current[nodeId] ?? getDefaultPondProfile(knownNodes.find((node) => node.id === nodeId)?.pond_type ?? 'tilapia')
      return {
        ...current,
        [nodeId]: {
          ...base,
          [key]: {
            ...base[key],
            [field]: Number.isFinite(nextValue) ? nextValue : 0
          }
        }
      }
    })
  }

  async function saveNodeMeta(node: NodeRow): Promise<void> {
    const nextName = nameDrafts[node.id] ?? node.name ?? ''
    const nextLocation = locationDrafts[node.id] ?? node.location ?? ''
    const updated = await window.api.upsertNode(node.id, nextName, nextLocation)
    useReadingsStore.getState().upsertKnownNode(updated)
    setPondFeedback(`Saved configuration for ${node.id}.`)
  }

  async function saveNodeProfile(node: NodeRow): Promise<void> {
    const selectedType = node.pond_type ?? 'tilapia'
    const profile = customProfiles[node.id] ?? EMPTY_PROFILE
    const pondType = selectedType === 'custom' ? 'custom' : selectedType
    await window.api.setNodePondType(node.id, pondType)
    if (pondType === 'custom') {
      const updated = await window.api.setNodeCustomProfile(node.id, profile)
      useReadingsStore.getState().upsertKnownNode(updated)
    } else {
      const updated = await window.api.setNodeCustomProfile(node.id, null)
      useReadingsStore.getState().upsertKnownNode(updated)
    }
    useReadingsStore.getState().upsertKnownNode({ ...node, pond_type: pondType as any, custom_profile: pondType === 'custom' ? profile : null })
    setPondFeedback(`Saved threshold profile for ${node.id}.`)
  }

  function updateThresholdField(key: keyof PondThresholdProfile, field: 'min' | 'max', value: string): void {
    const numeric = Number(value)
    setThresholdDraft((current) => ({
      ...current,
      profile: {
        ...current.profile,
        [key]: {
          ...current.profile[key],
          [field]: Number.isFinite(numeric) ? numeric : 0
        }
      }
    }))
  }

  async function saveThresholdTemplate(): Promise<void> {
    const trimmedName = thresholdDraft.name.trim()
    if (!trimmedName) {
      setPondFeedback('Threshold profile must have a name.')
      return
    }

    const saved = await window.api.saveThresholdProfile(trimmedName, thresholdDraft.profile)
    setSavedThresholds((current) => {
      const next = current.filter((item) => item.id !== saved.id)
      return [...next, { id: saved.id, name: saved.name, profile: saved.profile }].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    })
    setThresholdDraft({ name: trimmedName, profile: { ...saved.profile } })
    setPondFeedback(`Saved threshold profile: ${saved.name}`)
  }

  async function deleteThresholdTemplate(id?: number): Promise<void> {
    if (!id) return
    await window.api.deleteThresholdProfile(id)
    setSavedThresholds((current) => current.filter((item) => item.id !== id))
    setPondFeedback('Threshold profile deleted.')
  }

  function loadThresholdTemplate(item: ThresholdTemplateDraft): void {
    setThresholdDraft({
      id: item.id,
      name: item.name,
      profile: { ...item.profile }
    })
  }

  function applySavedThreshold(nodeId: string, templateName: string): void {
    if (!templateName || templateName === 'manual') {
      setThresholdSelections((current) => ({ ...current, [nodeId]: 'manual' }))
      return
    }

    const match = savedThresholds.find((item) => item.name === templateName)
    if (!match) return

    setThresholdSelections((current) => ({ ...current, [nodeId]: templateName }))
    setCustomProfiles((current) => ({
      ...current,
      [nodeId]: { ...match.profile }
    }))
  }

  return (
    <div className="page settings-page">
      <h1>Settings</h1>

      <div className="settings-tabs">
        <button
          className={`tab-btn${activeTab === 'default' ? ' active' : ''}`}
          onClick={() => setActiveTab('default')}
        >
          Default
        </button>
        <button
          className={`tab-btn${activeTab === 'connection' ? ' active' : ''}`}
          onClick={() => setActiveTab('connection')}
        >
          Connection
        </button>
        <button
          className={`tab-btn${activeTab === 'ponds' ? ' active' : ''}`}
          onClick={() => setActiveTab('ponds')}
        >
          Ponds
        </button>
        <button
          className={`tab-btn${activeTab === 'thresholds' ? ' active' : ''}`}
          onClick={() => setActiveTab('thresholds')}
        >
          Thresholds
        </button>
        <button
          className={`tab-btn${activeTab === 'cloud' ? ' active' : ''}`}
          onClick={() => setActiveTab('cloud')}
          style={{ position: 'relative' }}
        >
          ☁️ Cloud Sync
          {syncStatus.pendingCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#f59e0b',
                display: 'inline-block'
              }}
            />
          )}
        </button>
      </div>

      {activeTab === 'default' && (
        <>
          <section className="settings-section">
            <h2>Admin access</h2>
            <div className="settings-row stacked">
              <span>Default admin account</span>
              <strong>Admin / Admin123</strong>
            </div>
            <div className="settings-row stacked">
              <label htmlFor="admin-password">Change admin password</label>
              <input
                id="admin-password"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="New admin password"
              />
              <button className="apply-btn" onClick={handleAdminPasswordChange}>Update password</button>
              {adminFeedback && <p className="status success-text">{adminFeedback}</p>}
            </div>
          </section>

          <section className="settings-section">
            <h2>Basic settings</h2>
            <div className="settings-row">
              <span>Theme</span>
              <ThemeToggle />
            </div>
            <div className="settings-row">
              <span>Sound on Critical alerts</span>
              <button
                className={`toggle-switch${settings.soundEnabled ? ' on' : ''}`}
                onClick={handleSoundToggle}
                aria-label="Toggle Critical alert sound"
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </section>

        </>
      )}

      {activeTab === 'connection' && (
        <section className="settings-section connection-panel">
          <div className="connection-header">
            <div>
              <h2>Connection settings</h2>
              <p className="connection-subtitle">
                External WiFi-first deployment for the Master Node, desktop dashboard, and cloud backup.
              </p>
            </div>
            <span className={`status-pill ${currentWifiSsid ? 'online' : 'offline'}`}>
              {currentWifiSsid ? 'Connected' : 'Not connected'}
            </span>
          </div>

          <div className="connection-summary-grid">
            <div className="summary-card">
              <span>WiFi</span>
              <strong>{currentWifiSsid ?? 'Not configured'}</strong>
            </div>
            <div className="summary-card">
              <span>Master node</span>
              <strong>{masterNodeUrl || 'Not set'}</strong>
            </div>
            <div className="summary-card">
              <span>Cloud backup</span>
              <strong>{cloudSyncUrl || 'Not configured'}</strong>
            </div>
          </div>

          <div className="connection-grid">
            <div className="connection-field">
              <label htmlFor="saved-wifi-ssid">WiFi SSID</label>
              <input
                id="saved-wifi-ssid"
                value={savedWifiSsid}
                onChange={(e) => setSavedWifiSsid(e.target.value)}
                placeholder="AquaLoRa-Farm"
              />
            </div>

            <div className="connection-field">
              <label htmlFor="saved-wifi-password">WiFi Password</label>
              <input
                id="saved-wifi-password"
                type="password"
                value={savedWifiPassword}
                onChange={(e) => setSavedWifiPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="connection-field">
              <label htmlFor="master-node-url">Master Node WebSocket URL</label>
              <input
                id="master-node-url"
                value={masterNodeUrl}
                onChange={(e) => setMasterNodeUrl(e.target.value)}
                placeholder="ws://192.168.1.50:8081"
              />
            </div>

            <div className="connection-field">
              <label htmlFor="cloud-sync-url">Cloud backup URL</label>
              <input
                id="cloud-sync-url"
                value={cloudSyncUrl}
                onChange={(e) => setCloudSyncUrl(e.target.value)}
                placeholder="https://aqualora.up.railway.app"
              />
            </div>
          </div>

          <div className="pond-actions" style={{ marginTop: 16 }}>
            <button className="apply-btn" onClick={handleSaveConnectionSettings}>Save & Connect</button>
            <button className="apply-btn" onClick={handleSyncNow} disabled={!syncStatus.enabled}>Sync now</button>
            <button
              className="apply-btn"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                borderColor: '#ef4444',
                color: '#ef4444'
              }}
              onClick={async () => {
                if (confirm('Are you sure you want to deactivate and sign this workstation out of its Master Node?')) {
                  await window.api.cloudLogout()
                  window.location.reload()
                }
              }}
              title="Deactivate workstation and clear stored Master Node cloud credentials"
            >
              Sign out of this PC
            </button>
          </div>

          {connectionFeedback && <p className="status success-text">{connectionFeedback}</p>}
          {syncStatus.lastError && <p className="status error-text">Last error: {syncStatus.lastError}</p>}
        </section>
      )}

      {activeTab === 'ponds' && (
        <section className="settings-section">
          <h2>Pond management</h2>

          <div className="farm-overview">
            {farmOverviewStats.map((stat) => (
              <div className="farm-stat" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>

          <div className="pond-card premium-editor-card">
            <div className="pond-card-header">
              <div>
                <strong>{selectedNode ? 'Edit selected slave node' : 'Add new slave node'}</strong>
                <div className="pond-meta">{selectedNode ? `Currently editing: ${selectedNode.id}` : 'Create a device record manually'}</div>
              </div>
              <div className="status-pills">
                <span className={`status-pill ${selectedNode?.status === 'online' ? 'online' : 'offline'}`}>
                  {selectedNode?.status === 'online' ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>

            <div className="pond-card-grid">
              <div>
                <label>Node ID</label>
                <input
                  value={nodeForm.id}
                  onChange={(e) => setNodeForm((current) => ({ ...current, id: e.target.value }))}
                  placeholder="slave-04"
                />
              </div>
              <div>
                <label>Friendly name</label>
                <input
                  value={nodeForm.name}
                  onChange={(e) => setNodeForm((current) => ({ ...current, name: e.target.value }))}
                  placeholder="Prawn Pond East"
                />
              </div>
              <div>
                <label>Location</label>
                <input
                  value={nodeForm.location}
                  onChange={(e) => setNodeForm((current) => ({ ...current, location: e.target.value }))}
                  placeholder="Farm Block A"
                />
              </div>
              <div>
                <label>Pond type</label>
                <select
                  value={nodeForm.pondType}
                  onChange={(e) =>
                    setNodeForm((current) => ({
                      ...current,
                      pondType: e.target.value as keyof typeof POND_LABELS
                    }))
                  }
                >
                  {POND_TYPES.map((type) => (
                    <option key={type} value={type}>{POND_LABELS[type]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pond-actions">
              <button className="apply-btn" onClick={handleSaveNodeForm}>
                {selectedNode ? 'Update node' : 'Add node'}
              </button>
              <button className="apply-btn" onClick={resetNodeForm}>Reset form</button>
            </div>
          </div>

          <div className="pond-manage-list">
            {knownNodes.length === 0 ? (
              <p className="status">No ponds available yet.</p>
            ) : (
              knownNodes.map((node) => (
                <div
                  key={node.id}
                  className={`pond-card${selectedNodeId === node.id ? ' selected' : ''}`}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <div className="pond-card-header">
                    <div>
                      <strong>{node.name || node.id}</strong>
                      <div className="pond-meta">ID: {node.id}</div>
                    </div>
                    <div className="status-pills">
                      <span className={`status-pill ${node.status === 'online' ? 'online' : 'offline'}`}>
                        {node.status === 'online' ? 'Online' : 'Offline'}
                      </span>
                      <span className="pond-type-badge">{POND_LABELS[node.pond_type ?? 'tilapia']}</span>
                    </div>
                  </div>

                  <div className="node-health-strip">
                    <div className="mini-metric">
                      <span>Battery</span>
                      <strong>{node.battery_pct ?? '--'}%</strong>
                    </div>
                    <div className="mini-metric">
                      <span>Signal</span>
                      <strong>{node.lora_rssi ?? '--'} dBm</strong>
                    </div>
                    <div className="mini-metric">
                      <span>Profile</span>
                      <strong>{node.pond_type === 'custom' ? 'Custom' : POND_LABELS[node.pond_type ?? 'tilapia']}</strong>
                    </div>
                  </div>

                  <div className="pond-card-grid">
                    <div>
                      <label>Slave name</label>
                      <input
                        value={nameDrafts[node.id] ?? ''}
                        onChange={(e) => updateNodeName(node.id, e.target.value)}
                        placeholder="Slave 01"
                      />
                    </div>
                    <div>
                      <label>Location</label>
                      <input
                        value={locationDrafts[node.id] ?? ''}
                        onChange={(e) => updateNodeLocation(node.id, e.target.value)}
                        placeholder="Pond A"
                      />
                    </div>
                    <div>
                      <label>Last seen</label>
                      <div>{node.last_seen || 'Never'}</div>
                    </div>
                    <div>
                      <label>Pond type</label>
                      <select
                        value={node.pond_type ?? 'tilapia'}
                        onChange={async (e) => {
                          const updatedType = e.target.value
                          await window.api.setNodePondType(node.id, updatedType)
                          useReadingsStore.getState().upsertKnownNode({
                            ...node,
                            pond_type: updatedType as any,
                            custom_profile:
                              updatedType === 'custom' ? customProfiles[node.id] ?? EMPTY_PROFILE : null
                          })
                          setPondFeedback(`Updated ${node.id} to ${POND_LABELS[updatedType as keyof typeof POND_LABELS]}.`)
                        }}
                      >
                        {POND_TYPES.map((type) => (
                          <option key={type} value={type}>{POND_LABELS[type]}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="pond-profile-editor">
                    <div className="profile-summary">
                      {node.pond_type === 'custom'
                        ? 'Custom range is active for this pond.'
                        : `${POND_LABELS[node.pond_type ?? 'tilapia']} default range is active.`}
                    </div>
                    {(node.pond_type ?? 'tilapia') === 'custom' && (
                      <>
                        <div className="saved-template-select-wrap">
                          <label>Saved threshold profile</label>
                          <select
                            value={thresholdSelections[node.id] ?? 'manual'}
                            onChange={(e) => applySavedThreshold(node.id, e.target.value)}
                          >
                            <option value="manual">Manual edit</option>
                            {savedThresholds.map((item) => (
                              <option key={item.id ?? item.name} value={item.name}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="profile-grid compact-grid">
                          {Object.entries((customProfiles[node.id] ?? DEFAULT_POND_PROFILES.tilapia) as PondThresholdProfile).map(([key, range]) => (
                            <div key={key} className="profile-field">
                              <label>{key.toUpperCase()}</label>
                              <div className="range-inputs">
                                <input
                                  type="number"
                                  value={range.min}
                                  onChange={(e) => updateCustomProfile(node.id, key as keyof PondThresholdProfile, 'min', e.target.value)}
                                />
                                <span>to</span>
                                <input
                                  type="number"
                                  value={range.max}
                                  onChange={(e) => updateCustomProfile(node.id, key as keyof PondThresholdProfile, 'max', e.target.value)}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="pond-actions">
                    <button className="apply-btn" onClick={() => saveNodeMeta(node)}>
                      Save info
                    </button>
                    <button className="apply-btn" onClick={() => saveNodeProfile(node)}>
                      Save profile
                    </button>
                    <button className="apply-btn danger" onClick={() => handleDeleteReadings(node.id)}>
                      Delete readings
                    </button>
                    <button className="apply-btn danger" onClick={() => handleDeletePond(node.id)}>
                      Delete pond
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {pondFeedback && <p className="status success-text">{pondFeedback}</p>}
        </section>
      )}

      {activeTab === 'thresholds' && (
        <section className="settings-section">
          <h2>Threshold library</h2>
          <div className="threshold-layout">
            <div className="threshold-editor">
              <label htmlFor="threshold-name">Profile name</label>
              <input
                id="threshold-name"
                value={thresholdDraft.name}
                onChange={(e) => setThresholdDraft((current) => ({ ...current, name: e.target.value }))}
                placeholder="Sri Lankan Prawn Farm"
              />

              <div className="profile-grid">
                {Object.entries(thresholdDraft.profile).map(([key, range]) => (
                  <div key={key} className="profile-field">
                    <label>{key.toUpperCase()}</label>
                    <div className="range-inputs">
                      <input
                        type="number"
                        value={range.min}
                        onChange={(e) => updateThresholdField(key as keyof PondThresholdProfile, 'min', e.target.value)}
                      />
                      <span>to</span>
                      <input
                        type="number"
                        value={range.max}
                        onChange={(e) => updateThresholdField(key as keyof PondThresholdProfile, 'max', e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pond-actions">
                <button className="apply-btn" onClick={saveThresholdTemplate}>Save profile</button>
              </div>
            </div>

            <div className="threshold-list">
              {savedThresholds.length === 0 ? (
                <p className="status">No saved threshold profiles yet.</p>
              ) : (
                savedThresholds.map((item) => (
                  <div key={item.id ?? item.name} className="threshold-item">
                    <div>
                      <strong>{item.name}</strong>
                    </div>
                    <div className="threshold-item-actions">
                      <button className="apply-btn" onClick={() => loadThresholdTemplate(item)}>Load</button>
                      <button className="apply-btn danger" onClick={() => deleteThresholdTemplate(item.id)}>Delete</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'cloud' && (
        <section className="settings-section">
          <h2>Cloud sync and master node</h2>

          <div className="settings-row stacked">
            <label htmlFor="cloud-url-input">Cloud API URL</label>
            <input
              id="cloud-url-input"
              value={cloudSyncUrl}
              onChange={(e) => setCloudSyncUrl(e.target.value)}
              placeholder="https://aqualora.up.railway.app"
            />
            <button
              className="apply-btn"
              onClick={async () => {
                const trimmed = cloudSyncUrl.trim()
                await window.api.setSetting('cloudSyncUrl', trimmed)
                setCloudProfileFeedback(trimmed ? '✅ Cloud URL saved.' : '✅ Cloud URL cleared.')
              }}
            >
              Save URL
            </button>
          </div>

          <div className="connection-grid" style={{ marginTop: 12 }}>
            <div className="connection-field">
              <label htmlFor="cloud-display-name">Display name</label>
              <input
                id="cloud-display-name"
                value={cloudProfileDraft.display_name}
                onChange={(e) => setCloudProfileDraft((current) => ({ ...current, display_name: e.target.value }))}
              />
            </div>
            <div className="connection-field">
              <label htmlFor="cloud-contact-name">Contact name</label>
              <input
                id="cloud-contact-name"
                value={cloudProfileDraft.contact_name}
                onChange={(e) => setCloudProfileDraft((current) => ({ ...current, contact_name: e.target.value }))}
              />
            </div>
            <div className="connection-field">
              <label htmlFor="cloud-contact-phone">Contact phone</label>
              <input
                id="cloud-contact-phone"
                value={cloudProfileDraft.contact_phone}
                onChange={(e) => setCloudProfileDraft((current) => ({ ...current, contact_phone: e.target.value }))}
              />
            </div>
            <div className="connection-field">
              <label htmlFor="cloud-site-location">Site location</label>
              <input
                id="cloud-site-location"
                value={cloudProfileDraft.site_location}
                onChange={(e) => setCloudProfileDraft((current) => ({ ...current, site_location: e.target.value }))}
              />
            </div>
          </div>

          <div className="pond-actions" style={{ marginTop: 16 }}>
            <button className="apply-btn" onClick={handleCloudProfileSync} disabled={cloudProfileLoading}>
              {cloudProfileLoading ? 'Loading…' : 'Load cloud profile'}
            </button>
            <button className="apply-btn" onClick={handleCloudProfileUpload} disabled={cloudProfileLoading}>
              Upload profile
            </button>
          </div>

          {cloudProfile && (
            <div className="settings-row stacked" style={{ marginTop: 16 }}>
              <span>Cloud identity</span>
              <strong>{cloudProfile.node_code} / {cloudProfile.display_name}</strong>
              <small>{cloudProfile.role} • {cloudProfile.status}</small>
            </div>
          )}

          <div className="settings-row stacked" style={{ marginTop: 18 }}>
            <h3>Change cloud password</h3>
            <input
              type="password"
              value={cloudPwdCurrent}
              onChange={(e) => setCloudPwdCurrent(e.target.value)}
              placeholder="Current password"
            />
            <input
              type="password"
              value={cloudPwdNew}
              onChange={(e) => setCloudPwdNew(e.target.value)}
              placeholder="New password"
            />
            <input
              type="password"
              value={cloudPwdConfirm}
              onChange={(e) => setCloudPwdConfirm(e.target.value)}
              placeholder="Confirm new password"
            />
            <button className="apply-btn" onClick={handleCloudPasswordUpload} disabled={cloudPwdLoading}>
              {cloudPwdLoading ? 'Updating…' : 'Update password'}
            </button>
            {cloudPwdFeedback && <p className="status success-text">{cloudPwdFeedback}</p>}
          </div>

          <div className="settings-row stacked" style={{ marginTop: 18 }}>
            <h3>Sync data to cloud</h3>
            <div className="pond-actions">
              <button className="apply-btn" onClick={handleCloudReadingsSync} disabled={readingsSyncLoading}>
                {readingsSyncLoading ? 'Syncing…' : 'Sync readings'}
              </button>
              <button className="apply-btn" onClick={handleNodesSyncToCloud} disabled={nodesSyncLoading}>
                {nodesSyncLoading ? 'Uploading…' : 'Upload node configs'}
              </button>
              <button className="apply-btn" onClick={handleNodesFetchFromCloud} disabled={nodesFetchLoading}>
                {nodesFetchLoading ? 'Fetching…' : 'Fetch node configs'}
              </button>
            </div>
            {readingsSyncFeedback && <p className="status success-text">{readingsSyncFeedback}</p>}
            {nodesSyncFeedback && <p className="status success-text">{nodesSyncFeedback}</p>}
            {cloudProfileFeedback && <p className="status success-text">{cloudProfileFeedback}</p>}
          </div>
        </section>
      )}
    </div>
  )
}

export default SettingsPage
