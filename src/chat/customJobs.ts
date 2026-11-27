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
import { getApp, pushVersion, saveApp, showsCode, type SavedApp } from '../storage/store';

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

/** Whether the agent is building, updating or repairing this app's HTML right now. */
export const isWriting = (appId: string) => busy.has(appId) || fixing.has(appId);

/* ------------------------------ Self-repair ------------------------------ */

const fixing = new Set<string>();
/** Errors an app reported while running, collected briefly before one repair. */
const runtimeErrors = new Map<string, string[]>();
const repairTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Repairs made per app this session: a fix that keeps failing must not loop. */
const repairs = new Map<string, number>();
const MAX_REPAIRS = 2;

/**
 * An app written in HTML hit an error while running (reported by its sandbox). Gather what follows
 * for a moment, then have Gemini fix exactly those errors in the background: the person sees
 * "Fixing a problem…" instead of an app where nothing happens.
 */
export function reportRuntimeError(appId: string, message: string, ctx: RouteContext) {
  console.warn('[vm-app-error]', appId, message);
  const list = runtimeErrors.get(appId) ?? [];
  if (!list.includes(message) && list.length < 8) list.push(message);
  runtimeErrors.set(appId, list);
  clearTimeout(repairTimers.get(appId));
  repairTimers.set(appId, setTimeout(() => void repairCustom(appId, ctx), 900));
}

async function repairCustom(appId: string, ctx: RouteContext) {
  const errors = runtimeErrors.get(appId) ?? [];
  runtimeErrors.delete(appId);
  if (!errors.length || busy.has(appId) || fixing.has(appId) || local(ctx)) return;
  if ((repairs.get(appId) ?? 0) >= MAX_REPAIRS) return;
  const app = await getApp(appId);
  if (!app?.html || !showsCode(app)) return;
  repairs.set(appId, (repairs.get(appId) ?? 0) + 1);
  fixing.add(appId);
  emit();
  try {
    const run = backgroundWork('Fixing a problem in your app…', () => buildCustomHtml(app.request, ctx, app.spec, app.html, errors));
    const html = await run.promise;
    const latest = await getApp(appId);
    // Only if it's still the same app (no edit or restore meanwhile).
    if (!latest || latest.html !== app.html) return;
    await saveApp({ ...latest, html });
    await pushVersion(appId, latest.spec, ['Fixed a problem in the app.'], 'chat', 'in_cloud', undefined, html);
  } catch {
    // Keep the app as it is; the next error can try again (up to the limit).
  } finally {
    fixing.delete(appId);
    emit();
  }
}

/** Whether the agent is repairing this app right now. */
export const isFixing = (appId: string) => fixing.has(appId);

export type CustomState =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'writing' }
  | { kind: 'needs-cloud' }
  | { kind: 'failed'; message: string }
  | { kind: 'pending' }
  | { kind: 'fixing' };

/** Where this app's custom version stands. */
export function customState(app: SavedApp, ctx: RouteContext): CustomState {
  const brief = app.spec.code;
  if (fixing.has(app.id)) return { kind: 'fixing' };
  if (!brief) return { kind: 'none' };
  if (busy.has(app.id)) return { kind: 'writing' };
  if (app.html && app.htmlFor === brief) return { kind: 'ready' };
  const err = errors.get(app.id);
  if (err && err.brief === brief) return { kind: 'failed', message: err.message };
  if (local(ctx)) return { kind: 'needs-cloud' };
  return { kind: 'pending' };
}

const jobs = new Map<string, Promise<void>>();

/**
 * Writes the custom version for the app's current brief. Safe to call repeatedly: a call while one
 * is running returns that same job, so the chat can wait for the update it asked for.
 */
export function writeCustom(appId: string, ctx: RouteContext, opts: { quiet?: boolean } = {}): Promise<void> {
  // Offline or in private mode it waits ("needs the internet"), and starts once the cloud is back.
  const running = jobs.get(appId);
  if (running) return running;
  if (local(ctx)) return Promise.resolve();
  const job = write(appId, ctx, opts.quiet).finally(() => jobs.delete(appId));
  jobs.set(appId, job);
  return job;
}

/** Why the last update for this brief failed, if it did. */
export const customError = (appId: string, brief: string) => {
  const e = errors.get(appId);
  return e && e.brief === brief ? e.message : undefined;
};

async function write(appId: string, ctx: RouteContext, quiet = false): Promise<void> {
  const app = await getApp(appId);
  const brief = app?.spec.code;
  if (!app || !brief || (app.html && app.htmlFor === brief)) return;
  busy.add(appId);
  errors.delete(appId);
  emit();
  try {
    // Changing an app that's already built in code updates that code, so its look and data carry over.
    const base = app.html && app.htmlFor !== undefined && app.htmlFor !== '-' ? app.html : undefined;
    const run = backgroundWork(base ? 'Updating your app…' : 'Building your app…', () => buildCustomHtml(app.request, ctx, app.spec, base), {
      resumeNote: { title: `${app.spec.emoji} ${app.spec.name}`, body: 'Your phone paused writing the custom version. Open von mini to finish it.', url: `/app/${appId}` },
    });
    const html = await run.promise;
    // The design may have changed meanwhile; only keep this if it's still the brief asked for.
    const latest = await getApp(appId);
    if (!latest || latest.spec.code !== brief) return;
    await saveApp({ ...latest, html, htmlFor: brief });
    // The app now is its code version: record it, so History can go back to the blocks (or here).
    await pushVersion(appId, latest.spec, [base ? 'Updated the app with your change.' : 'Built the app.'], 'chat', 'in_cloud', undefined, html);
    if (!quiet) void notifyIfInBackground({
      title: `${latest.spec.emoji} ${latest.spec.name} ${base ? 'updated' : 'is ready'}`,
      body: base ? 'Your change is in. Tap to see it.' : 'Your app is built. Tap to open it.',
      url: `/app/${appId}`,
    });
  } catch (e) {
    errors.set(appId, { brief, message: e instanceof Error ? e.message : String(e) });
  } finally {
    busy.delete(appId);
    emit();
  }
}
