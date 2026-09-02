// src/screens/SettingsScreen.tsx

import React, { useState, useContext, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { API_BASE_URL } from '../config';
import { apiService } from '../services/apiService';
import {
  getProfile,
  updateProfile,
  changePassword,
  getNodes,
  updateNodeConfig,
} from '../services/authService';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Button, ConfirmationModal } from '../components';
import { DEFAULT_POND_PROFILES, PondType } from '../shared/types';

// ─── Reusable section-level action row ───────────────────────────────────────
interface SyncRowProps {
  onSync: () => Promise<void>;
  onUpload: () => Promise<void>;
  syncLabel?: string;
  uploadLabel?: string;
}
const SyncRow: React.FC<SyncRowProps> = ({
  onSync,
  onUpload,
  syncLabel = '⬇ Sync from Cloud',
  uploadLabel = '⬆ Upload to Cloud',
}) => {
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  };

  const handleUpload = async () => {
    setUploading(true);
    try {
      await onUpload();
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={srStyles.row}>
      <TouchableOpacity
        style={[srStyles.btn, srStyles.syncBtn]}
        onPress={handleSync}
        disabled={syncing || uploading}
      >
        {syncing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={srStyles.syncText}>{syncLabel}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[srStyles.btn, srStyles.uploadBtn]}
        onPress={handleUpload}
        disabled={syncing || uploading}
      >
        {uploading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={srStyles.uploadText}>{uploadLabel}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const srStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  btn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  syncBtn: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  uploadBtn: {
    backgroundColor: colors.primary,
  },
  syncText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primary,
  },
  uploadText: {
    ...typography.caption,
    fontWeight: '700',
    color: '#fff',
  },
});

// ─── Main SettingsScreen ──────────────────────────────────────────────────────
const POND_TYPES: PondType[] = ['tilapia', 'prawn', 'catfish', 'tuna', 'salmon', 'general'];

