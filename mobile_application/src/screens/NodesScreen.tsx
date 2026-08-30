// src/screens/NodesScreen.tsx

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography } from '../theme';

export const NodesScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pond Nodes Overview</Text>
      <Text style={styles.sub}>Node telemetry & selector are integrated into the main Dashboard tab.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 20,
  },
  title: {
    ...typography.h2,
    marginBottom: 8,
  },
  sub: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
