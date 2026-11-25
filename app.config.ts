/// <reference types="node" />
import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// google-services.json is project-specific and kept out of git (see README). On EAS Build it
// comes from the GOOGLE_SERVICES_JSON file environment variable instead.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);

/**
 * The EAS project this app belongs to (expo.dev/accounts/jorgeochoareyes/projects/von-mini). Not a
 * secret. Over-the-air updates are configured from it; EAS_PROJECT_ID overrides it, e.g. for a fork.
 */
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID ?? '24c573fb-3d3d-41ae-9c42-c97c7c6d85f1';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'von mini',
  slug: 'von-mini',
  owner: 'jorgeochoareyes',
  scheme: 'vonmini',
  version: '0.2.0',
  orientation: 'portrait',
  // OTA updates only reach builds whose native code matches. The fingerprint changes whenever
  // native code or config changes (a new native module, a plugin), so a JS-only update is
  // never delivered to an APK that can't run it.
  runtimeVersion: { policy: 'fingerprint' },
  ...(EAS_PROJECT_ID
    ? {
        updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 },
        extra: { ...config.extra, eas: { projectId: EAS_PROJECT_ID } },
      }
    : {}),
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: true, bundleIdentifier: 'app.vonmini' },
  android: {
    package: 'app.vonmini',
    googleServicesFile,
    adaptiveIcon: {
      backgroundColor: '#FFD21F',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png', output: 'single' },
  plugins: [
    'expo-router',
    'expo-status-bar',
    // Gemini Nano on Android (AICore / ML Kit GenAI) requires API 26+.
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    // Voice chat: microphone + speech recognition permissions, and visibility of the speech
    // services (Android System Intelligence hosts the on-device recognizer).
    [
      'expo-speech-recognition',
      {
        microphonePermission: 'von mini listens when you tap the microphone, so you can talk to your apps.',
        speechRecognitionPermission: 'Speech is turned into text on your device so you can talk to your apps.',
        androidSpeechServicePackages: ['com.google.android.as', 'com.google.android.googlequicksearchbox'],
      },
    ],
    // Launch screen: the logo on the app's background colour, light and dark.
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#FBF5E2',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#0E1430' },
      },
    ],
    // Local notifications: app reminders and "your app is ready". Only local ones are used, so
    // iOS doesn't need the push entitlement.
    [
      'expo-notifications',
      { icon: './assets/notification-icon.png', color: '#E8322C', enableRemoteNotifications: false },
    ],
  ],
  experiments: { typedRoutes: true },
});
