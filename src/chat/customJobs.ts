/**
 * Writing an app's custom version (HTML/JS from Gemini in the cloud) runs outside any screen,
 * like chat jobs: leaving the app or switching away doesn't cancel it.
 *
 * It starts by itself when a design carries a `code` brief (a game or interaction the blocks
 * can't do) that hasn't been written yet: after a build, a chat edit, or adding a shared app.
 */
import { useSyncExternalStore } from 'react';

import { backgroundWork } from '../ai/background';
import { buildCustomHtml, local, type RouteContext } from '../ai/hybrid';
import { notifyIfInBackground } from '../alerts/notifications';
import { getApp, saveApp, type SavedApp } from '../storage/store';

const busy = new Set<string>();
/** The last failure per app, with the brief it was for (a new brief clears it). */
const errors = new Map<string, { brief: string; message: string }>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export function useCustomJobsVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export type CustomState =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'writing' }
  | { kind: 'needs-cloud' }
  | { kind: 'failed'; message: string }
  | { kind: 'pending' };

/** Where this app's custom version stands. */
export function customState(app: SavedApp, ctx: RouteContext): CustomState {
  const brief = app.spec.code;
  if (!brief) return { kind: 'none' };
  if (busy.has(app.id)) return { kind: 'writing' };
  if (app.html && app.htmlFor === brief) return { kind: 'ready' };
  const err = errors.get(app.id);
  if (err && err.brief === brief) return { kind: 'failed', message: err.message };
  if (local(ctx)) return { kind: 'needs-cloud' };
  return { kind: 'pending' };
}

/** Writes the custom version for the app's current brief. Safe to call repeatedly. */
export async function writeCustom(appId: string, ctx: RouteContext): Promise<void> {
  if (busy.has(appId)) return;
  const app = await getApp(appId);
  const brief = app?.spec.code;
  if (!app || !brief || (app.html && app.htmlFor === brief)) return;
  busy.add(appId);
  errors.delete(appId);
  emit();
  try {
    const run = backgroundWork('Writing your custom version…', () => buildCustomHtml(app.request, ctx, app.spec), {
      resumeNote: { title: `${app.spec.emoji} ${app.spec.name}`, body: 'Your phone paused writing the custom version. Open von mini to finish it.', url: `/app/${appId}` },
    });
    const html = await run.promise;
    // The design may have changed meanwhile; only keep this if it's still the brief asked for.
    const latest = await getApp(appId);
    if (!latest || latest.spec.code !== brief) return;
    await saveApp({ ...latest, html, htmlFor: brief });
    void notifyIfInBackground({
      title: `${latest.spec.emoji} ${latest.spec.name} is ready`,
      body: 'Your custom version is written. Tap to play it.',
      url: `/app/${appId}`,
    });
  } catch (e) {
    errors.set(appId, { brief, message: e instanceof Error ? e.message : String(e) });
  } finally {
    busy.delete(appId);
    emit();
  }
}
