import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useEffect } from 'react';

import { AIProvider } from '../ai/AIContext';
import { initAlerts } from '../alerts/notifications';
import { loadRemoteConfig } from '../remote/remoteConfig';
import { useTheme } from '../ui/theme';

export default function RootLayout() {
  const theme = useTheme();
  // Activate Remote Config values once per launch; bundled defaults apply until (or unless) it does.
  useEffect(() => {
    void loadRemoteConfig();
  }, []);
  // Show notifications in the foreground, and open the app a tapped notification points at.
  useEffect(() => initAlerts((url) => router.push(url as never)), []);
  return (
    <AIProvider>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
          // Native screen transitions: pushes slide in from the side, settings rises as a sheet.
          animation: 'slide_from_right',
        }}
      >
        {/* Home and Settings, with the bottom bar. Apps open above it, full screen. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="app/[id]" options={{ title: '' }} />
        <Stack.Screen name="s/[id]" options={{ title: 'Shared app' }} />
      </Stack>
    </AIProvider>
  );
}
