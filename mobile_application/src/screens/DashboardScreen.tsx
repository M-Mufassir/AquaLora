import React, { useEffect, useState, useContext } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { AuthContext } from '../context/AuthContext';

type Reading = {
  node_id: string;
  timestamp: string;
  temperature: number;
  turbidity: number;
  tds: number;
  ph: number;
  battery_pct: number;
  rssi: number;
};

export const DashboardScreen = () => {
  const { token, loading: authLoading } = useContext(AuthContext);
  const [reading, setReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return; // wait for auth state
    const fetchLatest = async () => {
      try {
        const res = await axios.get<Reading>(`${API_BASE_URL}/readings/latest`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setReading(res.data);
      } catch (e) {
        console.error('Failed to fetch latest reading', e);
      } finally {
        setLoading(false);
      }
    };
    fetchLatest();
  }, [token, authLoading]);

  if (authLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!reading) {
    return (
      <View style={styles.center}>
        <Text>No reading data available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Latest Sensor Readings</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Node:</Text>
        <Text style={styles.value}>{reading.node_id}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Temperature:</Text>
        <Text style={styles.value}>{reading.temperature} °C</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Turbidity:</Text>
        <Text style={styles.value}>{reading.turbidity} NTU</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>TDS:</Text>
        <Text style={styles.value}>{reading.tds} ppm</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>pH:</Text>
        <Text style={styles.value}>{reading.ph}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Battery:</Text>
        <Text style={styles.value}>{reading.battery_pct}%</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>RSSI:</Text>
        <Text style={styles.value}>{reading.rssi} dBm</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f5f5f5', flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  label: { fontSize: 14, color: '#555' },
  value: { fontSize: 18, fontWeight: '600', color: '#222' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
