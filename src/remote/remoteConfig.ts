/**
 * Firebase Remote Config: knobs that can be turned from the Firebase console without shipping a
 * build or an OTA update.
 *
 * Every value has a bundled default, so the app behaves identically offline, before the first
 * fetch, or with no Firebase project at all. Fetched values are cached by the SDK and activated
 * at startup; the fetch is throttled to once an hour.
 *
 *   cloud_model        Gemini model used when Firebase AI Logic runs in the cloud
 *   cloud_model_fallback  model to retry on when cloud_model's quota is used up
 *   html_model         Gemini model that writes apps and games as HTML (code needs a stronger model)
 *   build_mode         how new apps are designed: prefer_in_cloud (default) or prefer_on_device
 *   spec_rules_extra   extra design rules appended to the app-designer prompt
 *   voice_input        "false" hides speech input (a kill switch if recognition misbehaves)
 *   sharing            "false" hides app sharing
 *   build_as_code      "false" keeps new apps as blocks only (a kill switch for HTML apps)
 */
import { useSyncExternalStore } from 'react';

import { cloudModel } from '../config';
import { fetchRemoteValues } from './fetchRemote';

export const RC_DEFAULTS = {
  cloud_model: cloudModel,
  // Used when cloud_model's quota is exhausted (each model has its own free-tier daily quota).
  cloud_model_fallback: 'gemini-3.8-flash',
  // Writing a whole app or game in code is the hardest job: it gets a stronger model than chat.
  html_model: 'gemini-3.8-flash',
  build_mode: 'prefer_in_cloud',
  spec_rules_extra: '',
  voice_input: 'true',
  sharing: 'true',
  // Development override (tests drive the blocks): EXPO_PUBLIC_BUILD_AS_CODE=false.
  build_as_code: process.env.EXPO_PUBLIC_BUILD_AS_CODE === 'false' ? 'false' : 'true',
};
export type RcKey = keyof typeof RC_DEFAULTS;

let values: Record<RcKey, string> = { ...RC_DEFAULTS };
let status: 'defaults' | 'remote' | 'cached' = 'defaults';
let version = 0;
const listeners = new Set<() => void>();

export const rcString = (k: RcKey): string => values[k] ?? RC_DEFAULTS[k];
export const rcBool = (k: RcKey): boolean => rcString(k).trim().toLowerCase() !== 'false';

/** Where the current values came from, for the Settings screen. */
export const rcStatus = () => status;

/** Fetches and activates values once per launch. Never throws: failures keep the defaults. */
let loading: Promise<void> | null = null;
export function loadRemoteConfig(): Promise<void> {
  loading ??= (async () => {
    try {
      const r = await fetchRemoteValues(RC_DEFAULTS);
      if (!r) return;
      values = { ...RC_DEFAULTS };
      for (const k of Object.keys(RC_DEFAULTS) as RcKey[]) {
        const v = r.values[k];
        // An empty string from the console means "unset": keep the bundled default.
        if (typeof v === 'string' && (v !== '' || k === 'spec_rules_extra')) values[k] = v;
      }
      status = r.fetched ? 'remote' : 'cached';
      version++;
      listeners.forEach((l) => l());
    } catch {
      // Offline, no Firebase project, or Remote Config unsupported: the defaults stay in effect.
    }
  })();
  return loading;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-renders when Remote Config values are activated. */
export function useRemoteConfig() {
  useSyncExternalStore(subscribe, () => version, () => version);
  return { string: rcString, bool: rcBool, status };
}
