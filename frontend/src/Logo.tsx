import React from 'react'

interface LogoProps {
  size?: number
  showText?: boolean
  subtitle?: string
  className?: string
  inverted?: boolean
}

export const AquaLoraLogo: React.FC<LogoProps> = ({
  size = 36,
  showText = true,
  subtitle = 'CLOUD CONSOLE',
  className = '',
  inverted = false
}) => {
  return (
    <div
      className={`inline-flex items-center gap-2.5 no-underline select-none ${className}`}
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
        {/* Subtle light sheen */}
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

        {/* Vector Mark: Ocean Wave + LoRa RF Arc */}
        <svg
          width={size * 0.72}
          height={size * 0.72}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4.5 10.5C6.5 8 9.5 6.5 13 6.5C16.5 6.5 19.5 8 21.5 10.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.75"
          />
          <path
            d="M7.5 13.5C8.8 12 10.8 11 13 11C15.2 11 17.2 12 18.5 13.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.9"
          />
          <path
            d="M3 18.5C5.5 16 8 16 10.5 18C13 20 16 20 18.5 17.5C19.8 16.2 20.8 15.5 22 15.5"
            stroke="white"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="13" cy="15" r="2.2" fill="#ffffff" />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-black tracking-tight ${
                inverted ? 'text-white' : 'text-slate-900 dark:text-white'
              }`}
              style={{ fontSize: size * 0.52 }}
            >
              Aqua<span className="text-cyan-500 font-black">LoRa</span>
            </span>
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 uppercase tracking-wider"
            >
              Enterprise
            </span>
          </div>
          {subtitle && (
            <span
              className={`text-[9px] font-semibold tracking-widest uppercase ${
                inverted ? 'text-cyan-200/70' : 'text-slate-500 dark:text-slate-400'
              }`}
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
