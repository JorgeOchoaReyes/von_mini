/**
 * Sharing an app: its *design* (the spec) is published to Cloud Firestore under an anonymous
 * Firebase Auth identity, and anyone with the link can add a copy. Entries, chats and custom
 * HTML never leave the device. Whoever opens the link runs the app's AI on their own device.
 *
 * Firestore layout: shared/{shareId} = { spec, request, ownerUid, createdAt, updatedAt, v }
 * (rules in firestore.rules: anyone can read one by id, only its owner can write it).
 */
import { createURL } from 'expo-linking';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Platform } from 'react-native';

import { currentUser, firestore } from '../firebase/services';
import type { AppSpec } from '../spec/types';
import { sanitizeSpec } from '../spec/validate';
import type { SavedApp } from '../storage/store';

/** Base URL of the hosted web build, so links open in any browser (set after deploying hosting). */
const SHARE_BASE = (process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? '').replace(/\/+$/, '');

export function shareUrl(id: string): string {
  if (SHARE_BASE) return `${SHARE_BASE}/s/${id}`;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/s/${id}`;
  return createURL(`/s/${id}`); // vonmini://s/<id>: opens the app on a phone that has it
}

/**
 * Publishes (or republishes) the app's design. Re-sharing the same app updates the same link;
 * if that is no longer possible (e.g. the app was reinstalled), a new link is made.
 */
export async function publishApp(app: SavedApp): Promise<{ id: string; url: string }> {
  const user = await currentUser();
  const db = firestore();
  const data = {
    // JSON round trip: Firestore rejects `undefined` fields, which optional spec fields can be.
    spec: JSON.parse(JSON.stringify(app.spec)) as AppSpec,
    request: app.request.slice(0, 500),
    ownerUid: user.uid,
    updatedAt: serverTimestamp(),
    v: 1,
  };
  if (app.shareId) {
    try {
      await setDoc(doc(db, 'shared', app.shareId), data, { merge: true });
      return { id: app.shareId, url: shareUrl(app.shareId) };
    } catch {
      // Not ours any more (a new anonymous identity): fall through and publish a new copy.
    }
  }
  const ref = await addDoc(collection(db, 'shared'), { ...data, createdAt: serverTimestamp() });
  return { id: ref.id, url: shareUrl(ref.id) };
}

/** Loads a shared design. It came from someone else, so it is validated like model output. */
export async function loadShared(id: string): Promise<{ spec: AppSpec; request: string }> {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('This share link is not valid.');
  const snap = await getDoc(doc(firestore(), 'shared', id));
  if (!snap.exists()) throw new Error('This shared app was not found. It may have been removed.');
  const d = snap.data() as { spec?: unknown; request?: unknown };
  return { spec: sanitizeSpec(d.spec), request: typeof d.request === 'string' ? d.request : '' };
}
