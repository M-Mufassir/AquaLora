import { useNavigate } from 'react-router-dom'

function ConnectDevicePage(): React.JSX.Element {
  const navigate = useNavigate()

  return (
    <div className="page connect-page">
      <h1>Connection</h1>
      <p className="page-subtitle">
        Network and backend settings are managed in Settings → Connection so the setup stays simple
        for daily use.
      </p>

      <section className="settings-section">
        <h2>Use the settings panel</h2>
        <p className="status">
          Configure the WiFi SSID, WiFi password, Master Node WebSocket URL, and cloud backup URL in
          the Connection tab under Settings.
        </p>
        <button className="login-submit-btn" onClick={() => navigate('/')}>
          Back to Dashboard
        </button>
      </section>
    </div>
  )
}

export default ConnectDevicePage
