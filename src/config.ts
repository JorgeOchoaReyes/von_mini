/**
 * Runtime configuration. Values come from EXPO_PUBLIC_* env vars (see .env.example).
 * The Firebase web config identifies the project; it is not a secret, but it is kept out of git.
 */
export const firebaseWebConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** reCAPTCHA Enterprise site key for App Check on web. */
export const recaptchaSiteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY ?? '';

/** App Check debug token for web development (register it in the Firebase console). */
export const appCheckDebugToken = process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN ?? '';

/** Offline mode: when true, every AI call runs on-device only and the cloud is never used. */
export const onDeviceOnly = process.env.EXPO_PUBLIC_ON_DEVICE_ONLY === 'true';

/** Cloud model used when Firebase AI Logic runs in the cloud. */
export const cloudModel = process.env.EXPO_PUBLIC_CLOUD_MODEL ?? 'gemini-3.8-flash';