export const SettingsScreen = () => {
  const { user, logout } = useContext(AuthContext);

  // Server config state
  const [serverUrl, setServerUrl] = useState(API_BASE_URL);
  const [refreshInterval, setRefreshInterval] = useState('30s');
  const [testingConnection, setTestingConnection] = useState(false);

  // Profile state
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [siteLocation, setSiteLocation] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
  }, [user?.displayName]);

  // Password state
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  // Node config state  
  const [nodeConfigs, setNodeConfigs] = useState<any[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodePondType, setNodePondType] = useState<PondType>('tilapia');
  const [nodeName, setNodeName] = useState('');
  const [nodeLocation, setNodeLocation] = useState('');

  // UI state
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // ─── Connection Test ────────────────────────────────────────────────────────
  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      await apiService.get('/readings/latest');
      Alert.alert('✅ Connection Success', 'Successfully communicated with the AquaLora Backend Server!');
    } catch (err: any) {
      Alert.alert('❌ Connection Failed', err.message || 'Unable to reach backend at specified URL.');
    } finally {
      setTestingConnection(false);
    }
  };

  // ─── Profile Sync / Upload ──────────────────────────────────────────────────
  const syncProfile = useCallback(async () => {
    try {
      const data = await getProfile();
      setDisplayName(data.display_name || '');
      setContactName(data.contact_name || '');
      setContactPhone(data.contact_phone || '');
      setSiteLocation(data.site_location || '');
      Alert.alert('✅ Synced', 'Profile data refreshed from cloud.');
    } catch (err: any) {
      Alert.alert('Sync Failed', err.message);
    }
  }, []);

  const uploadProfile = useCallback(async () => {
    setProfileSaving(true);
    try {
      await updateProfile({
        display_name: displayName.trim() || undefined,
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        site_location: siteLocation.trim() || null,
      });
      Alert.alert('✅ Uploaded', 'Profile updated in cloud successfully.');
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message);
    } finally {
      setProfileSaving(false);
    }
  }, [displayName, contactName, contactPhone, siteLocation]);

  // ─── Password Upload ────────────────────────────────────────────────────────
  const uploadPassword = useCallback(async () => {
    if (!currentPwd || !newPwd) {
      Alert.alert('Validation', 'Please fill in current and new password fields.');
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }
    setPwdSaving(true);
    try {
      await changePassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      Alert.alert('✅ Updated', 'Password changed successfully.');
    } catch (err: any) {
      Alert.alert('Failed', err.response?.data?.detail || err.message);
    } finally {
      setPwdSaving(false);
    }
  }, [currentPwd, newPwd, confirmPwd]);

  // ─── Node Config Sync / Upload ──────────────────────────────────────────────
  const syncNodeConfigs = useCallback(async () => {
    try {
      const configs = await getNodes();
      setNodeConfigs(configs);
      if (configs.length > 0 && !selectedNodeId) {
        const first = configs[0];
        setSelectedNodeId(first.node_id);
        setNodePondType(first.pond_type || 'tilapia');
        setNodeName(first.name || '');
        setNodeLocation(first.location || '');
      }
      Alert.alert('✅ Synced', `Fetched ${configs.length} node configuration(s) from cloud.`);
    } catch (err: any) {
      Alert.alert('Sync Failed', err.message);
    }
  }, [selectedNodeId]);

  const uploadNodeConfig = useCallback(async () => {
    if (!selectedNodeId) {
      Alert.alert('No Node', 'Please sync first or select a node to configure.');
      return;
    }
    try {
      await updateNodeConfig(selectedNodeId, {
        name: nodeName.trim() || null,
        location: nodeLocation.trim() || null,
        pond_type: nodePondType,
      });
      Alert.alert('✅ Uploaded', `Node "${selectedNodeId}" configuration updated in cloud.`);
    } catch (err: any) {
      Alert.alert('Upload Failed', err.response?.data?.detail || err.message);
    }
  }, [selectedNodeId, nodeName, nodeLocation, nodePondType]);

  // ─── Logout ─────────────────────────────────────────────────────────────────
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
        <Text style={styles.subtitle}>App Configuration & Account Management</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* ── Account Info Card ─────────────────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>🔐 Master Node Account</Text>
          <View style={styles.profileBox}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>📡</Text>
            </View>
            <View style={styles.profileDetails}>
              <Text style={styles.usernameText}>
                {user?.displayName || user?.nodeCode || user?.username || 'Facility profile unavailable'}
              </Text>
              <Text style={styles.roleBadge}>
                Node Code: {user?.nodeCode || user?.username || 'Not available'} ({user?.role || 'master_node'})
              </Text>
            </View>
          </View>
        </View>

        {/* ── Profile Settings Card ──────────────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>👤 Profile Settings</Text>
          <Text style={styles.cardHint}>
            Update your facility display name, contact, and location details.
          </Text>

          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={styles.textInput}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="e.g. Mufassir's Aqua Farm"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Contact Name</Text>
          <TextInput
            style={styles.textInput}
            value={contactName}
            onChangeText={setContactName}
            placeholder="Facility manager name"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Contact Phone</Text>
          <TextInput
            style={styles.textInput}
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder="+94 77 123 4567"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Site Location</Text>
          <TextInput
            style={styles.textInput}
            value={siteLocation}
            onChangeText={setSiteLocation}
            placeholder="e.g. Negombo Lagoon, Sri Lanka"
            placeholderTextColor={colors.textMuted}
          />

          <SyncRow onSync={syncProfile} onUpload={uploadProfile} />
        </View>

        {/* ── Password Card ──────────────────────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>🔑 Change Password</Text>
          <Text style={styles.cardHint}>Upload a new password to the cloud backend.</Text>

          <Text style={styles.label}>Current Password</Text>
          <TextInput
            style={styles.textInput}
            value={currentPwd}
            onChangeText={setCurrentPwd}
            placeholder="Current password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />

          <Text style={styles.label}>New Password</Text>
          <TextInput
            style={styles.textInput}
            value={newPwd}
            onChangeText={setNewPwd}
            placeholder="New password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />

          <Text style={styles.label}>Confirm New Password</Text>
          <TextInput
            style={styles.textInput}
            value={confirmPwd}
            onChangeText={setConfirmPwd}
            placeholder="Repeat new password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
          />

          {/* Password has no sync (it's write-only) — only upload */}
          <View style={srStyles.row}>
            <TouchableOpacity
              style={[srStyles.btn, srStyles.uploadBtn, { flex: 1 }]}
              onPress={uploadPassword}
              disabled={pwdSaving}
            >
              {pwdSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={srStyles.uploadText}>⬆ Upload New Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Node Pond Configuration Card ───────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>🐟 Pond Node Configuration</Text>
          <Text style={styles.cardHint}>
            Assign pond species, name, and location to each node. Sync to pull current config; Upload to push your changes.
          </Text>

          {nodeConfigs.length > 0 ? (
            <>
              {/* Node Selector */}
              <Text style={styles.label}>Select Node</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nodeSelectorScroll}>
                {nodeConfigs.map((nc: any) => (
                  <TouchableOpacity
                    key={nc.node_id}
                    style={[
                      styles.nodePill,
                      selectedNodeId === nc.node_id && styles.nodePillActive,
                    ]}
                    onPress={() => {
                      setSelectedNodeId(nc.node_id);
                      setNodePondType(nc.pond_type || 'tilapia');
                      setNodeName(nc.name || '');
                      setNodeLocation(nc.location || '');
                    }}
                  >
                    <Text style={[
                      styles.nodePillText,
                      selectedNodeId === nc.node_id && styles.nodePillTextActive,
                    ]}>
                      {nc.node_id}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Node Name */}
              <Text style={styles.label}>Node Name</Text>
              <TextInput
                style={styles.textInput}
                value={nodeName}
                onChangeText={setNodeName}
                placeholder="e.g. Pond A – West Wing"
                placeholderTextColor={colors.textMuted}
              />

              {/* Node Location */}
              <Text style={styles.label}>Node Location</Text>
              <TextInput
                style={styles.textInput}
                value={nodeLocation}
                onChangeText={setNodeLocation}
                placeholder="e.g. Sector 3, Tank #2"
                placeholderTextColor={colors.textMuted}
              />

              {/* Pond Species Type */}
              <Text style={styles.label}>Pond Species / Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nodeSelectorScroll}>
                {POND_TYPES.map(pt => (
                  <TouchableOpacity
                    key={pt}
                    style={[styles.nodePill, nodePondType === pt && styles.nodePillActive]}
                    onPress={() => setNodePondType(pt)}
                  >
                    <Text style={[
                      styles.nodePillText,
                      nodePondType === pt && styles.nodePillTextActive,
                    ]}>
                      {pt.charAt(0).toUpperCase() + pt.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Threshold preview for selected species */}
              <View style={styles.thresholdPreview}>
                <Text style={styles.thresholdTitle}>
                  Default Thresholds for "{nodePondType}":
                </Text>
                {Object.entries(DEFAULT_POND_PROFILES[nodePondType]).map(([key, range]) => (
                  <View key={key} style={styles.thresholdRow}>
                    <Text style={styles.thresholdKey}>
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </Text>
                    <Text style={styles.thresholdVal}>
                      {(range as any).min} – {(range as any).max}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.emptyHint}>
              Tap "Sync from Cloud" to load your node configurations.
            </Text>
          )}

          <SyncRow
            onSync={syncNodeConfigs}
            onUpload={uploadNodeConfig}
            syncLabel="⬇ Sync Nodes"
            uploadLabel="⬆ Upload Config"
          />
        </View>

        {/* ── Backend Server Config Card ─────────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>🌐 Backend Server Configuration</Text>
          <Text style={styles.label}>API Base Endpoint URL</Text>
          <TextInput
            style={styles.textInput}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={colors.textMuted}
          />
          <Button
            title="Test Connection"
            variant="outline"
            onPress={handleTestConnection}
            loading={testingConnection}
            style={styles.testBtn}
          />
        </View>

        {/* ── Auto Refresh Preferences ───────────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>⏱ Telemetry Refresh Rate</Text>
          <Text style={styles.cardHint}>Select background telemetry auto-polling interval:</Text>
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

        {/* ── About ─────────────────────────────────────────────────────────── */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>ℹ️ About AquaLora Mobile</Text>
          {[
            ['App Version', 'v1.0.0 (Production Build)'],
            ['Framework', 'React Native / Expo SDK 57'],
            ['Security Level', 'SecureStore Keychain Encrypted'],
            ['Backend', 'FastAPI + PostgreSQL + LoRa IoT'],
          ].map(([label, val]) => (
            <View key={label} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{label}</Text>
              <Text style={styles.infoVal}>{val}</Text>
            </View>
          ))}
        </View>

        {/* ── Logout ────────────────────────────────────────────────────────── */}
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
    paddingBottom: spacing.xl * 2,
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
    marginBottom: spacing.xs,
  },
  cardHint: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  profileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
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
    marginBottom: 5,
    marginTop: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 4,
    height: 44,
    ...typography.body2,
    color: colors.textPrimary,
  },
  emptyHint: {
    ...typography.body2,
    color: colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  nodeSelectorScroll: {
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  nodePill: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
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
    fontWeight: '700',
    color: colors.textSecondary,
  },
  nodePillTextActive: {
    color: '#fff',
  },
  thresholdPreview: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thresholdTitle: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  thresholdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  thresholdKey: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  thresholdVal: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  testBtn: {
    marginTop: spacing.sm,
  },
  intervalRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
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
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: spacing.sm,
  },
  logoutBtn: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
});
