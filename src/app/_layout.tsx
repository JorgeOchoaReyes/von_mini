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
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'von mini' }} />
        <Stack.Screen name="app/[id]" options={{ title: '' }} />
      </Stack>
    </AIProvider>
  );
}
