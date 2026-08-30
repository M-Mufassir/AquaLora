// src/services/authService.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../config';

export interface BackendLoginResponse {
  access_token?: string;
  token?: string;
  token_type?: string;
  username?: string;
  role?: string;
}

export interface AuthResponse {
  token: string;
  username: string;
  role: string;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  try {
    const response = await axios.post(`${API_BASE_URL}/auth/login`, { username, password }, { timeout: 5000 });
    const rawData = response.data as BackendLoginResponse;

    const token = rawData.access_token || rawData.token || '';
    const user = rawData.username || username;
    const role = rawData.role || (username.toLowerCase() === 'admin' ? 'Administrator' : 'Operator');

    if (!token) {
      throw new Error('Authentication failed: No access token received from server.');
    }

    const authResponse: AuthResponse = {
      token,
      username: user,
      role,
    };

    await SecureStore.setItemAsync('authToken', token);
    await SecureStore.setItemAsync('authUser', JSON.stringify({ username: user, role }));

    return authResponse;
  } catch (err: any) {
    // Offline mode authentication fallback
    if (!err.response) {
      console.warn('[authService] Backend offline, attempting offline fallback authentication.');
      if (username.trim().toLowerCase() === 'admin' && password === 'Admin123') {
        const offlineToken = 'offline-session-token-admin';
        const user = 'Admin';
        const role = 'Administrator (Offline)';

        const authResponse: AuthResponse = {
          token: offlineToken,
          username: user,
          role,
        };

        await SecureStore.setItemAsync('authToken', offlineToken);
        await SecureStore.setItemAsync('authUser', JSON.stringify({ username: user, role }));

        return authResponse;
      }
    }
    throw err;
  }
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync('authToken');
  await SecureStore.deleteItemAsync('authUser');
}

export async function getStoredAuth(): Promise<{ token: string | null; user: any | null }> {
  const token = await SecureStore.getItemAsync('authToken');
  const userStr = await SecureStore.getItemAsync('authUser');
  const user = userStr ? JSON.parse(userStr) : null;
  return { token, user };
}
