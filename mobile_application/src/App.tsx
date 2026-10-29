import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './context/AuthContext';
import RootNavigator from './navigation';
import { notificationService } from './services/notificationService';

export default function App() {
  useEffect(() => {
    const receivedSub = notificationService.addNotificationReceivedListener(notification => {
      console.log('Push notification received:', notification.request.content);
    });

    const responseSub = notificationService.addNotificationResponseReceivedListener(response => {
      console.log('User interacted with push notification:', response.notification.request.content);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent={false} />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
