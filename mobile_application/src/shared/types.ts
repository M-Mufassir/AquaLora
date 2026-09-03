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
  temperature: number | null;
  turbidity: number | null;
  tds: number | null;
  ph: number | null;
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

// ─── Node Configuration & Pond Threshold Profiles ────────────────────────────

export interface ThresholdRange {
  min: number;
  max: number;
}

export interface PondThresholdProfile {
  temperature: ThresholdRange;
  turbidity: ThresholdRange;
  tds: ThresholdRange;
  ph: ThresholdRange;
}

export type PondType = 'tilapia' | 'prawn' | 'catfish' | 'tuna' | 'salmon' | 'general';

export const DEFAULT_POND_PROFILES: Record<PondType, PondThresholdProfile> = {
  tilapia: {
    temperature: { min: 20, max: 30 },
    turbidity: { min: 0, max: 5 },
    tds: { min: 200, max: 800 },
    ph: { min: 6.5, max: 8.5 },
  },
  prawn: {
    temperature: { min: 24, max: 30 },
    turbidity: { min: 0, max: 3 },
    tds: { min: 500, max: 1200 },
    ph: { min: 7.2, max: 8.5 },
  },
  catfish: {
    temperature: { min: 22, max: 32 },
    turbidity: { min: 0, max: 8 },
    tds: { min: 150, max: 700 },
    ph: { min: 6.0, max: 8.5 },
  },
  tuna: {
    temperature: { min: 18, max: 28 },
    turbidity: { min: 0, max: 2 },
    tds: { min: 30000, max: 40000 },
    ph: { min: 7.8, max: 8.3 },
  },
  salmon: {
    temperature: { min: 10, max: 18 },
    turbidity: { min: 0, max: 3 },
    tds: { min: 200, max: 600 },
    ph: { min: 6.5, max: 8.0 },
  },
  general: {
    temperature: { min: 18, max: 32 },
    turbidity: { min: 0, max: 10 },
    tds: { min: 0, max: 1200 },
    ph: { min: 4.0, max: 10.0 },
  },
};

export interface NodeConfig {
  id: number;
  master_node_id: number;
  node_id: string;
  name: string | null;
  location: string | null;
  pond_type: PondType;
  custom_profile: PondThresholdProfile | null;
  updated_at: string | null;
}

export function getEffectiveProfile(config?: NodeConfig | null): PondThresholdProfile {
  if (config?.custom_profile) return config.custom_profile;
  const pt = (config?.pond_type || 'tilapia') as PondType;
  return DEFAULT_POND_PROFILES[pt] || DEFAULT_POND_PROFILES.general;
}

