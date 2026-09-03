// src/theme/colors.ts

export const colors = {
  // Brand colors
  primary: '#1769AA',       // Reliable ocean blue for controls and links
  primaryDark: '#0D477A',   // Deep blue for emphasis and contrast
  primaryLight: '#E6F4FF',  // Soft blue tint for selected surfaces
  accent: '#0E9FC2',        // Teal-blue visual accent

  // Status colors
  success: '#16804B',       // Dark emerald for readable status text
  successLight: '#D1FAE5',
  warning: '#A15C00',       // Dark amber for readable status text
  warningLight: '#FEF3C7',
  error: '#B42318',         // Dark red for readable status text
  errorLight: '#FEE2E2',
  info: '#2563B8',          // Informational blue
  infoLight: '#DBEAFE',

  // Surfaces & Backgrounds
  background: '#F5F9FD',    // Main App Background
  surface: '#FFFFFF',       // Card & Sheet Surface
  surfaceAlt: '#EAF4FC',    // Secondary Surface
  surfaceElevated: '#FFFFFF',

  // Typography / Text
  text: '#0F172A',          // Primary Headings & Body
  textPrimary: '#0F172A',   // Explicit primary text color
  textSecondary: '#334155', // Subtitles & Labels
  textMuted: '#64748B',     // Captions & Placeholders
  textInverse: '#FFFFFF',   // Light text on dark surfaces

  // Borders & Dividers
  border: '#CFE1F1',        // Light Border
  borderDark: '#A9C7E0',    // Darker Border
  divider: '#DCEBF7',       // Divider Lines

  // Gauges & Visuals
  gaugeTrack: '#E2ECF6',
  overlay: 'rgba(4, 18, 31, 0.52)',
};

export type Colors = typeof colors;
