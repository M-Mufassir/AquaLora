// src/components/Gauge.tsx

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
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
  // Animation refs
  const animatedProgress = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Calculate percentage (0 - 100)
  const targetPercentage = value == null
    ? 0
    : Math.min(Math.max(((value - min) / ((max - min) || 1)) * 100, 0), 100);

  useEffect(() => {
    // Animate needle and progress bar smoothly to target value
    Animated.timing(animatedProgress, {
      toValue: targetPercentage,
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [targetPercentage]);

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

  // Subtle pulsing effect for warning or critical
  useEffect(() => {
    if (status !== 'safe') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status]);

  const currentColor = getStatusColor();

  // Interpolate rotation for the meter dial needle (-90deg to +90deg)
  const needleRotate = animatedProgress.interpolate({
    inputRange: [0, 100],
    outputRange: ['-90deg', '90deg'],
  });

  // Interpolate width for the linear gauge track fill
  const widthPercent = animatedProgress.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  // Calculate safe range positions for the linear track marker
  const safeMinPct = Math.max(0, Math.min(100, ((safeMin - min) / ((max - min) || 1)) * 100));
  const safeMaxPct = Math.max(0, Math.min(100, ((safeMax - min) / ((max - min) || 1)) * 100));
  const safeWidthPct = Math.max(0, safeMaxPct - safeMinPct);

  return (
    <View style={[styles.card, shadows.medium, { borderLeftColor: currentColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          {icon ? <Text style={styles.icon}>{icon}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </View>

        <View style={[styles.badge, { backgroundColor: currentColor + '20' }]}>
          <Animated.View
            style={[
              styles.dot,
              { backgroundColor: currentColor, transform: [{ scale: pulseAnim }] },
            ]}
          />
          <Text style={[styles.badgeText, { color: currentColor }]}>
            {getStatusText()}
          </Text>
        </View>
      </View>

      {/* Dial Meter + Value Showcase Row */}
      <View style={styles.meterShowcaseRow}>
        {/* Semi-Circular Meter Dial */}
        <View style={styles.dialContainer}>
          <View style={styles.dialArcOuter}>
            <View style={styles.dialArcInner} />
            {/* Safe zone highlight on arc */}
            <View
              style={[
                styles.safeArcZone,
                {
                  transform: [
                    { rotate: `${((safeMinPct / 100) * 180) - 90}deg` }
                  ],
                },
              ]}
            />
            {/* Needle Pivot & Arm */}
            <Animated.View
              style={[
                styles.needleContainer,
                { transform: [{ rotate: needleRotate }] },
              ]}
            >
              <View style={[styles.needleArm, { backgroundColor: currentColor }]} />
            </Animated.View>
            <View style={[styles.needleCenterPin, { borderColor: currentColor }]} />
          </View>
          <View style={styles.dialLabelsRow}>
            <Text style={styles.dialLabel}>{min}</Text>
            <Text style={styles.dialLabel}>{max}</Text>
          </View>
        </View>

        {/* Big Value Readout */}
        <View style={styles.valueContainer}>
          <View style={styles.valUnitRow}>
            <Text style={[styles.value, { color: currentColor }]}>
              {value.toFixed(precision)}
            </Text>
            <Text style={styles.unit}>{unit}</Text>
          </View>
          <View style={[styles.rangeBadge, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={styles.safeRangeText}>
              Target: {safeMin} – {safeMax} {unit}
            </Text>
          </View>
        </View>
      </View>

      {/* Smooth Linear Progress Gauge Track */}
      <View style={styles.gaugeContainer}>
        <View style={styles.track}>
          {/* Safe Range Zone Background Band */}
          <View
            style={[
              styles.safeBand,
              {
                left: `${safeMinPct}%`,
                width: `${safeWidthPct}%`,
              },
            ]}
          />
          {/* Animated Fill Bar */}
          <Animated.View
            style={[
              styles.fill,
              {
                width: widthPercent,
                backgroundColor: currentColor,
              },
            ]}
          />
        </View>

        {/* Min / Target / Max Labels */}
        <View style={styles.rangeLabels}>
          <Text style={styles.rangeText}>{min} {unit}</Text>
          <Text style={styles.trackSafeLabel}>Safe Band ({safeMin} - {safeMax})</Text>
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
    marginBottom: spacing.sm,
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
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  meterShowcaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dialContainer: {
    alignItems: 'center',
    width: 104,
    height: 64,
  },
  dialArcOuter: {
    width: 90,
    height: 45,
    borderTopLeftRadius: 45,
    borderTopRightRadius: 45,
    backgroundColor: colors.gaugeTrack,
    borderWidth: 3,
    borderColor: colors.border,
    borderBottomWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
    position: 'relative',
  },
  dialArcInner: {
    width: 62,
    height: 31,
    borderTopLeftRadius: 31,
    borderTopRightRadius: 31,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderBottomWidth: 0,
    position: 'absolute',
    bottom: 0,
  },
  safeArcZone: {
    position: 'absolute',
    bottom: 0,
    left: 45,
    width: 3,
    height: 45,
    backgroundColor: colors.success,
    opacity: 0.5,
  },
  needleContainer: {
    position: 'absolute',
    bottom: 0,
    left: 45,
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  needleArm: {
    position: 'absolute',
    bottom: 0,
    left: -1.5,
    width: 3,
    height: 38,
    borderRadius: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  needleCenterPin: {
    position: 'absolute',
    bottom: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    zIndex: 10,
  },
  dialLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 92,
    marginTop: 3,
  },
  dialLabel: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
  },
  valueContainer: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  valUnitRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    ...typography.h1,
    fontSize: 32,
    fontWeight: '800',
  },
  unit: {
    ...typography.body2,
    color: colors.textMuted,
    marginLeft: 4,
    fontWeight: '700',
  },
  rangeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    marginTop: 4,
  },
  safeRangeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  gaugeContainer: {
    marginTop: spacing.sm,
  },
  track: {
    height: 8,
    backgroundColor: colors.gaugeTrack,
    borderRadius: borderRadius.pill,
    overflow: 'hidden',
    position: 'relative',
  },
  safeBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: colors.successLight,
    opacity: 0.8,
  },
  fill: {
    height: '100%',
    borderRadius: borderRadius.pill,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  rangeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  trackSafeLabel: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
