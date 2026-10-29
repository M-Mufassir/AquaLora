// src/components/MiniTrendChart.tsx
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { LineChart, lineDataItem } from 'react-native-gifted-charts';
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
  const [chartWidth, setChartWidth] = useState<number>(320);
  const activeMeta = METRICS.find(m => m.key === selectedMetric) || METRICS[0];

  // Pick up to 10 recent readings for a clear, readable trend curve
  const recentReadings = readings.slice(-10);

  const rawValues = recentReadings.map(r => {
    const rawVal = r[selectedMetric];
    return typeof rawVal === 'number' ? rawVal : 0;
  });

  const minVal = rawValues.length > 0 ? Math.min(...rawValues) : activeMeta.safeMin;
  const maxVal = rawValues.length > 0 ? Math.max(...rawValues) : activeMeta.safeMax;
  const avgVal = rawValues.length > 0 ? rawValues.reduce((a, b) => a + b, 0) / rawValues.length : 0;

  // Format data items for gifted-charts LineChart
  const chartData: lineDataItem[] = recentReadings.map((r, idx) => {
    const rawVal = r[selectedMetric];
    const val = typeof rawVal === 'number' ? rawVal : 0;
    const date = new Date(r.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Show labels sparsely so x-axis is clean and legible
    const showLabel = idx === 0 || idx === Math.floor(recentReadings.length / 2) || idx === recentReadings.length - 1;

    return {
      value: val,
      label: showLabel ? timeStr : '',
      labelTextStyle: {
        color: colors.textMuted,
        fontSize: 10,
        fontWeight: '500',
      },
      dataPointText: '',
      dataPointColor: activeMeta.color,
      dataPointRadius: 4,
    };
  });

  const handleLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0) {
      setChartWidth(width);
    }
  };

  const calculatedSpacing = chartData.length > 1
    ? Math.max(28, (chartWidth - 75) / (chartData.length - 1))
    : 40;

  return (
    <View style={[styles.card, shadows.medium]} onLayout={handleLayout}>
      {/* Header with Title and Current Safe Range */}
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

      {/* Metric Selector Pills */}
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
              activeOpacity={0.7}
            >
              <Text style={styles.tabIcon}>{m.icon}</Text>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Chart Canvas */}
      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Fetching past telemetry...</Text>
        </View>
      ) : chartData.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No historical data logged yet for this node.</Text>
        </View>
      ) : (
        <View style={styles.chartWrapper}>
          <LineChart
            data={chartData}
            height={140}
            spacing={calculatedSpacing}
            initialSpacing={12}
            endSpacing={12}
            color={activeMeta.color}
            thickness={2.8}
            curved
            areaChart
            startFillColor={activeMeta.color}
            endFillColor={`${activeMeta.color}08`}
            startOpacity={0.35}
            endOpacity={0.03}
            dataPointsColor={activeMeta.color}
            dataPointsRadius={4}
            hideDataPoints={chartData.length > 12}
            noOfSections={3}
            rulesType="solid"
            rulesColor={colors.border}
            yAxisColor="transparent"
            xAxisColor={colors.border}
            yAxisTextStyle={styles.axisText}
            xAxisLabelTextStyle={styles.axisText}
            yAxisLabelWidth={38}
            isAnimated
            animationDuration={500}
            pointerConfig={{
              pointerStripHeight: 125,
              pointerStripColor: activeMeta.color,
              pointerStripWidth: 1.5,
              pointerColor: activeMeta.color,
              radius: 5,
              pointerLabelWidth: 80,
              pointerLabelHeight: 34,
              autoAdjustPointerLabelPosition: true,
              pointerLabelComponent: (items: any) => {
                const item = items[0];
                return (
                  <View style={styles.pointerTooltip}>
                    <Text style={styles.pointerTooltipVal}>
                      {Number(item?.value || 0).toFixed(activeMeta.precision)} {activeMeta.unit}
                    </Text>
                  </View>
                );
              },
            }}
          />

          {/* Quick Metrics Glance Footer */}
          <View style={styles.glanceRow}>
            <View style={styles.glanceItem}>
              <Text style={styles.glanceLabel}>Min</Text>
              <Text style={styles.glanceVal}>
                {minVal.toFixed(activeMeta.precision)} {activeMeta.unit}
              </Text>
            </View>
            <View style={styles.glanceDivider} />
            <View style={styles.glanceItem}>
              <Text style={styles.glanceLabel}>Avg</Text>
              <Text style={[styles.glanceVal, { color: activeMeta.color }]}>
                {avgVal.toFixed(activeMeta.precision)} {activeMeta.unit}
              </Text>
            </View>
            <View style={styles.glanceDivider} />
            <View style={styles.glanceItem}>
              <Text style={styles.glanceLabel}>Max</Text>
              <Text style={styles.glanceVal}>
                {maxVal.toFixed(activeMeta.precision)} {activeMeta.unit}
              </Text>
            </View>
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
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
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
    paddingVertical: 7,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 3,
  },
  tabIcon: {
    fontSize: 11,
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
  chartWrapper: {
    marginTop: spacing.xs,
    alignItems: 'center',
  },
  axisText: {
    color: colors.textMuted,
    fontSize: 10,
  },
  pointerTooltip: {
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerTooltipVal: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '700',
  },
  glanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: spacing.md,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  glanceItem: {
    alignItems: 'center',
  },
  glanceLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 2,
  },
  glanceVal: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  glanceDivider: {
    width: 1,
    height: 18,
    backgroundColor: colors.divider,
  },
  emptyContainer: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
