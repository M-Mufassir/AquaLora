// src/theme/colors.ts

export const colors = {
  // Brand colors
  primary: '#49B5FF',       // Bright Aqua Blue
  primaryDark: '#0B6FCD',   // Deeper Ocean Blue
  primaryLight: '#DFF3FF',  // Soft Blue Tint
  accent: '#4CC9F0',        // Sky Blue Accent

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
  background: '#F3F9FF',    // Main App Background
  surface: '#FFFFFF',       // Card & Sheet Surface
  surfaceAlt: '#EDF6FF',    // Secondary Surface
  surfaceElevated: '#FFFFFF',

  // Typography / Text
  text: '#0F172A',          // Primary Headings & Body
  textPrimary: '#0F172A',   // Explicit primary text color
  textSecondary: '#334155', // Subtitles & Labels
  textMuted: '#64748B',     // Captions & Placeholders
  textInverse: '#FFFFFF',   // Light text on dark surfaces

  // Borders & Dividers
  border: '#D8E8F8',        // Light Border
  borderDark: '#B7CEE6',    // Darker Border
  divider: '#EAF3FF',       // Divider Lines

  // Gauges & Visuals
  gaugeTrack: '#E2ECF6',
  overlay: 'rgba(4, 18, 31, 0.52)',
};

export type Colors = typeof colors;
