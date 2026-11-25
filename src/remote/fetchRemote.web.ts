/** Web: Remote Config through the Firebase JS SDK (needs IndexedDB, which browsers have). */
import { ensureInitialized, fetchAndActivate, getAll, getRemoteConfig, isSupported, setLogLevel } from 'firebase/remote-config';

import { firebaseApp, firebaseConfigured } from '../firebase/app';

export async function fetchRemoteValues(
  defaults: Record<string, string>,
): Promise<{ values: Record<string, string>; fetched: boolean } | null> {
  if (!firebaseConfigured || !(await isSupported())) return null;
  const rc = getRemoteConfig(firebaseApp());
  // A failed fetch is expected (offline, airplane-mode demos) and handled by falling back to the
  // last activated values or the defaults, so don't let the SDK log it as an error.
  setLogLevel(rc, 'silent');
  rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
  rc.settings.fetchTimeoutMillis = 8000;
  rc.defaultConfig = defaults;
  let fetched = false;
  try {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) await ensureInitialized(rc);
    else fetched = await fetchAndActivate(rc);
  } catch {
    // Offline: whatever was activated last time (or the defaults) still applies.
  }
  const all = getAll(rc);
  return { values: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.asString()])), fetched };
}
