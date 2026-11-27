import { Bangers_400Regular, useFonts } from '@expo-google-fonts/bangers';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { useEffect } from 'react';

import { AIProvider } from '../ai/AIContext';
import { initAlerts } from '../alerts/notifications';
import { installCrashCatcher, reportPreviousCrash } from '../diagnostics/crashNotes';
import { installEvalHook } from '../dev/evalHook';
import { loadRemoteConfig } from '../remote/remoteConfig';
import { loadSchemePref, useTheme } from '../ui/theme';

// Keep the splash screen up until the comic display font has loaded, so headlines never flash in
// the system font.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Home (the tabs) always sits under any screen, so a link opened while the app was closed (a
 * shared app, a notification) still has somewhere to go back to.
 */
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const theme = useTheme();
  const [fontsLoaded, fontError] = useFonts({ Bangers_400Regular });
  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded, fontError]);
  // Activate Remote Config values once per launch; bundled defaults apply until (or unless) it does.
  useEffect(() => {
    installCrashCatcher();
    void reportPreviousCrash();
    void loadRemoteConfig();
    void loadSchemePref();
    installEvalHook();
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
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
      </Stack>
    </AIProvider>
  );
}
