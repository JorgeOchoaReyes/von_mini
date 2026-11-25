/// <reference types="node" />
import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// google-services.json is project-specific and kept out of git (see README).
const googleServicesFile = existsSync('./google-services.json') ? './google-services.json' : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'von mini',
  slug: 'von-mini',
  scheme: 'vonmini',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: true, bundleIdentifier: 'app.vonmini' },
  android: {
    package: 'app.vonmini',
    googleServicesFile,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
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
  ],
  experiments: { typedRoutes: true },
});
