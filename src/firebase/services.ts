/**
 * Firebase Authentication and Cloud Firestore, created lazily: nothing is initialised (and nothing
 * leaves the device) until the user chooses to share an app or opens a shared link.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as authSdk from 'firebase/auth';
import { connectAuthEmulator, getAuth, initializeAuth, signInAnonymously, type Auth, type Persistence, type User } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

import { firebaseApp } from './app';

/**
 * Development only: `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1` points Auth and Firestore at
 * the local Firebase emulators (auth 9099, firestore 8085; see firebase.json) instead of the project.
 */
const EMULATOR_HOST = __DEV__ ? (process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? '') : '';

let auth: Auth | undefined;
let db: Firestore | undefined;

function getAuthInstance(): Auth {
  if (auth) return auth;
  const app = firebaseApp();
  if (Platform.OS === 'web') {
    auth = getAuth(app);
  } else {
    // React Native: keep the anonymous identity across launches so a shared app can be updated
    // later. The RN build of firebase/auth exports getReactNativePersistence; the browser typings
    // don't, so look it up at runtime and fall back to in-memory persistence.
    const rnPersistence = (authSdk as unknown as { getReactNativePersistence?: (s: typeof AsyncStorage) => Persistence })
      .getReactNativePersistence;
    try {
      auth = rnPersistence ? initializeAuth(app, { persistence: rnPersistence(AsyncStorage) }) : getAuth(app);
    } catch {
      auth = getAuth(app); // already initialised (e.g. fast refresh)
    }
  }
  if (EMULATOR_HOST) connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  return auth;
}

/** Signs in anonymously on first use: sharing needs an owner, never an account. */
export async function currentUser(): Promise<User> {
  const a = getAuthInstance();
  if (a.currentUser) return a.currentUser;
  await (a as Auth & { authStateReady?: () => Promise<void> }).authStateReady?.();
  return a.currentUser ?? (await signInAnonymously(a)).user;
}

export function firestore(): Firestore {
  if (db) return db;
  const app = firebaseApp();
  // React Native has no WebChannel streaming; long polling is the reliable transport there.
  db = Platform.OS === 'web' ? getFirestore(app) : initializeFirestore(app, { experimentalForceLongPolling: true });
  if (EMULATOR_HOST) connectFirestoreEmulator(db, EMULATOR_HOST, 8085);
  return db;
}
