// src/theme/typography.ts

import { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography = {
  h1: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    color: colors.text,
  } as TextStyle,
  h2: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    color: colors.text,
  } as TextStyle,
  h3: {
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    color: colors.text,
  } as TextStyle,
  body1: {
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 22,
    color: colors.text,
  } as TextStyle,
  body2: {
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    color: colors.textSecondary,
  } as TextStyle,
  caption: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    color: colors.textMuted,
  } as TextStyle,
  label: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    color: colors.textSecondary,
  } as TextStyle,
};
