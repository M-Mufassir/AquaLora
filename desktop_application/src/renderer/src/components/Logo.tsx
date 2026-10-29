import React from 'react'

interface LogoProps {
  size?: number
  showText?: boolean
  subtitle?: string
  className?: string
}

export const AquaLoraLogo: React.FC<LogoProps> = ({
  size = 36,
  showText = true,
  subtitle = 'MARINE TELEMETRY',
  className = ''
}) => {
  return (
    <div
      className={`aqualora-brand-logo ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size > 32 ? '10px' : '8px',
        textDecoration: 'none',
        userSelect: 'none'
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius: size * 0.28,
          background: 'linear-gradient(135deg, #0284c7 0%, #06b6d4 50%, #10b981 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px -2px rgba(6, 182, 212, 0.45), 0 2px 6px -1px rgba(2, 132, 199, 0.3)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Ambient subtle light sheen */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '45%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 100%)',
            pointerEvents: 'none'
          }}
        />

        {/* Vector Mark: Ocean Wave + LoRa RF Radiation Arc */}
        <svg
          width={size * 0.72}
          height={size * 0.72}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Outer LoRa RF broadcast wave */}
          <path
            d="M4.5 10.5C6.5 8 9.5 6.5 13 6.5C16.5 6.5 19.5 8 21.5 10.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.75"
          />
          {/* Mid RF wave */}
          <path
            d="M7.5 13.5C8.8 12 10.8 11 13 11C15.2 11 17.2 12 18.5 13.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.9"
          />
          {/* Stylized Ocean Crest Wave */}
          <path
            d="M3 18.5C5.5 16 8 16 10.5 18C13 20 16 20 18.5 17.5C19.8 16.2 20.8 15.5 22 15.5"
            stroke="white"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Central Telemetry Core Node */}
          <circle cx="13" cy="15" r="2.2" fill="#ffffff" />
        </svg>
      </div>

      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                fontFamily: '"DM Sans", "Outfit", "Segoe UI", sans-serif',
                fontWeight: 800,
                fontSize: size * 0.52,
                letterSpacing: '-0.025em',
                color: 'var(--ev-c-text-1)',
                display: 'inline-block'
              }}
            >
              Aqua<span style={{ color: '#0ea5e9', fontWeight: 900 }}>LoRa</span>
            </span>
            <span
              style={{
                fontSize: size * 0.24,
                fontWeight: 700,
                padding: '2px 5px',
                borderRadius: '4px',
                background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(16, 185, 129, 0.15))',
                color: '#0ea5e9',
                border: '1px solid rgba(14, 165, 233, 0.3)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}
            >
              PRO
            </span>
          </div>
          {subtitle && (
            <span
              style={{
                fontSize: Math.max(9, size * 0.24),
                fontWeight: 600,
                letterSpacing: '0.12em',
                color: 'var(--ev-c-text-3)',
                textTransform: 'uppercase'
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default AquaLoraLogo
