/**
 * The Firebase app on the web, with App Check (reCAPTCHA Enterprise, or a debug token in
 * development). Firebase AI Logic, Remote Config, Auth and Firestore all share this one app.
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

import { appCheckDebugToken, firebaseWebConfig, onDeviceOnly, recaptchaSiteKey } from '../config';

export const firebaseConfigured = !!firebaseWebConfig.apiKey && !!firebaseWebConfig.projectId;

let app: FirebaseApp | undefined;

export function firebaseApp(): FirebaseApp {
  if (app) return app;
  if (!firebaseConfigured) {
    throw new Error('Firebase is not configured. Copy .env.example to .env.local and fill it in (see README).');
  }
  app = getApps()[0] ?? initializeApp(firebaseWebConfig);
  if (appCheckDebugToken) {
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken;
  }
  if (recaptchaSiteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
  } else if (!onDeviceOnly) {
    // On-device-only (offline) mode never calls the cloud, so App Check is not needed there.
    console.warn('App Check is not initialized: set EXPO_PUBLIC_RECAPTCHA_SITE_KEY.');
  }
  return app;
}
