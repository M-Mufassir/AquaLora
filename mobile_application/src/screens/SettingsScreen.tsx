// src/screens/SettingsScreen.tsx

import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { API_BASE_URL } from '../config';
import { apiService } from '../services/apiService';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Button, ConfirmationModal } from '../components';

export const SettingsScreen = () => {
  const { user, logout } = useContext(AuthContext);
  const [serverUrl, setServerUrl] = useState(API_BASE_URL);
  const [refreshInterval, setRefreshInterval] = useState('30s');
  const [testingConnection, setTestingConnection] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      // Test endpoint or health check
      await apiService.get('/readings/latest');
      Alert.alert('Connection Success', 'Successfully communicated with the AquaLora Backend Server!');
    } catch (err: any) {
      Alert.alert('Connection Failed', err.message || 'Unable to reach backend at specified URL.');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleLogoutConfirm = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setLoggingOut(false);
      setLogoutModalVisible(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>System Settings</Text>
        <Text style={styles.subtitle}>App Configuration & Account</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User Account Card */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>User Account Profile</Text>
          <View style={styles.profileBox}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{user?.username?.charAt(0).toUpperCase() || 'U'}</Text>
            </View>
            <View style={styles.profileDetails}>
              <Text style={styles.usernameText}>{user?.username || 'Operator'}</Text>
              <Text style={styles.roleBadge}>Role: {user?.role || 'Administrator'}</Text>
            </View>
          </View>
        </View>

        {/* Server & API Config */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>Backend Server Configuration</Text>

          <Text style={styles.label}>API Base Endpoint URL</Text>
          <View style={styles.urlInputRow}>
            <TextInput
              style={styles.urlInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Button
            title="Test Connection"
            variant="outline"
            onPress={handleTestConnection}
            loading={testingConnection}
            style={styles.testBtn}
          />
        </View>

        {/* Auto Refresh Preferences */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>Telemetry Refresh Rate</Text>
          <Text style={styles.subtext}>Select background telemetry auto-polling interval:</Text>

          <View style={styles.intervalRow}>
            {['Off', '15s', '30s', '60s'].map(interval => (
              <TouchableOpacity
                key={interval}
                style={[
                  styles.intervalPill,
                  refreshInterval === interval && styles.intervalPillActive,
                ]}
                onPress={() => setRefreshInterval(interval)}
              >
                <Text
                  style={[
                    styles.intervalText,
                    refreshInterval === interval && styles.intervalTextActive,
                  ]}
                >
                  {interval}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* System Information */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>About AquaLora Mobile</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App Version</Text>
            <Text style={styles.infoVal}>v1.0.0 (Production Build)</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Framework</Text>
            <Text style={styles.infoVal}>React Native / Expo SDK 57</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Security Level</Text>
            <Text style={styles.infoVal}>SecureStore Keychain Encrypted</Text>
          </View>
        </View>

        {/* Logout Button */}
        <Button
          title="Sign Out of Session"
          variant="danger"
          size="large"
          onPress={() => setLogoutModalVisible(true)}
          style={styles.logoutBtn}
        />
      </ScrollView>

      {/* Confirmation Modal */}
      <ConfirmationModal
        visible={logoutModalVisible}
        title="Sign Out Confirmation"
        message="Are you sure you want to end your current session and sign out?"
        confirmText="Sign Out"
        confirmVariant="danger"
        onConfirm={handleLogoutConfirm}
        onCancel={() => setLogoutModalVisible(false)}
        loading={loggingOut}
      />
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    ...typography.h3,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  profileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    ...typography.h2,
    color: colors.textInverse,
  },
  profileDetails: {
    flex: 1,
  },
  usernameText: {
    ...typography.h3,
    fontSize: 16,
  },
  roleBadge: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  label: {
    ...typography.label,
    marginBottom: 6,
  },
  subtext: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  urlInputRow: {
    marginBottom: spacing.sm,
  },
  urlInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 4,
    height: 44,
    ...typography.body2,
  },
  testBtn: {
    marginTop: spacing.xs,
  },
  intervalRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  intervalPill: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  intervalPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  intervalText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  intervalTextActive: {
    color: colors.textInverse,
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
  infoVal: {
    ...typography.body2,
    fontWeight: '600',
  },
  logoutBtn: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
});
