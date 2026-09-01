import { useEffect, useState } from 'react'
import { POND_LABELS, POND_TYPES } from '../../../shared/types'

interface MasterNodeProfile {
  id: number
  node_code: string
  display_name: string
  contact_name?: string | null
  contact_phone?: string | null
  site_location?: string | null
  pond_type?: string | null
  installed_at?: string | null
  role: string
  status: string
}

function MasterNodeProfilePage(): React.JSX.Element {
  const [profile, setProfile] = useState<MasterNodeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Profile fields
  const [displayName, setDisplayName] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [siteLocation, setSiteLocation] = useState('')
  const [pondType, setPondType] = useState('tilapia')

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  async function loadProfile(): Promise<void> {
    setLoading(true)
    try {
      const data = await window.api.getCloudProfile()
      setProfile(data)
      setDisplayName(data.display_name ?? '')
      setContactName(data.contact_name ?? '')
      setContactPhone(data.contact_phone ?? '')
      setSiteLocation(data.site_location ?? '')
      setPondType(data.pond_type ?? 'tilapia')
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to load profile from cloud' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfile()
  }, [])

  async function handleSaveProfile(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      const updated = await window.api.updateCloudProfile({
        display_name: displayName.trim(),
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        site_location: siteLocation.trim() || null,
        pond_type: pondType
      })
      setProfile(updated)
      setFeedback({ type: 'success', message: 'Master Node profile updated successfully.' })
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to update profile.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setPasswordFeedback(null)
    if (!currentPassword) {
      setPasswordFeedback({ type: 'error', message: 'Please enter your current password.' })
      return
    }
    if (newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', message: 'New password must be at least 6 characters.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', message: 'New passwords do not match.' })
      return
    }

    setChangingPassword(true)
    try {
      await window.api.changeCloudPassword(currentPassword, newPassword)
      setPasswordFeedback({ type: 'success', message: 'Master Node password changed successfully.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setPasswordFeedback({ type: 'error', message: err?.message || 'Failed to change password.' })
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="page-content" style={{ padding: '32px' }}>
        <p style={{ color: 'var(--ev-c-text-2)' }}>Loading Master Node profile…</p>
      </div>
    )
  }

  return (
    <div className="page-content" style={{ padding: '24px 32px', maxWidth: '860px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: 'var(--ev-c-text-1)' }}>Master Node Profile</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ev-c-text-2)' }}>
            Facility identity and settings for this physical installation
          </p>
        </div>
        {profile && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: profile.status === 'active' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: profile.status === 'active' ? '#22c55e' : '#ef4444'
              }}
            >
              ● {profile.status.toUpperCase()}
            </span>
            <span
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8'
              }}
            >
              {profile.role.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {feedback && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 20,
            fontSize: 13,
            backgroundColor: feedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: feedback.type === 'success' ? '#22c55e' : '#ef4444',
            border: `1px solid ${feedback.type === 'success' ? '#22c55e' : '#ef4444'}`
          }}
        >
          {feedback.message}
        </div>
      )}

      {/* Main Profile Form */}
      <div
        style={{
          backgroundColor: 'var(--color-background-mute)',
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
          border: '1px solid var(--ev-c-gray-3)'
        }}
      >
        <h2 style={{ fontSize: 16, margin: '0 0 16px', color: 'var(--ev-c-text-1)' }}>Facility Information</h2>
        <form onSubmit={handleSaveProfile} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Node Identifier (Fixed)
            </label>
            <input
              type="text"
              value={profile?.node_code ?? ''}
              disabled
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--ev-c-gray-3)',
                color: 'var(--ev-c-text-2)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Display / Facility Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Contact Person
            </label>
            <input
              type="text"
              placeholder="e.g. John Doe"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Contact Phone
            </label>
            <input
              type="text"
              placeholder="e.g. +94 77 123 4567"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Site Location
            </label>
            <input
              type="text"
              placeholder="e.g. Negombo Lagoon - Sector 3"
              value={siteLocation}
              onChange={(e) => setSiteLocation(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Primary Pond Species
            </label>
            <select
              value={pondType}
              onChange={(e) => setPondType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            >
              {POND_TYPES.map((type) => (
                <option key={type} value={type}>
                  {POND_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: 'var(--ev-c-gray-2)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14,
                fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              {saving ? 'Saving changes…' : 'Save Facility Profile'}
            </button>
          </div>
        </form>
      </div>

      {/* Security & Password Change */}
      <div
        style={{
          backgroundColor: 'var(--color-background-mute)',
          borderRadius: 12,
          padding: 24,
          border: '1px solid var(--ev-c-gray-3)'
        }}
      >
        <h2 style={{ fontSize: 16, margin: '0 0 16px', color: 'var(--ev-c-text-1)' }}>
          Change Master Node Password
        </h2>

        {passwordFeedback && (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              backgroundColor:
                passwordFeedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: passwordFeedback.type === 'success' ? '#22c55e' : '#ef4444'
            }}
          >
            {passwordFeedback.message}
          </div>
        )}

        <form onSubmit={handleChangePassword} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Current Password
            </label>
            <input
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              New Password
            </label>
            <input
              type="password"
              placeholder="Min 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--ev-c-text-2)', marginBottom: 4 }}>
              Confirm New Password
            </label>
            <input
              type="password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--ev-c-gray-2)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14
              }}
            />
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              type="submit"
              disabled={changingPassword}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: 'var(--ev-c-gray-2)',
                color: 'var(--ev-c-text-1)',
                fontSize: 14,
                fontWeight: 600,
                cursor: changingPassword ? 'not-allowed' : 'pointer'
              }}
            >
              {changingPassword ? 'Updating password…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default MasterNodeProfilePage
