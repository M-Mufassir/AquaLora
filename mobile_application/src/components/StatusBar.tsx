// src/components/StatusBar.tsx

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, borderRadius, spacing, typography } from '../theme';

interface StatusBarProps {
  isConnected: boolean;
  lastSynced: string;
  nodeId?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  isConnected,
  lastSynced,
  nodeId,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.leftGroup}>
        <View
          style={[
            styles.dot,
            { backgroundColor: isConnected ? colors.success : colors.error },
          ]}
        />
        <Text style={styles.statusText}>
          {isConnected ? 'Connected' : 'Offline Mode'}
        </Text>
      </View>

      {nodeId ? (
        <View style={styles.nodeBadge}>
          <Text style={styles.nodeText}>Node: {nodeId}</Text>
        </View>
      ) : null}

      <Text style={styles.syncText}>Synced: {lastSynced}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.text,
  },
  nodeBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
  },
  nodeText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
    fontSize: 11,
  },
  syncText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
