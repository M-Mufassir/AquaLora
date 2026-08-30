// src/services/cacheService.ts
// Offline caching service using AsyncStorage

import AsyncStorage from '@react-native-async-storage/async-storage';

export const CACHE_KEYS = {
  READINGS: '@aqualora_cache_readings',
  ALERTS: '@aqualora_cache_alerts',
  HISTORY: '@aqualora_cache_history',
};

export async function saveCache<T>(key: string, data: T): Promise<void> {
  try {
    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      data,
    });
    await AsyncStorage.setItem(key, payload);
  } catch (error) {
    console.warn('[CacheService] Failed to save cache:', key, error);
  }
}

export async function getCache<T>(key: string): Promise<{ data: T; timestamp: string } | null> {
  try {
    const json = await AsyncStorage.getItem(key);
    if (!json) return null;
    const parsed = JSON.parse(json);
    return {
      data: parsed.data as T,
      timestamp: parsed.timestamp || new Date().toISOString(),
    };
  } catch (error) {
    console.warn('[CacheService] Failed to read cache:', key, error);
    return null;
  }
}

export async function clearCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn('[CacheService] Failed to clear cache:', key, error);
  }
}
