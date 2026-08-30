// src/screens/AlertsScreen.tsx

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  SafeAreaView,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { apiService, APIError } from '../services/apiService';
import { Alert, AlertSeverity } from '../shared/types';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { AlertBadge, SkeletonLoader, Button } from '../components';

type SeverityFilter = 'all' | 'critical' | 'warning' | 'normal';

export const AlertsScreen = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);

  const fetchAlerts = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await apiService.get<Alert[]>('/alerts/latest');
      const alertsArray = Array.isArray(data) ? data : [data];
      setAlerts(alertsArray);
      setError(null);
    } catch (err) {
      const apiErr = err as APIError;
      setError(apiErr.message || 'Failed to fetch alerts.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAlerts(true);
  };

  const filteredAlerts = alerts.filter(a => {
    if (filter === 'all') return true;
    return a.severity === filter;
  });

  const counts = {
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning: alerts.filter(a => a.severity === 'warning').length,
    normal: alerts.filter(a => a.severity === 'normal').length,
  };

  const getAlertBorderColor = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return colors.error;
      case 'warning':
        return colors.warning;
      case 'normal':
      default:
        return colors.info;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>System Alerts</Text>
          <Text style={styles.subtitle}>Telemetry Threshold Notifications</Text>
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeText}>{alerts.length} Total</Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {(['all', 'critical', 'warning', 'normal'] as SeverityFilter[]).map(f => {
            const count = f === 'all' ? alerts.length : counts[f as keyof typeof counts];
            return (
              <TouchableOpacity
                key={f}
                style={[styles.filterPill, filter === f && styles.filterPillActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        {loading && !refreshing ? (
          <View>
            <SkeletonLoader height={80} style={{ marginBottom: spacing.sm }} />
            <SkeletonLoader height={80} style={{ marginBottom: spacing.sm }} />
            <SkeletonLoader height={80} style={{ marginBottom: spacing.sm }} />
          </View>
        ) : error ? (
          <View style={[styles.card, shadows.medium, styles.errorCard]}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Alerts Unavailable</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <Button title="Retry Loading" onPress={() => fetchAlerts()} />
          </View>
        ) : filteredAlerts.length === 0 ? (
          <View style={[styles.card, shadows.medium, styles.emptyCard]}>
            <Text style={styles.emptyIcon}>🛡️</Text>
            <Text style={styles.emptyTitle}>No Alerts Triggered</Text>
            <Text style={styles.emptyMessage}>All pond telemetry parameters are operating within safe bounds.</Text>
          </View>
        ) : (
          filteredAlerts.map(alert => (
            <TouchableOpacity
              key={alert.id || `${alert.node_id}-${alert.timestamp}`}
              style={[
                styles.card,
                shadows.medium,
                { borderLeftWidth: 4, borderLeftColor: getAlertBorderColor(alert.severity) },
              ]}
              onPress={() => setSelectedAlert(alert)}
              activeOpacity={0.7}
            >
              <View style={styles.alertHeader}>
                <AlertBadge severity={alert.severity} />
                <Text style={styles.alertTime}>
                  {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>

              <Text style={styles.alertMessage}>{alert.message}</Text>

              <View style={styles.alertFooter}>
                <Text style={styles.alertNode}>Node: {alert.node_id}</Text>
                <Text style={styles.alertParameter}>Parameter: {alert.parameter}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Alert Detail Modal Overlay */}
      {selectedAlert ? (
        <Modal transparent animationType="fade" visible={!!selectedAlert} onRequestClose={() => setSelectedAlert(null)}>
          <TouchableWithoutFeedback onPress={() => setSelectedAlert(null)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalCard, shadows.large]}>
                  <View style={styles.modalHeader}>
                    <AlertBadge severity={selectedAlert.severity} />
                    <TouchableOpacity onPress={() => setSelectedAlert(null)}>
                      <Text style={styles.closeModalText}>✕</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalTitle}>Alert Notification Details</Text>
                  <Text style={styles.modalBody}>{selectedAlert.message}</Text>

                  <View style={styles.modalInfoBox}>
                    <View style={styles.modalInfoRow}>
                      <Text style={styles.modalInfoLabel}>Node ID:</Text>
                      <Text style={styles.modalInfoValue}>{selectedAlert.node_id}</Text>
                    </View>
                    <View style={styles.modalInfoRow}>
                      <Text style={styles.modalInfoLabel}>Parameter:</Text>
                      <Text style={styles.modalInfoValue}>{selectedAlert.parameter}</Text>
                    </View>
                    <View style={styles.modalInfoRow}>
                      <Text style={styles.modalInfoLabel}>Timestamp:</Text>
                      <Text style={styles.modalInfoValue}>{new Date(selectedAlert.timestamp).toLocaleString()}</Text>
                    </View>
                  </View>

                  <Button title="Close Details" variant="secondary" onPress={() => setSelectedAlert(null)} />
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      ) : null}
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
  title: {
    ...typography.h2,
    fontSize: 20,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
  totalBadge: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
  },
  totalBadgeText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  filterRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.surfaceAlt,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  filterText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.textInverse,
  },
  scrollContent: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm + 4,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  alertTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
  alertMessage: {
    ...typography.body1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginVertical: 4,
  },
  alertFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  alertNode: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  alertParameter: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  emptyCard: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    ...typography.h3,
    marginBottom: 4,
  },
  emptyMessage: {
    ...typography.body2,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorCard: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorIcon: {
    fontSize: 36,
    marginBottom: spacing.xs,
  },
  errorTitle: {
    ...typography.h3,
    marginBottom: 4,
  },
  errorMessage: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  closeModalText: {
    fontSize: 20,
    color: colors.textMuted,
    padding: 4,
  },
  modalTitle: {
    ...typography.h2,
    fontSize: 18,
    marginBottom: spacing.xs,
  },
  modalBody: {
    ...typography.body1,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  modalInfoBox: {
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalInfoLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  modalInfoValue: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.text,
  },
});
