import { useCallback, useRef } from 'react'

// Generates a short two-tone alarm beep via the Web Audio oscillator API —
// no bundled audio asset needed.
export function useAlertSound(): { playCritical: () => void } {
  const ctxRef = useRef<AudioContext | null>(null)

  const playCritical = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    const now = ctx.currentTime
    ;[0, 0.25].forEach((offset, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = i === 0 ? 880 : 660
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.22)
    })
  }, [])

  return { playCritical }
}
