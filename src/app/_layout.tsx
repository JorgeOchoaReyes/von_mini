import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AIProvider } from '../ai/AIContext';
import { useTheme } from '../ui/theme';

export default function RootLayout() {
  const theme = useTheme();
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
        <Stack.Screen name="index" options={{ title: 'von mini' }} />
        <Stack.Screen name="app/[id]" options={{ title: '' }} />
        <Stack.Screen name="settings" options={{ title: 'AI settings', presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </AIProvider>
  );
}
