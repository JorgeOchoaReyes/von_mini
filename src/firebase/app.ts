/**
 * The JS Firebase app on Android, used for Auth and Firestore (app sharing). Firebase AI Logic,
 * App Check and Remote Config run in the native SDK instead (modules/nano-bridge), because they
 * need on-device inference, the Android App Check provider, and IndexedDB respectively.
 */
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';

import { firebaseWebConfig } from '../config';

export const firebaseConfigured = !!firebaseWebConfig.apiKey && !!firebaseWebConfig.projectId;

export function firebaseApp(): FirebaseApp {
  if (!firebaseConfigured) {
    throw new Error('Firebase is not configured. Fill in the EXPO_PUBLIC_FIREBASE_* values (see README).');
  }
  return getApps()[0] ?? initializeApp(firebaseWebConfig);
}
