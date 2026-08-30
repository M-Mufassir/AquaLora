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
import { Reading } from '../shared/types';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Gauge, StatusBar, SkeletonLoader, Button } from '../components';

export const DashboardScreen = () => {
  const { loading: authLoading } = useContext(AuthContext);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadings = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await apiService.get<Reading[]>('/readings/latest');
      const readingsArray = Array.isArray(data) ? data : [data];
      setReadings(readingsArray);

      if (readingsArray.length > 0) {
        setSelectedNodeId(prev => (prev && readingsArray.some(r => r.node_id === prev) ? prev : readingsArray[0].node_id));
      }
      setError(null);
    } catch (err) {
      const apiErr = err as APIError;
      setError(apiErr.message || 'Failed to sync latest telemetry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      fetchReadings();
    }
  }, [authLoading, fetchReadings]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchReadings(true);
  };

  const currentReading = readings.find(r => r.node_id === selectedNodeId) || readings[0];

  // Fish Health Index (FHI) calculation algorithm (0 - 100)
  const calculateFHI = (r?: Reading) => {
    if (!r) return { score: 0, status: 'Unknown', color: colors.textMuted };

    let score = 100;
    // Temp penalty: ideal 22 - 28
    if (r.temperature < 20 || r.temperature > 30) score -= 15;
    if (r.temperature < 18 || r.temperature > 32) score -= 20;

    // Turbidity penalty: ideal < 3
    if (r.turbidity > 3) score -= 15;
    if (r.turbidity > 5) score -= 25;

    // TDS penalty: ideal 300 - 600
    if (r.tds < 200 || r.tds > 800) score -= 15;

    // pH penalty: ideal 6.8 - 7.8
    if (r.ph < 6.5 || r.ph > 8.5) score -= 25;

    score = Math.max(0, Math.min(100, score));

    if (score >= 80) return { score, status: 'Optimal Health', color: colors.success };
    if (score >= 60) return { score, status: 'Moderate Stress', color: colors.warning };
    return { score, status: 'High Risk Condition', color: colors.error };
  };

  const fhi = calculateFHI(currentReading);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>AquaLora Dashboard</Text>
          <Text style={styles.subtitle}>Telemetry Monitor</Text>
        </View>
        <TouchableOpacity style={styles.refreshIconBtn} onPress={() => fetchReadings()}>
          <Text style={styles.refreshIconText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Top Connection Status Bar */}
      <StatusBar
        isConnected={!error}
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
        ) : currentReading ? (
          <>
            {/* Multi-Node Selector Bar */}
            {readings.length > 1 ? (
              <View style={styles.nodeSelector}>
                <Text style={styles.selectorLabel}>Active Node:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {readings.map(r => (
                    <TouchableOpacity
                      key={r.node_id}
                      style={[
                        styles.nodePill,
                        selectedNodeId === r.node_id && styles.nodePillActive,
                      ]}
                      onPress={() => setSelectedNodeId(r.node_id)}
                    >
                      <Text
                        style={[
                          styles.nodePillText,
                          selectedNodeId === r.node_id && styles.nodePillTextActive,
                        ]}
                      >
                        {r.node_id}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}

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
              min={10}
              max={40}
              safeMin={18}
              safeMax={32}
              icon="🌡️"
              precision={1}
            />

            <Gauge
              title="Water Turbidity"
              value={currentReading.turbidity}
              unit="NTU"
              min={0}
              max={10}
              safeMin={0}
              safeMax={5}
              icon="💧"
              precision={2}
            />

            <Gauge
              title="Total Dissolved Solids (TDS)"
              value={currentReading.tds}
              unit="ppm"
              min={0}
              max={1200}
              safeMin={200}
              safeMax={800}
              icon="🧪"
              precision={0}
            />

            <Gauge
              title="pH Balance"
              value={currentReading.ph}
              unit="pH"
              min={4}
              max={10}
              safeMin={6.5}
              safeMax={8.5}
              icon="⚖️"
              precision={1}
            />

            {/* System Telemetry & Signal Health Card */}
            <View style={[styles.card, shadows.medium]}>
              <Text style={styles.cardTitle}>Node Telemetry & Signal</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>🔋 Battery Level</Text>
                <Text style={styles.infoValue}>{currentReading.battery_pct ?? 100}%</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>📡 RSSI Signal Strength</Text>
                <Text style={styles.infoValue}>{currentReading.rssi ?? -65} dBm</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>🏞️ Pond Environment</Text>
                <Text style={styles.infoValue}>{currentReading.pond_type || 'Freshwater Aquaculture'}</Text>
              </View>
            </View>
          </>
        ) : null}
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
  scrollContent: {
    padding: spacing.md,
  },
  skeletonContainer: {
    marginTop: spacing.sm,
  },
  nodeSelector: {
    marginBottom: spacing.md,
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
    backgroundColor: colors.primary,
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
  },
  fhiCard: {
    borderTopWidth: 4,
    borderTopColor: colors.primary,
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
  retryBtn: {
    width: 160,
  },
});
