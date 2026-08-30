// src/components/AlertBadge.tsx

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius, typography } from '../theme';

export type AlertSeverity = 'normal' | 'warning' | 'critical';

interface AlertBadgeProps {
  severity: AlertSeverity;
  count?: number;
}

export const AlertBadge: React.FC<AlertBadgeProps> = ({ severity, count }) => {
  const getBadgeConfig = () => {
    switch (severity) {
      case 'critical':
        return {
          bg: colors.errorLight,
          color: colors.error,
          text: 'Critical',
          icon: '🔴',
        };
      case 'warning':
        return {
          bg: colors.warningLight,
          color: colors.warning,
          text: 'Warning',
          icon: '🟡',
        };
      case 'normal':
      default:
        return {
          bg: colors.infoLight,
          color: colors.info,
          text: 'Normal',
          icon: '🔵',
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={[styles.label, { color: config.color }]}>
        {config.text}
        {count !== undefined ? ` (${count})` : ''}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  icon: {
    fontSize: 10,
  },
  label: {
    ...typography.caption,
    fontWeight: '700',
  },
});
