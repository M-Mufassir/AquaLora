// src/theme/colors.ts

export const colors = {
  // Brand colors
  primary: '#1E90FF',       // Ocean Blue
  primaryDark: '#0066CC',   // Deep Blue
  primaryLight: '#E6F2FF',  // Soft Blue Tint
  accent: '#0EA5E9',        // Sky Blue Accent

  // Status colors
  success: '#10B981',       // Emerald Green (Safe / Optimal)
  successLight: '#D1FAE5',
  warning: '#F59E0B',       // Amber (Warning / Moderate)
  warningLight: '#FEF3C7',
  error: '#EF4444',         // Coral Red (Critical / Action required)
  errorLight: '#FEE2E2',
  info: '#3B82F6',          // Informational Blue
  infoLight: '#DBEAFE',

  // Surfaces & Backgrounds
  background: '#F9FAFB',    // Main App Background
  surface: '#FFFFFF',       // Card & Sheet Surface
  surfaceAlt: '#F3F4F6',    // Secondary Surface
  surfaceElevated: '#FFFFFF',

  // Typography / Text
  text: '#111827',          // Primary Headings & Body
  textSecondary: '#4B5563', // Subtitles & Labels
  textMuted: '#9CA3AF',     // Captions & Placeholders
  textInverse: '#FFFFFF',   // Light text on dark surfaces

  // Borders & Dividers
  border: '#E5E7EB',        // Light Border
  borderDark: '#D1D5DB',    // Darker Border
  divider: '#F3F4F6',       // Divider Lines

  // Gauges & Visuals
  gaugeTrack: '#E5E7EB',
  overlay: 'rgba(0, 0, 0, 0.4)',
};

export type Colors = typeof colors;
