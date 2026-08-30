// src/screens/LoginScreen.tsx
import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { AuthContext } from '../context/AuthContext';
import { colors, borderRadius, spacing, typography, shadows } from '../theme';
import { Button } from '../components';

export const LoginScreen = () => {
  const [username, setUsername] = useState('Admin');
  const [password, setPassword] = useState('Admin123');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { login } = useContext(AuthContext);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await login(username.trim(), password.trim());
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please verify credentials and backend connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Branding Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>💧</Text>
          </View>
          <Text style={styles.title}>AquaLora</Text>
          <Text style={styles.subtitle}>Smart Aquaculture & Water Quality System</Text>
        </View>

        {/* Login Form Card */}
        <View style={[styles.card, shadows.medium]}>
          <Text style={styles.cardHeader}>Sign In</Text>
          <Text style={styles.cardSub}>Enter your credentials to access live pond telemetry.</Text>

          {/* Error Banner */}
          {errorMessage ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>⚠️ {errorMessage}</Text>
            </View>
          ) : null}

          {/* Input: Username */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Username</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>👤</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter username"
                placeholderTextColor={colors.textMuted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

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
            title="Sign In to Dashboard"
            onPress={handleLogin}
            loading={loading}
            size="large"
            style={styles.submitBtn}
          />

          {/* Quick Demo Hint */}
          <View style={styles.hintBox}>
            <Text style={styles.hintTitle}>Default Credentials:</Text>
            <Text style={styles.hintText}>Username: Admin  |  Password: Admin123</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footerText}>AquaLora Mobile Telemetry v1.0 • Secure IoT System</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  logoEmoji: {
    fontSize: 36,
  },
  title: {
    ...typography.h1,
    color: colors.primaryDark,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  cardHeader: {
    ...typography.h2,
    marginBottom: spacing.xs,
  },
  cardSub: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  errorBanner: {
    backgroundColor: colors.errorLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
    padding: spacing.sm + 4,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
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
  },
  toggleText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primary,
    padding: 4,
  },
  submitBtn: {
    marginTop: spacing.sm,
  },
  hintBox: {
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  hintTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  hintText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  footerText: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: spacing.xl,
  },
});
