// src/services/notificationService.ts
// Comprehensive push notification management for AquaLoRa mobile app

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiService } from './apiService';

// Configure foreground notification behavior: show alert, sound and badge
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

class NotificationService {
  private currentPushToken: string | null = null;

  /**
   * Request permissions, configure Android notification channel, and retrieve token
   */
  async registerForPushNotificationsAsync(): Promise<string | null> {
    if (!Device.isDevice) {
      console.log('Push notifications require a physical device');
      return null;
    }

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('Push notification permissions was not granted');
        return null;
      }

      // Android 8.0+ notification channel configuration
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('aqualora-alerts', {
          name: 'AquaLoRa Telemetry Alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#0284C7',
          sound: 'default',
          enableLights: true,
          enableVibrate: true,
          showBadge: true,
        });
      }

      // Retrieve Expo Push Token
      const tokenData = await Notifications.getExpoPushTokenAsync().catch(err => {
        console.warn('Could not retrieve push token:', err);
        return null;
      });

      const token = tokenData?.data;

      if (token) {
        this.currentPushToken = token;
        await this.syncTokenWithBackend(token);
        return token;
      }
      return null;
    } catch (error) {
      console.error('Error during push registration:', error);
      return null;
    }
  }

  /**
   * Sync push token to cloud backend for current authenticated master node
   */
  async syncTokenWithBackend(token: string): Promise<void> {
    try {
      await apiService.post('/devices/register', {
        token,
        platform: Platform.OS,
        device_name: Device.modelName || 'Android Device',
      });
      console.log('Device push token successfully registered with cloud backend');
    } catch (error) {
      console.warn('Could not register device token with backend:', error);
    }
  }

  /**
   * Unregister token on logout
   */
  async unregisterDeviceToken(): Promise<void> {
    if (!this.currentPushToken) return;
    try {
      await apiService.post('/devices/unregister', {
        token: this.currentPushToken,
        platform: Platform.OS,
      });
      this.currentPushToken = null;
    } catch (error) {
      console.warn('Failed to unregister device token:', error);
    }
  }

  /**
   * Add listener for incoming notifications in foreground
   */
  addNotificationReceivedListener(callback: (notification: Notifications.Notification) => void) {
    return Notifications.addNotificationReceivedListener(callback);
  }

  /**
   * Add listener for when user taps or interacts with notification
   */
  addNotificationResponseReceivedListener(callback: (response: Notifications.NotificationResponse) => void) {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }
}

export const notificationService = new NotificationService();
