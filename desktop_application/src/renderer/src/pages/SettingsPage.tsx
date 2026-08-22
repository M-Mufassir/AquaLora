import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReadingsStore } from '../store/useReadingsStore'
import ThemeToggle from '../components/ThemeToggle'
import type { UserRow } from '../../../shared/types'

function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const settings = useReadingsStore((s) => s.settings)
  const setSoundEnabled = useReadingsStore((s) => s.setSoundEnabled)
  const currentUser = useReadingsStore((s) => s.currentUser)
  const [users, setUsers] = useState<UserRow[]>([])
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('operator')
  const [error, setError] = useState<string | null>(null)
  const [changePasswordFor, setChangePasswordFor] = useState<string | null>(null)
  const [changePasswordValue, setChangePasswordValue] = useState('')

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    if (isAdmin) window.api.listUsers().then(setUsers)
  }, [isAdmin])

  async function handleSoundToggle(): Promise<void> {
    const next = !settings.soundEnabled
    setSoundEnabled(next)
    await window.api.setSetting('soundEnabled', next)
  }

  async function handleAddUser(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    if (!newUsername.trim() || !newPassword) {
      setError('Username and password are required.')
      return
    }
    try {
      await window.api.createUserAccount(newUsername.trim(), newPassword, newRole)
      setNewUsername('')
      setNewPassword('')
      setUsers(await window.api.listUsers())
    } catch (err) {
      setError('Failed to create user (username may already exist).')
      console.error(err)
    }
  }

  async function handleDeleteUser(id: number): Promise<void> {
    await window.api.deleteUserAccount(id)
    setUsers(await window.api.listUsers())
  }

  async function handleChangePassword(username: string): Promise<void> {
    if (!changePasswordValue) return
    await window.api.changeUserPassword(username, changePasswordValue)
    setChangePasswordFor(null)
    setChangePasswordValue('')
  }

  return (
    <div className="page settings-page">
      <h1>Settings</h1>

      <section className="settings-section">
        <h2>Device Connection</h2>
        <div className="settings-row">
          <span>Pair with a different Master Node, or re-run the setup wizard</span>
          <button className="apply-btn" onClick={() => navigate('/connect')}>
            Connect Device
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Appearance</h2>
        <div className="settings-row">
          <span>Theme</span>
          <ThemeToggle />
        </div>
      </section>

      <section className="settings-section">
        <h2>Alerts</h2>
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

      {isAdmin && (
        <section className="settings-section">
          <h2>Users</h2>
          <table className="users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.role}</td>
                  <td className="users-actions">
                    {changePasswordFor === u.username ? (
                      <>
                        <input
                          type="password"
                          value={changePasswordValue}
                          onChange={(e) => setChangePasswordValue(e.target.value)}
                          placeholder="New password"
                        />
                        <button
                          className="apply-btn"
                          onClick={() => handleChangePassword(u.username)}
                        >
                          Save
                        </button>
                        <button className="apply-btn" onClick={() => setChangePasswordFor(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="apply-btn"
                          onClick={() => setChangePasswordFor(u.username)}
                        >
                          Change password
                        </button>
                        <button
                          className="apply-btn danger"
                          onClick={() => handleDeleteUser(u.id)}
                          disabled={u.username === currentUser?.username}
                          title={
                            u.username === currentUser?.username
                              ? "You can't delete the account you're signed in as"
                              : undefined
                          }
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form className="add-user-form" onSubmit={handleAddUser}>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Username"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password"
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="login-submit-btn">
              Add User
            </button>
          </form>
          {error && <p className="login-error">{error}</p>}
        </section>
      )}
    </div>
  )
}

export default SettingsPage
