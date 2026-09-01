// src/services/authService.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../config';

export interface BackendLoginResponse {
  access_token?: string;
  token?: string;
  token_type?: string;
  node_code?: string;
  username?: string;
  display_name?: string;
  role?: string;
  master_node_id?: number;
}

export interface AuthResponse {
  token: string;
  nodeCode: string;
  displayName: string;
  role: string;
  masterNodeId: number;
}

export interface DirectoryNode {
  node_code: string;
  display_name: string;
}

export async function getDirectory(): Promise<DirectoryNode[]> {
  const response = await axios.get(`${API_BASE_URL}/master-nodes/directory`, { timeout: 6000 });
  return response.data as DirectoryNode[];
}

export async function login(nodeCode: string, password: string): Promise<AuthResponse> {
  const response = await axios.post(
    `${API_BASE_URL}/auth/login`,
    { node_code: nodeCode.trim(), password },
    { timeout: 8000 }
  );
  const rawData = response.data as BackendLoginResponse;

  const token = rawData.access_token || rawData.token || '';
  const node = rawData.node_code || rawData.username || nodeCode;
  const displayName = rawData.display_name || node;
  const role = rawData.role || 'customer';
  const masterNodeId = rawData.master_node_id || 1;

  if (!token) {
    throw new Error('Authentication failed: No access token received from server.');
  }

  const authResponse: AuthResponse = {
    token,
    nodeCode: node,
    displayName,
    role,
    masterNodeId,
  };

  await SecureStore.setItemAsync('authToken', token);
  await SecureStore.setItemAsync(
    'authUser',
    JSON.stringify({
      username: node,
      nodeCode: node,
      displayName,
      role,
      masterNodeId,
    })
  );

  return authResponse;
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

export async function getProfile(): Promise<any> {
  const { token } = await getStoredAuth();
  const response = await axios.get(`${API_BASE_URL}/master-nodes/me`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 8000,
  });
  return response.data;
}

export async function updateProfile(payload: {
  display_name?: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  site_location?: string | null;
  pond_type?: string | null;
}): Promise<any> {
  const { token } = await getStoredAuth();
  const response = await axios.patch(`${API_BASE_URL}/master-nodes/me`, payload, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 8000,
  });
  return response.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<any> {
  const { token } = await getStoredAuth();
  const response = await axios.post(
    `${API_BASE_URL}/auth/change-password`,
    { current_password: currentPassword, new_password: newPassword },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    }
  );
  return response.data;
}

export async function getNodes(): Promise<any[]> {
  const { token } = await getStoredAuth();
  const response = await axios.get(`${API_BASE_URL}/nodes`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 8000,
  });
  return response.data;
}

export async function updateNodeConfig(
  nodeId: string,
  payload: {
    name?: string | null;
    location?: string | null;
    pond_type?: string;
    custom_profile?: object | null;
  }
): Promise<any> {
  const { token } = await getStoredAuth();
  const response = await axios.patch(
    `${API_BASE_URL}/nodes/${encodeURIComponent(nodeId)}`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    }
  );
  return response.data;
}

