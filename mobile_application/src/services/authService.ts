// src/services/authService.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../config';

export interface AuthResponse {
  token: string; // assuming backend returns a JWT token
  username: string;
  role: string;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const response = await axios.post(`${API_BASE_URL}/auth/login`, { username, password });
  const data = response.data as AuthResponse;
  // persist token securely
  await SecureStore.setItemAsync('authToken', data.token);
  await SecureStore.setItemAsync('authUser', JSON.stringify({ username: data.username, role: data.role }));
  return data;
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
