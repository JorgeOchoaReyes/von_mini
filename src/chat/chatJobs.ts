/**
 * Chat jobs run outside any screen: leaving the chat (or the app screen) does not cancel them.
 * Results are written to on-device storage and subscribers are notified to reload.
 *
 * Each turn streams, so the chat can show the real pipeline steps ("Applying the change") rather
 * than an unexplained spinner, and every applied edit records a version snapshot for undo.
 */
import { useSyncExternalStore } from 'react';

import { chatAboutApp, local, type BuildEvent, type ProgressStep, type RouteContext } from '../ai/hybrid';
import { customError, writeCustom } from './customJobs';
import { CODE_CHANGE } from '../spec/diff';
import { notify, notifyIfInBackground } from '../alerts/notifications';
import { backgroundWork } from '../ai/background';
import { StoppedError } from '../ai/stoppable';
import {
  appendMessage,
  getApp,
  listMessages,
  pushVersion,
  saveApp,
  updateMessage,
  type ChatMessage,
} from '../storage/store';

const busy = new Set<string>();
/** Stop handles for in-flight chat turns, by app. */
const stops = new Map<string, () => void>();
const progress = new Map<string, ProgressStep[]>();
const listeners = new Set<() => void>();
let version = 0;

/**
 * Screens with unsaved edits register a flusher here, so a chat job starts from the spec the user
 * actually sees rather than an older one in storage (which would discard their edits on save).
 */
const flushers = new Map<string, () => Promise<void>>();
export function registerFlusher(appId: string, flush: () => Promise<void>) {
  flushers.set(appId, flush);
  return () => {
    if (flushers.get(appId) === flush) flushers.delete(appId);
  };
}

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever any thread, progress step or app is updated by a chat job. */
export const useChatVersion = () => useSyncExternalStore(subscribe, () => version, () => version);

export const isBusy = (appId: string) => busy.has(appId);

/** Stops the chat turn in flight for this app (thinking or streaming). Its result is discarded. */
export function stopMessage(appId: string) {
  stops.get(appId)?.();
}
/** Whether the turn in flight can still be stopped (not once the app's code is being rewritten). */
export const canStop = (appId: string) => stops.has(appId);
export const chatSteps = (appId: string) => progress.get(appId) ?? [];

/** Lets the builder tell subscribers that it changed an app outside the chat. */
export const notifyAppsChanged = emit;

function applyEvent(appId: string, e: BuildEvent) {
  // A stopped turn keeps running in the background; don't let its progress reappear.
  if (e.type !== 'step' || !busy.has(appId)) return;
  const prev = progress.get(appId) ?? [];
  const next = prev.map((s) =>
    s.id === e.step.id ? e.step : s.state === 'active' ? { ...s, state: 'done' as const } : s,
  );
  progress.set(appId, next.some((s) => s.id === e.step.id) ? next : [...next, e.step]);
  emit();
}

