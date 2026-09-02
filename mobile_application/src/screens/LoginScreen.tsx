// src/screens/LoginScreen.tsx
import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Modal,
  FlatList,
  ImageBackground,
  Image,
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { getDirectory, DirectoryNode } from '../services/authService';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Button } from '../components';

// Real branding assets from assets folder
const splashBg = require('../../assets/splash.jpg');
const appIcon = require('../../assets/Logo.png');

export const LoginScreen = () => {
  const [nodes, setNodes] = useState<DirectoryNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<DirectoryNode | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [isManual, setIsManual] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const { login } = useContext(AuthContext);

  const fetchDirectoryList = async () => {
    setLoadingDirectory(true);
    try {
      const list = await getDirectory();
      setNodes(list);
      if (list.length > 0 && !selectedNode) {
        setSelectedNode(list[0]);
      }
    } catch (err) {
      console.warn('[LoginScreen] Could not fetch node directory:', err);
      setIsManual(true);
    } finally {
      setLoadingDirectory(false);
    }
  };

  useEffect(() => {
    fetchDirectoryList();
  }, []);

  const handleLogin = async () => {
    const targetCode = isManual ? manualCode.trim() : selectedNode?.node_code?.trim();

    if (!targetCode) {
      setErrorMessage('Please select or enter a Master Node code.');
      return;
    }
    if (!password.trim()) {
      setErrorMessage('Please enter the Master Node password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await login(targetCode, password.trim());
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Login failed. Verify credentials and network connection.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ImageBackground source={splashBg} style={styles.bgImage} resizeMode="cover">
      {/* Dark overlay for readability */}
      <View style={styles.overlay} />

      <KeyboardAvoidingView
        style={styles.kbView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Branding Header */}
          <View style={styles.header}>
            <Image source={appIcon} style={styles.logoImage} resizeMode="contain" />
            <Text style={styles.title}>AquaLora</Text>
            <Text style={styles.subtitle}>Smart Aquaculture Telemetry & Pond Management</Text>
          </View>

          {/* Login Form Card */}
          <View style={[styles.card, shadows.medium]}>
            <Text style={styles.cardHeader}>Master Node Sign In</Text>
            <Text style={styles.cardSub}>Authenticate to view live pond metrics for your facility.</Text>

            {/* Error Banner */}
            {errorMessage ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>⚠️ {errorMessage}</Text>
              </View>
            ) : null}

            {/* Master Node Selection */}
            {!isManual && nodes.length > 0 ? (
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Facility Master Node</Text>
                  <TouchableOpacity onPress={fetchDirectoryList} disabled={loadingDirectory}>
                    <Text style={styles.linkText}>{loadingDirectory ? 'Refreshing…' : '🔄 Refresh'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.pickerTrigger}
                  onPress={() => setModalVisible(true)}
                >
                  <Text style={styles.inputIcon}>📡</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerTextPrimary}>
                      {selectedNode ? selectedNode.display_name : 'Select Master Node'}
                    </Text>
                    <Text style={styles.pickerTextSecondary}>
                      {selectedNode ? `Node Code: ${selectedNode.node_code}` : 'Tap to choose from active facilities'}
                    </Text>
                  </View>
                  <Text style={styles.chevronIcon}>▼</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setIsManual(true)} style={styles.subAction}>
                  <Text style={styles.linkText}>Enter node code manually</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.inputLabel}>Master Node Code</Text>
                  {nodes.length > 0 && (
                    <TouchableOpacity onPress={() => setIsManual(false)}>
                      <Text style={styles.linkText}>Choose from list</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.inputWrapper}>
                  <Text style={styles.inputIcon}>📡</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. AQL-0001"
                    placeholderTextColor={colors.textMuted}
                    value={manualCode}
                    onChangeText={(val) => setManualCode(val.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              </View>
            )}

            {/* Input: Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputIcon}>🔒</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Login Action Button */}
            <Button
              title="Sign In to Facility"
              onPress={handleLogin}
              loading={loading}
              size="large"
              style={styles.submitBtn}
            />
          </View>

          {/* Modal Node Picker */}
          <Modal visible={modalVisible} transparent animationType="slide">
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Your Master Node</Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <FlatList
                  data={nodes}
                  keyExtractor={(item) => item.node_code}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.nodeItem,
                        selectedNode?.node_code === item.node_code && styles.nodeItemSelected,
                      ]}
                      onPress={() => {
                        setSelectedNode(item);
                        setModalVisible(false);
                      }}
                    >
                      <Text style={styles.nodeItemName}>{item.display_name}</Text>
                      <Text style={styles.nodeItemCode}>Code: {item.node_code}</Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            </View>
          </Modal>

          {/* Footer */}
          <Text style={styles.footerText}>AquaLora Multi-Tenant Telemetry • Secure IoT System</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  bgImage: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 18, 31, 0.76)',
  },
  kbView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 26,
    marginBottom: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.82)',
    padding: 12,
    borderWidth: 2,
    borderColor: 'rgba(130, 205, 255, 0.7)',
    shadowColor: '#7BD7FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.38,
    shadowRadius: 18,
  },
  title: {
    ...typography.h1,
    color: '#F8FCFF',
    textAlign: 'center',
    marginBottom: 4,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    ...typography.body2,
    color: '#E3F4FF',
    textAlign: 'center',
    fontWeight: '600',
  },
  card: {
    backgroundColor: 'rgba(7, 22, 35, 0.86)',
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(143, 214, 255, 0.28)',
  },
  cardHeader: {
    ...typography.h2,
    marginBottom: spacing.xs,
    color: '#F4FBFF',
  },
  cardSub: {
    ...typography.body2,
    color: '#EAF7FF',
    marginBottom: spacing.md,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    padding: spacing.sm + 4,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    ...typography.caption,
    color: '#FCA5A5',
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    ...typography.label,
    color: 'rgba(233, 245, 255, 0.86)',
  },
  linkText: {
    ...typography.caption,
    color: '#9AD9FF',
    fontWeight: '600',
  },
  subAction: {
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13, 34, 52, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(124, 196, 255, 0.33)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  pickerTextPrimary: {
    ...typography.body1,
    fontWeight: '700',
    color: '#F8FBFF',
  },
  pickerTextSecondary: {
    ...typography.caption,
    color: '#DDEFFF',
    marginTop: 2,
    fontWeight: '600',
  },
  chevronIcon: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginLeft: spacing.sm,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 28, 42, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(124, 196, 255, 0.33)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 4,
    height: 48,
  },
  inputIcon: {
    marginRight: spacing.sm,
    fontSize: 16,
  },
  input: {
    flex: 1,
    ...typography.body1,
    fontSize: 15,
    color: '#F5FBFF',
    fontWeight: '600',
  },
  toggleText: {
    ...typography.caption,
    fontWeight: '700',
    color: '#9AD9FF',
    padding: 4,
  },
  submitBtn: {
    marginTop: spacing.sm,
  },
  footerText: {
    ...typography.caption,
    textAlign: 'center',
    color: 'rgba(228, 238, 248, 0.52)',
    marginTop: spacing.xl,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...typography.h2,
    fontSize: 18,
  },
  modalClose: {
    fontSize: 18,
    color: colors.textMuted,
    padding: 4,
  },
  nodeItem: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceAlt,
  },
  nodeItemSelected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  nodeItemName: {
    ...typography.body1,
    fontWeight: '600',
  },
  nodeItemCode: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
