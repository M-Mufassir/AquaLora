// src/components/Gauge.tsx

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';

interface GaugeProps {
  title: string;
  value: number | null;
  unit: string;
  min: number;
  max: number;
  safeMin: number;
  safeMax: number;
  icon?: string;
  precision?: number;
}

export const Gauge: React.FC<GaugeProps> = ({
  title,
  value,
  unit,
  min,
  max,
  safeMin,
  safeMax,
  icon,
  precision = 1,
}) => {
  if (value == null) {
    return (
      <View style={[styles.card, shadows.medium, { borderLeftColor: colors.textMuted }]}>
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            {icon ? <Text style={styles.icon}>{icon}</Text> : null}
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={[styles.badgeText, { color: colors.textMuted }]}>Not reported</Text>
        </View>
      </View>
    );
  }

  // Determine status level
  const getStatus = (): 'safe' | 'warning' | 'critical' => {
    if (value < safeMin || value > safeMax) return 'critical';
    const warningMargin = (safeMax - safeMin) * 0.15;
    if (value < safeMin + warningMargin || value > safeMax - warningMargin) return 'warning';
    return 'safe';
  };

  const status = getStatus();

  const getStatusColor = () => {
    switch (status) {
      case 'safe':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'critical':
        return colors.error;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'safe':
        return 'Optimal';
      case 'warning':
        return 'Warning';
      case 'critical':
        return 'Critical';
    }
  };

  // Calculate percentage for progress fill (clamped 0-100%)
  const percentage = Math.min(
    Math.max(((value - min) / (max - min)) * 100, 0),
    100
  );

  return (
    <View style={[styles.card, shadows.medium, { borderLeftColor: getStatusColor() }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          {icon ? <Text style={styles.icon}>{icon}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: getStatusColor() + '20' }]}>
          <View style={[styles.dot, { backgroundColor: getStatusColor() }]} />
          <Text style={[styles.badgeText, { color: getStatusColor() }]}>
            {getStatusText()}
          </Text>
        </View>
      </View>

      {/* Main Value Display */}
      <View style={styles.valueContainer}>
        <Text style={styles.value}>
          {value.toFixed(precision)}
        </Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>

      {/* Gauge Bar Track */}
      <View style={styles.gaugeContainer}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${percentage}%`, backgroundColor: getStatusColor() },
            ]}
          />
        </View>
        {/* Min / Max Labels */}
        <View style={styles.rangeLabels}>
          <Text style={styles.rangeText}>{min} {unit}</Text>
          <Text style={styles.safeRangeText}>Safe: {safeMin}-{safeMax} {unit}</Text>
          <Text style={styles.rangeText}>{max} {unit}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    fontSize: 18,
  },
  title: {
    ...typography.h3,
    color: colors.textSecondary,
    fontSize: 15,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: spacing.xs,
  },
  value: {
    ...typography.h1,
    fontSize: 32,
    color: colors.text,
  },
  unit: {
    ...typography.body2,
    color: colors.textMuted,
    marginLeft: spacing.xs,
    fontWeight: '600',
  },
  gaugeContainer: {
    marginTop: spacing.xs,
  },
  track: {
    height: 8,
    backgroundColor: colors.gaugeTrack,
    borderRadius: borderRadius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: borderRadius.pill,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  rangeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  safeRangeText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
