import { useReadingsStore } from '../store/useReadingsStore'

function ThemeToggle(): React.JSX.Element {
  const theme = useReadingsStore((s) => s.settings.theme)
  const setTheme = useReadingsStore((s) => s.setTheme)

  async function toggle(): Promise<void> {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setTheme(next)
    await window.api.setSetting('theme', next)
  }

  return (
    <button
      className="theme-toggle-btn"
      onClick={toggle}
      aria-label="Toggle light/dark theme"
      title="Toggle light/dark theme"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

export default ThemeToggle
