// src/screens/MasterNodeProfileScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getProfile, updateProfile, changePassword } from '../services/authService';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Button } from '../components';

export const MasterNodeProfileScreen = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nodeData, setNodeData] = useState<any>(null);

  // Editable fields
  const [displayName, setDisplayName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [siteLocation, setSiteLocation] = useState('');
  const [pondType, setPondType] = useState('tilapia');

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const data = await getProfile();
      setNodeData(data);
      setDisplayName(data.display_name || '');
      setContactName(data.contact_name || '');
      setContactPhone(data.contact_phone || '');
      setSiteLocation(data.site_location || '');
      setPondType(data.pond_type || 'tilapia');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to fetch Master Node profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      Alert.alert('Validation Error', 'Display name is required.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({
        display_name: displayName.trim(),
        contact_name: contactName.trim() || null,
        contact_phone: contactPhone.trim() || null,
        site_location: siteLocation.trim() || null,
        pond_type: pondType,
      });
      setNodeData(updated);
      Alert.alert('Success', 'Master Node profile updated successfully.');
    } catch (err: any) {
      Alert.alert('Update Failed', err.response?.data?.detail || err.message || 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      Alert.alert('Validation Error', 'Please enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Validation Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation Error', 'New passwords do not match.');
      return;
    }

    setUpdatingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      Alert.alert('Success', 'Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      Alert.alert('Password Change Failed', err.response?.data?.detail || err.message || 'Could not change password.');
    } finally {
      setUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading facility profile…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header Info */}
      <View style={[styles.headerCard, shadows.small]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.nodeCode}>{nodeData?.node_code}</Text>
            <Text style={styles.headerSubtitle}>{nodeData?.display_name}</Text>
          </View>
          <View style={styles.badgeContainer}>
            <View style={[styles.badge, { backgroundColor: colors.successLight }]}>
              <Text style={[styles.badgeText, { color: colors.success }]}>
                ● {nodeData?.status?.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Facility Profile Form */}
      <View style={[styles.card, shadows.medium]}>
        <Text style={styles.sectionTitle}>Facility Configuration</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Display / Farm Name</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="e.g. Green Valley Farm"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Contact Person</Text>
          <TextInput
            style={styles.input}
            value={contactName}
            onChangeText={setContactName}
            placeholder="e.g. John Doe"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Contact Phone</Text>
          <TextInput
            style={styles.input}
            value={contactPhone}
            onChangeText={setContactPhone}
            placeholder="e.g. +94 77 123 4567"
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Site Location</Text>
          <TextInput
            style={styles.input}
            value={siteLocation}
            onChangeText={setSiteLocation}
            placeholder="e.g. Negombo Lagoon - Sector 3"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Primary Pond Species</Text>
          <View style={styles.speciesRow}>
            {['tilapia', 'prawn', 'catfish', 'tuna', 'salmon'].map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.speciesChip,
                  pondType === type && styles.speciesChipActive,
                ]}
                onPress={() => setPondType(type)}
              >
                <Text
                  style={[
                    styles.speciesChipText,
                    pondType === type && styles.speciesChipTextActive,
                  ]}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Button
          title="Save Facility Profile"
          onPress={handleSaveProfile}
          loading={saving}
          style={styles.saveBtn}
        />
      </View>

      {/* Change Password Card */}
      <View style={[styles.card, shadows.medium, { marginTop: spacing.md }]}>
        <Text style={styles.sectionTitle}>Change Master Node Password</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Current Password</Text>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Enter current password"
            secureTextEntry
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>New Password</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Min 6 characters"
            secureTextEntry
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Confirm New Password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repeat new password"
            secureTextEntry
          />
        </View>

        <Button
          title="Update Password"
          onPress={handleChangePassword}
          loading={updatingPassword}
          variant="outline"
          style={styles.saveBtn}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    ...typography.body2,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  headerCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nodeCode: {
    ...typography.h2,
    color: colors.primaryDark,
  },
  headerSubtitle: {
    ...typography.body2,
    color: colors.textSecondary,
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    marginBottom: spacing.md,
    color: colors.textPrimary,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    ...typography.body1,
  },
  speciesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  speciesChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speciesChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  speciesChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  speciesChipTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  saveBtn: {
    marginTop: spacing.sm,
  },
});
