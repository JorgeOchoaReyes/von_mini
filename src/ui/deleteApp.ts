/**
 * Deleting an app, from anywhere (the app's header, a long-press on Home, the actions menu).
 *
 * A ready-made app that the user changed is stored as their own copy; deleting that copy resets
 * it to the original, so it's offered as "Reset". An unchanged ready-made app has nothing to
 * delete. Everything the app stored goes with it: entries, chat, versions and reminders, and its
 * shared design in Firestore if it was shared.
 */
import { Alert, Platform } from 'react-native';

import { cancelRemindersForApp } from '../alerts/notifications';
import { STARTERS } from '../spec/starters';
import { deleteApp, type SavedApp } from '../storage/store';

export const isStarter = (app: SavedApp) => STARTERS.some((s) => s.id === app.id);
/** Starters ship with updatedAt 0; a saved (changed) copy gets a real timestamp. */
export const isChangedStarter = (app: SavedApp) => isStarter(app) && app.updatedAt > 0;
export const canDelete = (app: SavedApp) => !isStarter(app) || isChangedStarter(app);

async function removeEverything(app: SavedApp) {
  await cancelRemindersForApp(app.id);
  if (app.shareId) {
    // Best-effort: the share link should not outlive the app. Loaded lazily (Firebase).
    try {
      const { unpublishApp } = await import('../share/share');
      await unpublishApp(app.shareId);
    } catch {
      // Offline or signed out: the shared design stays; nothing else depends on it.
    }
  }
  await deleteApp(app.id);
}

/** Asks for confirmation, deletes, then calls `onDone`. */
export function confirmDeleteApp(app: SavedApp, onDone: () => void) {
  const name = `${app.spec.emoji} ${app.spec.name}`.trim();
  if (!canDelete(app)) {
    const msg = 'Ready-made apps can’t be deleted. Change one and it becomes yours, then you can delete or reset it.';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert(app.spec.name, msg);
    return;
  }
  const reset = isChangedStarter(app);
  const title = reset ? `Reset ${app.spec.name}?` : `Delete ${app.spec.name}?`;
  const body = reset
    ? `Your changes to ${name}, and everything saved in it, are removed. It goes back to the original ready-made app.`
    : `${name} and everything saved in it (entries, chat, versions and reminders) will be removed from this device.`;
  const go = () => void removeEverything(app).then(onDone);
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${body}`)) go();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: reset ? 'Reset' : 'Delete', style: 'destructive', onPress: go },
  ]);
}
