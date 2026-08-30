// src/shared/types.ts
// Shared type definitions for entire app

export interface User {
  username: string;
  role: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  username: string;
  role: string;
}

export interface Reading {
  id?: number;
  node_id: string;
  timestamp: string;
  temperature: number;
  turbidity: number;
  tds: number;
  ph: number;
  battery_pct?: number;
  rssi?: number;
  pond_type?: string;
  created_at?: string;
  synced_at?: string;
}

export interface Alert {
  id: number;
  node_id: string;
  timestamp: string;
  parameter: string; // "temperature", "turbidity", "tds", "ph"
  severity: 'normal' | 'warning' | 'critical';
  message: string;
  created_at?: string;
  synced_at?: string;
}

export interface SyncResponse<T> {
  received: number;
  stored: number;
  data?: T[];
}

export interface HistoryQueryParams {
  node_id?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface Node {
  id: string;
  name: string;
  location?: string;
  pond_type?: string;
  created_at?: string;
}

export interface AppError {
  code: string;
  message: string;
  details?: any;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export type SeverityLevel = 'normal' | 'warning' | 'critical';
