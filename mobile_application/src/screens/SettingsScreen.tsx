import React, { useContext } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { AuthContext } from '../context/AuthContext';

export const SettingsScreen = () => {
  const { logout } = useContext(AuthContext);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Button title="Logout" onPress={handleLogout} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  title: { fontSize: 24, marginBottom: 20 },
});
