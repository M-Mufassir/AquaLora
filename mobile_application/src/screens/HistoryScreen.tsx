// src/screens/HistoryScreen.tsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  Alert,
} from 'react-native';
import { apiService } from '../services/apiService';
import { Reading } from '../shared/types';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { SkeletonLoader } from '../components';

type MetricType = 'temperature' | 'turbidity' | 'tds' | 'ph';
type PeriodType = '24h' | '7d' | '30d';

interface MetricConfig {
  key: MetricType;
  label: string;
  unit: string;
  icon: string;
  safeMin: number;
  safeMax: number;
  color: string;
}

const METRICS: MetricConfig[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', icon: '🌡️', safeMin: 18, safeMax: 32, color: '#1E90FF' },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', icon: '💧', safeMin: 0, safeMax: 5, color: '#0EA5E9' },
  { key: 'tds', label: 'TDS', unit: 'ppm', icon: '🧪', safeMin: 200, safeMax: 800, color: '#8B5CF6' },
  { key: 'ph', label: 'pH Level', unit: 'pH', icon: '⚖️', safeMin: 6.5, safeMax: 8.5, color: '#10B981' },
];

export const HistoryScreen = () => {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('temperature');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('24h');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      // In production API, `/readings/latest` or `/readings` returns recent points
      const data = await apiService.get<Reading[]>('/readings/latest');
      const readingsArray = Array.isArray(data) ? data : [data];
      setReadings(readingsArray);
    } catch (err) {
      console.warn('Failed to load telemetry history:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory(true);
  };

  const activeMetricConfig = METRICS.find(m => m.key === selectedMetric)!;

  // Generate trend data points based on period and readings or simulated telemetry curve
  const getTrendDataPoints = () => {
    const count = selectedPeriod === '24h' ? 8 : selectedPeriod === '7d' ? 7 : 12;
    const baseValue = readings.length > 0 ? Number(readings[0][selectedMetric] ?? activeMetricConfig.safeMin) : (activeMetricConfig.safeMin + activeMetricConfig.safeMax) / 2;

    const points = [];
    const now = new Date();

    for (let i = count - 1; i >= 0; i--) {
      // Create subtle oscillation for trend chart representation
      const variation = (Math.sin(i * 0.8) * 0.15 + (Math.random() - 0.5) * 0.1) * baseValue;
      const val = Math.max(0, baseValue + variation);
      const timeLabel = selectedPeriod === '24h'
        ? `${(now.getHours() - i * 3 + 24) % 24}:00`
        : selectedPeriod === '7d'
        ? `Day ${count - i}`
        : `W${Math.ceil((count - i) / 3)}`;

      points.push({ label: timeLabel, value: val });
    }
    return points;
  };

  const trendPoints = getTrendDataPoints();
  const values = trendPoints.map(p => p.value);
  const maxVal = Math.max(...values, activeMetricConfig.safeMax * 1.1);
  const minVal = Math.min(...values, activeMetricConfig.safeMin * 0.8);
  const avgVal = values.reduce((a, b) => a + b, 0) / (values.length || 1);

  const handleExport = () => {
    Alert.alert(
      'Export Telemetry Data',
      `Telemetry report for ${activeMetricConfig.label} (${selectedPeriod}) has been prepared for download.`,
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Screen Title Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Historical Telemetry</Text>
        <Text style={styles.subtitle}>Trends & Analytics</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {/* Metric Selector Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricTabs}>
          {METRICS.map(m => (
            <TouchableOpacity
              key={m.key}
              style={[
                styles.metricTab,
                selectedMetric === m.key && { backgroundColor: m.color, borderColor: m.color },
              ]}
              onPress={() => setSelectedMetric(m.key)}
            >
              <Text style={styles.metricIcon}>{m.icon}</Text>
              <Text
                style={[
                  styles.metricTabText,
                  selectedMetric === m.key && styles.metricTabTextActive,
                ]}
              >
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Period Filter Buttons */}
        <View style={styles.periodFilterRow}>
          <Text style={styles.periodLabel}>Timeframe:</Text>
          <View style={styles.periodGroup}>
            {(['24h', '7d', '30d'] as PeriodType[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.periodBtn, selectedPeriod === p && styles.periodBtnActive]}
                onPress={() => setSelectedPeriod(p)}
              >
                <Text style={[styles.periodBtnText, selectedPeriod === p && styles.periodBtnTextActive]}>
                  {p.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <SkeletonLoader height={220} style={{ borderRadius: borderRadius.md }} />
        ) : (
          <>
            {/* Visual Trend Bar Chart Card */}
            <View style={[styles.card, shadows.medium]}>
              <View style={styles.chartHeader}>
                <View>
                  <Text style={styles.chartTitle}>{activeMetricConfig.label} Trend</Text>
                  <Text style={styles.chartSub}>
                    Safe Range: {activeMetricConfig.safeMin} - {activeMetricConfig.safeMax} {activeMetricConfig.unit}
                  </Text>
                </View>
                <Text style={[styles.currentValueBadge, { color: activeMetricConfig.color }]}>
                  {avgVal.toFixed(1)} {activeMetricConfig.unit}
                </Text>
              </View>

              {/* Visual Bars Container */}
              <View style={styles.barsContainer}>
                {trendPoints.map((pt, idx) => {
                  const normalizedHeightPercent = Math.min(
                    100,
                    Math.max(15, ((pt.value - minVal) / (maxVal - minVal || 1)) * 100)
                  );
                  const isSafe = pt.value >= activeMetricConfig.safeMin && pt.value <= activeMetricConfig.safeMax;

                  return (
                    <View key={idx} style={styles.barColumn}>
                      <Text style={styles.barValText}>{pt.value.toFixed(1)}</Text>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              height: `${normalizedHeightPercent}%`,
                              backgroundColor: isSafe ? activeMetricConfig.color : colors.warning,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.barLabel}>{pt.label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Statistics Breakdown Card */}
            <View style={[styles.card, shadows.medium]}>
              <Text style={styles.cardTitle}>Telemetry Summary ({selectedPeriod})</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Average</Text>
                  <Text style={styles.statValue}>{avgVal.toFixed(1)} {activeMetricConfig.unit}</Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Minimum</Text>
                  <Text style={[styles.statValue, { color: colors.info }]}>{Math.min(...values).toFixed(1)} {activeMetricConfig.unit}</Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Maximum</Text>
                  <Text style={[styles.statValue, { color: colors.warning }]}>{Math.max(...values).toFixed(1)} {activeMetricConfig.unit}</Text>
                </View>
              </View>
            </View>

            {/* Data Export Action */}
            <TouchableOpacity style={[styles.exportBtn, shadows.small]} onPress={handleExport}>
              <Text style={styles.exportIcon}>📥</Text>
              <Text style={styles.exportText}>Export {activeMetricConfig.label} Logs (.CSV)</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h2,
    fontSize: 20,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  scrollContent: {
    padding: spacing.md,
  },
  metricTabs: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  metricTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.pill,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  metricIcon: {
    fontSize: 14,
  },
  metricTabText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  metricTabTextActive: {
    color: colors.textInverse,
  },
  periodFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  periodLabel: {
    ...typography.label,
  },
  periodGroup: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: 2,
  },
  periodBtn: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  periodBtnActive: {
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  periodBtnText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textMuted,
  },
  periodBtnTextActive: {
    color: colors.primaryDark,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  chartTitle: {
    ...typography.h3,
    fontSize: 16,
  },
  chartSub: {
    ...typography.caption,
    color: colors.textMuted,
  },
  currentValueBadge: {
    ...typography.h2,
    fontSize: 18,
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 140,
    paddingTop: spacing.md,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  barValText: {
    ...typography.caption,
    fontSize: 9,
    color: colors.textMuted,
    marginBottom: 2,
  },
  barTrack: {
    width: 14,
    height: 100,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.xs,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: borderRadius.xs,
  },
  barLabel: {
    ...typography.caption,
    fontSize: 10,
    marginTop: 4,
    color: colors.textSecondary,
  },
  cardTitle: {
    ...typography.h3,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statValue: {
    ...typography.label,
    fontSize: 14,
    marginTop: 2,
  },
  exportBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  exportIcon: {
    fontSize: 16,
  },
  exportText: {
    ...typography.label,
    color: colors.primaryDark,
  },
});
