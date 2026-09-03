// src/screens/DashboardScreen.tsx

import React, { useEffect, useState, useContext, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { apiService, APIError } from '../services/apiService';
import { getNodes } from '../services/authService';
import { Reading, NodeConfig, PondThresholdProfile, getEffectiveProfile } from '../shared/types';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Gauge, StatusBar, SkeletonLoader, Button } from '../components';
import { saveCache, getCache, CACHE_KEYS } from '../services/cacheService';

export const DashboardScreen = () => {
  const { loading: authLoading, user } = useContext(AuthContext);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [nodeConfigs, setNodeConfigs] = useState<Record<string, NodeConfig>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  const fetchNodeConfigs = useCallback(async () => {
    try {
      const configs = await getNodes();
      const configMap: Record<string, NodeConfig> = {};
      for (const c of configs) {
        configMap[c.node_id] = c;
      }
      setNodeConfigs(configMap);
    } catch (err) {
      console.warn('[Dashboard] Could not fetch node configs:', err);
    }
  }, []);

  const fetchReadings = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await apiService.get<Reading[]>('/readings/latest');
      const readingsArray = Array.isArray(data) ? data : [data];
      setReadings(readingsArray);
      await saveCache(CACHE_KEYS.READINGS, readingsArray);

      if (readingsArray.length > 0) {
        setSelectedNodeId(prev => (prev && readingsArray.some(r => r.node_id === prev) ? prev : readingsArray[0].node_id));
      }
      setError(null);
      setIsOfflineMode(false);
    } catch (err) {
      const apiErr = err as APIError;
      const cached = await getCache<Reading[]>(CACHE_KEYS.READINGS);
      if (cached && cached.data.length > 0) {
        setReadings(cached.data);
        if (!selectedNodeId) setSelectedNodeId(cached.data[0].node_id);
        setError(`Offline Mode — Showing cached data from ${new Date(cached.timestamp).toLocaleTimeString()}`);
        setIsOfflineMode(true);
      } else {
        setError(apiErr.message || 'Failed to sync latest telemetry.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    if (!authLoading) {
      fetchNodeConfigs();
      fetchReadings();
    }
  }, [authLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchNodeConfigs(), fetchReadings(true)]);
  };

  const currentReading = selectedNodeId
    ? readings.find(r => r.node_id === selectedNodeId)
    : readings[0];
  const currentConfig = selectedNodeId ? nodeConfigs[selectedNodeId] : null;
  const profile: PondThresholdProfile = getEffectiveProfile(currentConfig);
  const nodeIds = Array.from(new Set([
    ...Object.keys(nodeConfigs),
    ...readings.map(reading => reading.node_id),
  ])).sort();

  // Dynamic FHI calculation using the active node's pond species profile
  const calculateFHI = (r?: Reading, p?: PondThresholdProfile) => {
    if (!r || r.temperature == null || r.turbidity == null || r.tds == null || r.ph == null) {
      return { score: 0, status: 'Unknown', color: colors.textMuted };
    }
    const thresholds = p || profile;
    let score = 100;

    const tempRange = thresholds.temperature.max - thresholds.temperature.min;
    const tempCenter = (thresholds.temperature.max + thresholds.temperature.min) / 2;
    const tempDeviation = Math.abs(r.temperature - tempCenter) / (tempRange / 2);
    if (tempDeviation > 0.5) score -= 15;
    if (tempDeviation > 0.9) score -= 20;

    const turbMax = thresholds.turbidity.max;
    if (r.turbidity > turbMax * 0.6) score -= 15;
    if (r.turbidity > turbMax) score -= 25;

    const tdsMin = thresholds.tds.min;
    const tdsMax = thresholds.tds.max;
    if (r.tds < tdsMin || r.tds > tdsMax) score -= 15;

    const phMin = thresholds.ph.min;
    const phMax = thresholds.ph.max;
    if (r.ph < phMin || r.ph > phMax) score -= 25;

    score = Math.max(0, Math.min(100, score));
    if (score >= 80) return { score, status: 'Optimal Health', color: colors.success };
    if (score >= 60) return { score, status: 'Moderate Stress', color: colors.warning };
    return { score, status: 'High Risk Condition', color: colors.error };
  };

  const fhi = calculateFHI(currentReading, profile);


  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>AquaLora Dashboard</Text>
          <Text style={styles.subtitle}>
            {user?.displayName || user?.nodeCode || 'Telemetry Monitor'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {currentConfig?.pond_type ? (
            <View style={styles.speciesBadge}>
              <Text style={styles.speciesBadgeText}>
                🐟 {currentConfig.pond_type.charAt(0).toUpperCase() + currentConfig.pond_type.slice(1)}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.refreshIconBtn} onPress={handleRefresh}>
            <Text style={styles.refreshIconText}>🔄</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Top Connection Status Bar */}
      <StatusBar
        isConnected={!isOfflineMode}
        lastSynced={currentReading ? new Date(currentReading.timestamp).toLocaleTimeString() : 'N/A'}
        nodeId={currentReading?.node_id}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {/* Skeleton Loading State */}
        {loading && !refreshing ? (
          <View style={styles.skeletonContainer}>
            <SkeletonLoader height={70} style={{ marginBottom: spacing.md }} />
            <SkeletonLoader height={140} style={{ marginBottom: spacing.md }} />
            <SkeletonLoader height={140} style={{ marginBottom: spacing.md }} />
          </View>
        ) : error && readings.length === 0 ? (
          /* Error Screen */
          <View style={[styles.card, shadows.medium, styles.errorCard]}>
            <Text style={styles.errorIcon}>📡</Text>
            <Text style={styles.errorTitle}>Connection Issue</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <Button title="Retry Sync" onPress={() => fetchReadings()} style={styles.retryBtn} />
          </View>
        ) : (
          <>
            {/* Multi-Node Selector Bar */}
            {nodeIds.length > 0 ? (
              <View style={styles.nodeSelector}>
                <Text style={styles.selectorLabel}>Active Node:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {nodeIds.map(nodeId => (
                    <TouchableOpacity
                      key={nodeId}
                      style={[
                        styles.nodePill,
                        selectedNodeId === nodeId && styles.nodePillActive,
                      ]}
                      onPress={() => setSelectedNodeId(nodeId)}
                    >
                      <Text
                        style={[
                          styles.nodePillText,
                          selectedNodeId === nodeId && styles.nodePillTextActive,
                        ]}
                      >
                        {nodeId}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {!currentReading ? (
              <View style={[styles.card, shadows.medium, styles.emptyCard]}>
                <Text style={styles.cardTitle}>No telemetry reported</Text>
                <Text style={styles.errorMessage}>
                  The selected node has no readings in the backend database yet.
                </Text>
              </View>
            ) : null}

            {currentReading && (
            <View>
            {/* Fish Health Index (FHI) Summary Card */}
            <View style={[styles.card, shadows.medium, styles.fhiCard]}>
              <View style={styles.fhiHeader}>
                <View>
                  <Text style={styles.cardTitle}>Fish Health Index (FHI)</Text>
                  <Text style={[styles.fhiStatusText, { color: fhi.color }]}>{fhi.status}</Text>
                </View>
                <View style={[styles.scoreBadge, { backgroundColor: fhi.color + '20' }]}>
                  <Text style={[styles.scoreText, { color: fhi.color }]}>{fhi.score}/100</Text>
                </View>
              </View>
              {/* Progress track */}
              <View style={styles.fhiProgressTrack}>
                <View style={[styles.fhiProgressFill, { width: `${fhi.score}%`, backgroundColor: fhi.color }]} />
              </View>
            </View>

            {/* Sensor Gauges Grid */}
            <Text style={styles.sectionHeader}>Live Sensor Parameters</Text>

            <Gauge
              title="Water Temperature"
              value={currentReading.temperature}
              unit="°C"
              min={Math.max(0, profile.temperature.min - 10)}
              max={profile.temperature.max + 10}
              safeMin={profile.temperature.min}
              safeMax={profile.temperature.max}
              icon="🌡️"
              precision={1}
            />

            <Gauge
              title="Water Turbidity"
              value={currentReading.turbidity}
              unit="NTU"
              min={0}
              max={Math.max(10, profile.turbidity.max + 5)}
              safeMin={profile.turbidity.min}
              safeMax={profile.turbidity.max}
              icon="💧"
              precision={2}
            />

            <Gauge
              title="Total Dissolved Solids (TDS)"
              value={currentReading.tds}
              unit="ppm"
              min={0}
              max={Math.max(1200, profile.tds.max + 200)}
              safeMin={profile.tds.min}
              safeMax={profile.tds.max}
              icon="🧪"
              precision={0}
            />

            <Gauge
              title="pH Balance"
              value={currentReading.ph}
              unit="pH"
              min={4}
              max={10}
              safeMin={profile.ph.min}
              safeMax={profile.ph.max}
              icon="⚖️"
              precision={1}
            />

            {/* System Telemetry & Signal Health Card */}
            <View style={[styles.card, shadows.medium]}>
              <Text style={styles.cardTitle}>Node Telemetry & Signal</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>🔋 Battery Level</Text>
                <Text style={styles.infoValue}>
                  {currentReading.battery_pct == null ? 'Not reported' : `${currentReading.battery_pct}%`}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>📡 RSSI Signal Strength</Text>
                <Text style={styles.infoValue}>
                  {currentReading.rssi == null ? 'Not reported' : `${currentReading.rssi} dBm`}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>🏞️ Pond Environment</Text>
                <Text style={styles.infoValue}>
                  {currentReading.pond_type || currentConfig?.pond_type || 'Not reported'}
                </Text>
              </View>
            </View>
            </View>
            )}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appTitle: {
    ...typography.h2,
    fontSize: 20,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  refreshIconBtn: {
    padding: spacing.xs,
  },
  refreshIconText: {
    fontSize: 20,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  speciesBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  speciesBadgeText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
  scrollContent: {
    padding: spacing.md,
  },

  skeletonContainer: {
    marginTop: spacing.sm,
  },
  nodeSelector: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectorLabel: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  nodePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.pill,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nodePillActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  nodePillText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  nodePillTextActive: {
    color: colors.textInverse,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fhiCard: {
    borderTopWidth: 4,
    borderTopColor: colors.primary,
    backgroundColor: colors.surfaceElevated,
  },
  fhiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    ...typography.h3,
    fontSize: 16,
  },
  fhiStatusText: {
    ...typography.caption,
    fontWeight: '700',
    marginTop: 2,
  },
  scoreBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
  },
  scoreText: {
    ...typography.label,
    fontWeight: '800',
  },
  fhiProgressTrack: {
    height: 10,
    backgroundColor: colors.gaugeTrack,
    borderRadius: borderRadius.pill,
    overflow: 'hidden',
    marginTop: 4,
  },
  fhiProgressFill: {
    height: '100%',
    borderRadius: borderRadius.pill,
  },
  sectionHeader: {
    ...typography.h3,
    fontSize: 17,
    marginVertical: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  infoLabel: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  infoValue: {
    ...typography.body2,
    fontWeight: '600',
    color: colors.text,
  },
  errorCard: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: spacing.xs,
  },
  errorTitle: {
    ...typography.h2,
    fontSize: 18,
    marginBottom: spacing.xs,
  },
  errorMessage: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  retryBtn: {
    width: 160,
  },
});
