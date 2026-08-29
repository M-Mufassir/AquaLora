import React, { useEffect, useState, useContext } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList } from 'react-native';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { AuthContext } from '../context/AuthContext';

type Alert = {
  id: string;
  node_id: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
};

export const AlertsScreen = () => {
  const { token, loading: authLoading } = useContext(AuthContext);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    const fetchAlerts = async () => {
      try {
        const res = await axios.get<Alert[]>(`${API_BASE_URL}/alerts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setAlerts(res.data);
      } catch (e) {
        console.error('Failed to fetch alerts', e);
      } finally {
        setLoading(false);
      }
    };
    fetchAlerts();
  }, [token, authLoading]);

  if (authLoading || loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Alerts</Text>
      {alerts.length === 0 ? (
        <Text style={styles.empty}>No alerts at the moment.</Text>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={[styles.item, severityStyle(item.severity)]}>
              <Text style={styles.itemMessage}>{item.message}</Text>
              <Text style={styles.itemMeta}>Node: {item.node_id} • {new Date(item.timestamp).toLocaleString()}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
};

const severityStyle = (severity: string) => {
  switch (severity) {
    case 'high':
      return { backgroundColor: '#ffeded', borderColor: '#ff4d4f' };
    case 'medium':
      return { backgroundColor: '#fff4e5', borderColor: '#ffa940' };
    default:
      return { backgroundColor: '#f6ffed', borderColor: '#52c41a' };
  }
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { textAlign: 'center', marginTop: 20, color: '#777' },
  item: { padding: 12, marginVertical: 6, borderRadius: 8, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.05, elevation: 2 },
  itemMessage: { fontSize: 16, fontWeight: '600' },
  itemMeta: { fontSize: 12, color: '#555', marginTop: 4 },
});
