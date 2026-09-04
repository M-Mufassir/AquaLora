import { useState } from 'react'

interface LoginScreenProps {
  onLogin: (username: string, role: string) => void
}

function LoginScreen({ onLogin }: LoginScreenProps): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const user = await window.api.login(username, password)
    setSubmitting(false)
    if (!user) {
      setError('Invalid username or password.')
      return
    }
    onLogin(user.username, user.role)
  }

  return (
    <div className="login-screen">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>AquaLoRa Dashboard</h1>
        <p className="login-subtitle">Sign in to continue</p>

        <label htmlFor="login-username">Username</label>
        <input
          id="login-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="login-submit-btn" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>

        <div style={{ marginTop: 14, padding: '8px 10px', borderRadius: 6, backgroundColor: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.2)', fontSize: 11, color: 'var(--ev-c-text-2)', textAlign: 'center' }}>
          <span>Default Operator: <strong>Operator</strong> / <strong>Operator123</strong></span>
        </div>
      </form>
    </div>
  )
}

export default LoginScreen