export async function sendMessage(appId: string, text: string, ctx: RouteContext): Promise<void> {
  const message = text.trim();
  if (!message || busy.has(appId)) return;
  busy.add(appId);
  await appendMessage(appId, { role: 'user', text: message });
  emit();
  try {
    await flushers.get(appId)?.();
    const app = await getApp(appId);
    if (!app) throw new Error('This app no longer exists.');
    const history = (await listMessages(appId))
      .filter((m) => m.kind !== 'error')
      .slice(0, -1)
      .map((m) => ({ role: m.role, text: m.text }));
    // Keeps going if the user switches apps (see background.ts).
    const turn = backgroundWork('Updating your app…', () => chatAboutApp(app.spec, history, message, ctx, (e) => applyEvent(appId, e)), {
      resumeNote: { title: `${app.spec.emoji} ${app.spec.name}`, body: 'Your phone paused the change. Open von mini to finish it.', url: `/app/${appId}` },
    });
    stops.set(appId, turn.stop);
    const reply = await turn.promise;

    if (reply.kind === 'edit') {
      // The app may have changed while the model was working (another edit, a restore). Saving
      // now would silently overwrite that, so only apply the edit to the spec it was made for.
      const latest = await getApp(appId);
      if (!latest) throw new Error('This app no longer exists.');
      if (JSON.stringify(latest.spec) !== JSON.stringify(app.spec)) {
        throw new Error('The app changed while I was working on this, so I left it as it is. Ask again to apply the change.');
      }
      await saveApp({ ...latest, spec: reply.spec, builtWith: reply.source });
      await pushVersion(appId, reply.spec, reply.changes, 'chat', reply.source, app.spec);
      // An app made of HTML only changes once its code is rewritten: keep showing progress until
      // it really is, and only then say it's done (or say plainly that it isn't).
      const brief = reply.spec.code;
      if (brief && brief !== app.spec.code) {
        if (local(ctx)) {
          await appendMessage(appId, {
            role: 'assistant',
            kind: 'answer',
            text: 'Got it. I’ll make this change to the app as soon as you’re online.',
          });
          return;
        }
        stops.delete(appId);
        applyEvent(appId, { type: 'step', step: { id: 'html', label: 'Updating the app… this takes a little while', state: 'active' } });
        await writeCustom(appId, ctx);
        const written = await getApp(appId);
        if (written?.spec.code !== brief) return; // Changed again meanwhile; that change reports itself.
        if (written.htmlFor !== brief) {
          const why = customError(appId, brief) ?? 'It didn’t finish.';
          throw new Error(`I couldn’t update the app: ${why} Tap Retry on the App tab, or ask again.`);
        }
      }
      // Say what was done in their words, not a generic line.
      const changes = reply.changes.map((l) => (l === CODE_CHANGE ? `Made your change: “${message.slice(0, 160)}”` : l));
      void notifyIfInBackground({
        title: `${reply.spec.emoji} ${reply.spec.name} updated`,
        body: changes[0] ?? 'Your change is done. Tap to see it.',
        url: `/app/${appId}`,
      });
      await appendMessage(appId, {
        role: 'assistant',
        kind: 'edit',
        source: reply.source,
        text: changes.join('\n'),
        prevSpec: app.spec,
        nextSpec: reply.spec,
      });
    } else {
      await appendMessage(appId, { role: 'assistant', kind: 'answer', source: reply.source, text: reply.text });
    }
  } catch (e) {
    if (e instanceof StoppedError) {
      // The user stopped it: nothing was changed, and that's not an error worth a notification.
      await appendMessage(appId, { role: 'assistant', kind: 'answer', text: 'Stopped. Nothing was changed.' });
      return;
    }
    const text = e instanceof Error ? e.message : String(e);
    await appendMessage(appId, { role: 'assistant', kind: 'error', text });
    void notify({ title: 'Couldn’t change your app', body: text.slice(0, 180), url: `/app/${appId}` });
  } finally {
    stops.delete(appId);
    busy.delete(appId);
    progress.delete(appId);
    emit();
  }
}

/** Restores the app to how it was before an edit message. */
export async function undoEdit(appId: string, msg: ChatMessage): Promise<void> {
  if (msg.kind !== 'edit' || !msg.prevSpec || msg.undone || busy.has(appId)) return;
  // Save any edits still pending on the app screen first, so they're seen (and never overwrite the undo).
  await flushers.get(appId)?.();
  const app = await getApp(appId);
  if (!app) return;
  // Undo only puts back what this edit changed. If the app changed since (a later edit, a manual
  // change or a restore), going back would silently throw that work away.
  const later = (await listMessages(appId)).some((m) => m.kind === 'edit' && !m.undone && m.at > msg.at);
  const changed = msg.nextSpec ? JSON.stringify(app.spec) !== JSON.stringify(msg.nextSpec) : later;
  if (changed) {
    await appendMessage(appId, {
      role: 'assistant',
      kind: 'answer',
      text: 'The app has changed since that edit, so I can’t undo it on its own. Undo the newer changes first, or restore an older version from History.',
    });
    emit();
    return;
  }
  await saveApp({ ...app, spec: msg.prevSpec });
  await pushVersion(appId, msg.prevSpec, ['Undid a chat edit.'], 'restore', app.builtWith, app.spec);
  await updateMessage(appId, msg.id, { undone: true });
  await appendMessage(appId, { role: 'assistant', kind: 'undo', text: 'Undid that change.' });
  emit();
}
