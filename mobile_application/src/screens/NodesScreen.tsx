import React, { useEffect, useState, useContext } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList } from 'react-native';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { AuthContext } from '../context/AuthContext';

type Node = {
  id: string;
  name: string;
  location?: string;
};

export const NodesScreen = () => {
  const { token, loading: authLoading } = useContext(AuthContext);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    const fetchNodes = async () => {
      try {
        const res = await axios.get<Node[]>(`${API_BASE_URL}/nodes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setNodes(res.data);
      } catch (e) {
        console.error('Failed to fetch nodes', e);
      } finally {
        setLoading(false);
      }
    };
    fetchNodes();
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
      <Text style={styles.title}>Sensor Nodes</Text>
      {nodes.length === 0 ? (
        <Text style={styles.empty}>No nodes available.</Text>
      ) : (
        <FlatList
          data={nodes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text style={styles.itemTitle}>{item.name}</Text>
              {item.location && <Text style={styles.itemSubtitle}>{item.location}</Text>}
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { textAlign: 'center', marginTop: 20, color: '#777' },
  item: { backgroundColor: '#fff', padding: 12, marginVertical: 6, borderRadius: 8, shadowColor: '#000', shadowOpacity: 0.05, elevation: 2 },
  itemTitle: { fontSize: 18, fontWeight: '600' },
  itemSubtitle: { fontSize: 14, color: '#555' },
});
