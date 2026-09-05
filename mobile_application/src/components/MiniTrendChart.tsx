// src/components/MiniTrendChart.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Reading } from '../shared/types';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';

type MetricType = 'temperature' | 'turbidity' | 'tds' | 'ph';

interface MetricMeta {
  key: MetricType;
  label: string;
  unit: string;
  color: string;
  icon: string;
  safeMin: number;
  safeMax: number;
  precision: number;
}

const METRICS: MetricMeta[] = [
  { key: 'temperature', label: 'Temp', unit: '°C', color: '#0284C7', icon: '🌡️', safeMin: 22, safeMax: 30, precision: 1 },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', color: '#0EA5E9', icon: '💧', safeMin: 0, safeMax: 5, precision: 2 },
  { key: 'tds', label: 'TDS', unit: 'ppm', color: '#8B5CF6', icon: '🧪', safeMin: 300, safeMax: 600, precision: 0 },
  { key: 'ph', label: 'pH', unit: 'pH', color: '#10B981', icon: '⚖️', safeMin: 6.5, safeMax: 8.5, precision: 1 },
];

interface MiniTrendChartProps {
  readings: Reading[];
  loading?: boolean;
}

export const MiniTrendChart: React.FC<MiniTrendChartProps> = ({ readings, loading }) => {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('temperature');
  const activeMeta = METRICS.find(m => m.key === selectedMetric) || METRICS[0];

  // Pick up to 8 recent points for clear readable mobile layout
  const recentReadings = readings.slice(-8);

  const points = recentReadings.map(r => {
    const rawVal = r[selectedMetric];
    const val = typeof rawVal === 'number' ? rawVal : 0;
    const date = new Date(r.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return {
      value: val,
      timeStr,
      isSafe: val >= activeMeta.safeMin && val <= activeMeta.safeMax,
    };
  });

  const values = points.map(p => p.value);
  const minVal = values.length > 0 ? Math.min(...values, activeMeta.safeMin * 0.9) : activeMeta.safeMin;
  const maxVal = values.length > 0 ? Math.max(...values, activeMeta.safeMax * 1.1) : activeMeta.safeMax;
  const range = (maxVal - minVal) || 1;
  const avgVal = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  return (
    <View style={[styles.card, shadows.medium]}>
      {/* Chart Title & Quick Metric Selector Tabs */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>24h Telemetry Trend</Text>
          <Text style={styles.subtitle}>
            Safe Target: {activeMeta.safeMin} – {activeMeta.safeMax} {activeMeta.unit}
          </Text>
        </View>
        <View style={styles.avgBadge}>
          <Text style={styles.avgLabel}>Avg: </Text>
          <Text style={[styles.avgValue, { color: activeMeta.color }]}>
            {avgVal.toFixed(activeMeta.precision)} {activeMeta.unit}
          </Text>
        </View>
      </View>

      {/* Metric Selector Buttons */}
      <View style={styles.tabsRow}>
        {METRICS.map(m => {
          const isActive = m.key === selectedMetric;
          return (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.tabBtn,
                isActive && { backgroundColor: m.color, borderColor: m.color },
              ]}
              onPress={() => setSelectedMetric(m.key)}
            >
              <Text style={styles.tabIcon}>{m.icon}</Text>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Chart Canvas / Bar Area */}
      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Fetching past telemetry...</Text>
        </View>
      ) : points.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No historical data logged yet for this node.</Text>
        </View>
      ) : (
        <View style={styles.chartContainer}>
          {/* Upper / Lower threshold reference line indicators */}
          <View style={styles.barsContainer}>
            {points.map((pt, idx) => {
              const heightPct = Math.min(100, Math.max(14, ((pt.value - minVal) / range) * 100));
              return (
                <View key={idx} style={styles.barCol}>
                  <Text style={styles.barValueText}>
                    {pt.value.toFixed(activeMeta.precision)}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: `${heightPct}%`,
                          backgroundColor: pt.isSafe ? activeMeta.color : colors.warning,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.barTimeText}>{pt.timeStr}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h3,
    fontSize: 16,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  avgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
  },
  avgLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  avgValue: {
    ...typography.caption,
    fontWeight: '700',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 3,
  },
  tabIcon: {
    fontSize: 12,
  },
  tabText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  chartContainer: {
    marginTop: spacing.xs,
    height: 140,
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 135,
    paddingTop: 8,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  barValueText: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  barTrack: {
    width: 14,
    height: 90,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.xs,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: borderRadius.xs,
  },
  barTimeText: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 4,
  },
  emptyContainer: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
