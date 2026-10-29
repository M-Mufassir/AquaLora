// src/screens/HistoryScreen.tsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LineChart, lineDataItem } from 'react-native-gifted-charts';
import { apiService } from '../services/apiService';
import { Reading } from '../shared/types';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { SkeletonLoader } from '../components';
import { saveCache, getCache, CACHE_KEYS } from '../services/cacheService';

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
  precision: number;
}

const METRICS: MetricConfig[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', icon: '🌡️', safeMin: 22, safeMax: 30, color: '#0284C7', precision: 1 },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', icon: '💧', safeMin: 0, safeMax: 5, color: '#0EA5E9', precision: 2 },
  { key: 'tds', label: 'TDS', unit: 'ppm', icon: '🧪', safeMin: 300, safeMax: 600, color: '#8B5CF6', precision: 0 },
  { key: 'ph', label: 'pH Level', unit: 'pH', icon: '⚖️', safeMin: 6.5, safeMax: 8.5, color: '#10B981', precision: 1 },
];

export const HistoryScreen = () => {
  const insets = useSafeAreaInsets();
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('temperature');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('24h');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [cardWidth, setCardWidth] = useState<number>(320);

  const activeMetricConfig = METRICS.find(m => m.key === selectedMetric)!;

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const now = new Date();
      const rangeMs = selectedPeriod === '24h'
        ? 24 * 60 * 60 * 1000
        : selectedPeriod === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
      const start = new Date(now.getTime() - rangeMs).toISOString();

      const data = await apiService.get<Reading[]>('/readings/history', {
        start,
        end: now.toISOString(),
        limit: selectedPeriod === '24h' ? 50 : selectedPeriod === '7d' ? 100 : 200,
      });

      const readingsArray = Array.isArray(data) ? data : [data];
      const sorted = [...readingsArray].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setReadings(sorted);
      await saveCache(CACHE_KEYS.HISTORY, sorted);
      setIsOfflineMode(false);
    } catch (err) {
      console.warn('Failed to load live telemetry history, attempting cache fallback:', err);
      const cached = await getCache<Reading[]>(CACHE_KEYS.HISTORY);
      if (cached && cached.data.length > 0) {
        setReadings(cached.data);
        setIsOfflineMode(true);
      } else {
        setReadings([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedPeriod]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory(true);
  };

  const handleCardLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setCardWidth(w);
  };

  // Downsample or pick points for responsive charting
  const getChartDataPoints = (): lineDataItem[] => {
    if (!readings.length) return [];

    // Limit points to avoid crowding the chart
    const maxPoints = selectedPeriod === '24h' ? 12 : selectedPeriod === '7d' ? 14 : 20;
    const step = Math.max(1, Math.floor(readings.length / maxPoints));
    const sample = readings.filter((_, idx) => idx % step === 0).slice(-maxPoints);

    return sample.map((reading, idx) => {
      const date = new Date(reading.timestamp);
      const val = Number(reading[selectedMetric] ?? 0);
      const timeStr = selectedPeriod === '24h'
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' });

      const showLabel = idx === 0 || idx === Math.floor(sample.length / 2) || idx === sample.length - 1;

      return {
        value: val,
        label: showLabel ? timeStr : '',
        labelTextStyle: {
          color: colors.textMuted,
          fontSize: 10,
          fontWeight: '500',
        },
        dataPointColor: activeMetricConfig.color,
        dataPointRadius: 4,
      };
    });
  };

  const chartPoints = getChartDataPoints();
  const values = readings.map(r => Number(r[selectedMetric] ?? 0));
  const hasValues = values.length > 0;
  const avgVal = hasValues ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const minVal = hasValues ? Math.min(...values) : 0;
  const maxVal = hasValues ? Math.max(...values) : 0;

  const calculatedSpacing = chartPoints.length > 1
    ? Math.max(26, (cardWidth - 80) / (chartPoints.length - 1))
    : 40;

  const handleExport = () => {
    Alert.alert(
      'Export Telemetry Data',
      `Telemetry report for ${activeMetricConfig.label} (${selectedPeriod}) with ${readings.length} data points has been prepared.`,
      [{ text: 'OK' }]
    );
  };

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      {/* Screen Title Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Historical Telemetry</Text>
          <Text style={styles.subtitle}>
            {isOfflineMode ? '⚡ Offline Cached View' : 'Multi-Day Trends & Cloud Analytics'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {/* Metric Selector Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricTabs}>
          {METRICS.map(m => {
            const isActive = selectedMetric === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[
                  styles.metricTab,
                  isActive && { backgroundColor: m.color, borderColor: m.color },
                ]}
                onPress={() => setSelectedMetric(m.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.metricIcon}>{m.icon}</Text>
                <Text
                  style={[
                    styles.metricTabText,
                    isActive && styles.metricTabTextActive,
                  ]}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Period Filter Buttons */}
        <View style={styles.periodFilterRow}>
          <Text style={styles.periodLabel}>Timeframe Filter</Text>
          <View style={styles.periodGroup}>
            {(['24h', '7d', '30d'] as PeriodType[]).map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.periodBtn, selectedPeriod === p && styles.periodBtnActive]}
                onPress={() => setSelectedPeriod(p)}
                activeOpacity={0.7}
              >
                <Text style={[styles.periodBtnText, selectedPeriod === p && styles.periodBtnTextActive]}>
                  {p.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <SkeletonLoader height={240} style={{ borderRadius: borderRadius.md }} />
        ) : (
          <>
            {/* Visual Trend Chart Card */}
            <View style={[styles.card, shadows.medium]} onLayout={handleCardLayout}>
              <View style={styles.chartHeader}>
                <View>
                  <Text style={styles.chartTitle}>{activeMetricConfig.label} Trendline</Text>
                  <Text style={styles.chartSub}>
                    Safe Range: {activeMetricConfig.safeMin} – {activeMetricConfig.safeMax} {activeMetricConfig.unit}
                  </Text>
                </View>
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeLabel}>Avg</Text>
                  <Text style={[styles.currentValueBadge, { color: activeMetricConfig.color }]}>
                    {avgVal.toFixed(activeMetricConfig.precision)} {activeMetricConfig.unit}
                  </Text>
                </View>
              </View>

              {chartPoints.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No historical records available for {selectedPeriod}.</Text>
                </View>
              ) : (
                <View style={styles.chartWrapper}>
                  <LineChart
                    data={chartPoints}
                    height={180}
                    spacing={calculatedSpacing}
                    initialSpacing={14}
                    endSpacing={14}
                    color={activeMetricConfig.color}
                    thickness={3}
                    curved
                    areaChart
                    startFillColor={activeMetricConfig.color}
                    endFillColor={`${activeMetricConfig.color}08`}
                    startOpacity={0.38}
                    endOpacity={0.03}
                    dataPointsColor={activeMetricConfig.color}
                    dataPointsRadius={4}
                    noOfSections={4}
                    rulesType="solid"
                    rulesColor={colors.border}
                    yAxisColor="transparent"
                    xAxisColor={colors.border}
                    yAxisTextStyle={styles.axisText}
                    xAxisLabelTextStyle={styles.axisText}
                    yAxisLabelWidth={38}
                    isAnimated
                    animationDuration={600}
                    pointerConfig={{
                      pointerStripHeight: 160,
                      pointerStripColor: activeMetricConfig.color,
                      pointerStripWidth: 1.5,
                      pointerColor: activeMetricConfig.color,
                      radius: 5,
                      pointerLabelWidth: 85,
                      pointerLabelHeight: 36,
                      autoAdjustPointerLabelPosition: true,
                      pointerLabelComponent: (items: any) => {
                        const item = items[0];
                        return (
                          <View style={styles.pointerTooltip}>
                            <Text style={styles.pointerTooltipVal}>
                              {Number(item?.value || 0).toFixed(activeMetricConfig.precision)} {activeMetricConfig.unit}
                            </Text>
                          </View>
                        );
                      },
                    }}
                  />
                </View>
              )}
            </View>

            {/* Statistics Breakdown Card */}
            <View style={[styles.card, shadows.medium]}>
              <Text style={styles.cardTitle}>Telemetry Summary ({selectedPeriod})</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Average</Text>
                  <Text style={[styles.statValue, { color: activeMetricConfig.color }]}>
                    {avgVal.toFixed(activeMetricConfig.precision)} {activeMetricConfig.unit}
                  </Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Minimum</Text>
                  <Text style={[styles.statValue, { color: colors.info }]}>
                    {minVal.toFixed(activeMetricConfig.precision)} {activeMetricConfig.unit}
                  </Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Maximum</Text>
                  <Text style={[styles.statValue, { color: colors.warning }]}>
                    {maxVal.toFixed(activeMetricConfig.precision)} {activeMetricConfig.unit}
                  </Text>
                </View>

                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Total Logs</Text>
                  <Text style={styles.statValue}>{readings.length}</Text>
                </View>
              </View>
            </View>

            {/* Data Export Action */}
            <TouchableOpacity style={[styles.exportBtn, shadows.small]} onPress={handleExport} activeOpacity={0.8}>
              <Text style={styles.exportIcon}>📥</Text>
              <Text style={styles.exportText}>Export {activeMetricConfig.label} Logs (.CSV)</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.h2,
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
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
    paddingVertical: spacing.xs + 3,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.pill,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  metricIcon: {
    fontSize: 13,
  },
  metricTabText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    fontSize: 12,
  },
  metricTabTextActive: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  periodFilterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  periodLabel: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  periodGroup: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodBtn: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 5,
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
    fontSize: 11,
  },
  periodBtnTextActive: {
    color: colors.primaryDark,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  chartTitle: {
    ...typography.h3,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  chartSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  currentBadge: {
    alignItems: 'flex-end',
  },
  currentBadgeLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  currentValueBadge: {
    ...typography.h2,
    fontSize: 17,
    fontWeight: '800',
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
    paddingVertical: 5,
    borderRadius: borderRadius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerTooltipVal: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: '700',
  },
  cardTitle: {
    ...typography.h3,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.sm,
    color: colors.textPrimary,
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
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
  },
  statValue: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  exportBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.sm + 4,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  exportIcon: {
    fontSize: 16,
  },
  exportText: {
    ...typography.label,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  emptyContainer: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
