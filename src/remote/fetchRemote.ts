/**
 * Android: Remote Config through the native Firebase SDK in the nano-bridge module (the JS SDK
 * needs IndexedDB, which React Native doesn't have).
 */
import NanoBridge from '../../modules/nano-bridge';

export async function fetchRemoteValues(
  defaults: Record<string, string>,
): Promise<{ values: Record<string, string>; fetched: boolean } | null> {
  if (!NanoBridge?.remoteConfig) return null;
  return NanoBridge.remoteConfig(defaults);
}
