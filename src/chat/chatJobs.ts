/**
 * Chat jobs run outside any screen: leaving the chat (or the app screen) does not cancel them.
 * Results are written to on-device storage and subscribers are notified to reload.
 *
 * Each turn streams, so the chat can show the real pipeline steps ("Applying the change") rather
 * than an unexplained spinner, and every applied edit records a version snapshot for undo.
 */
import { useSyncExternalStore } from 'react';

import { chatAboutApp, type BuildEvent, type ProgressStep, type RouteContext } from '../ai/hybrid';
import { notify, notifyIfInBackground } from '../alerts/notifications';
import { stoppable, StoppedError } from '../ai/stoppable';
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
    const turn = stoppable(chatAboutApp(app.spec, history, message, ctx, (e) => applyEvent(appId, e)));
    stops.set(appId, turn.stop);
    const reply = await turn.promise;

    if (reply.kind === 'edit') {
      if (!reply.changes.length) {
        await appendMessage(appId, {
          role: 'assistant',
          kind: 'answer',
          source: reply.source,
          text: "I couldn't find anything to change for that. Try naming the field or button, e.g. “add a field for sleep hours”.",
        });
      } else {
        // The app may have changed while the model was working (another edit, a restore). Saving
        // now would silently overwrite that, so only apply the edit to the spec it was made for.
        const latest = await getApp(appId);
        if (!latest) throw new Error('This app no longer exists.');
        if (JSON.stringify(latest.spec) !== JSON.stringify(app.spec)) {
          throw new Error('The app changed while I was working on this, so I left it as it is. Ask again to apply the change.');
        }
        await saveApp({ ...latest, spec: reply.spec, builtWith: reply.source });
        await pushVersion(appId, reply.spec, reply.changes, 'chat', reply.source, app.spec);
        void notifyIfInBackground({
          title: `${reply.spec.emoji} ${reply.spec.name} updated`,
          body: reply.changes[0] ?? 'Your change is done. Tap to see it.',
          url: `/app/${appId}`,
        });
        await appendMessage(appId, {
          role: 'assistant',
          kind: 'edit',
          source: reply.source,
          text: reply.changes.join('\n'),
          prevSpec: app.spec,
        });
      }
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
  if (msg.kind !== 'edit' || !msg.prevSpec || msg.undone) return;
  const app = await getApp(appId);
  if (!app) return;
  await saveApp({ ...app, spec: msg.prevSpec });
  await pushVersion(appId, msg.prevSpec, ['Undid a chat edit.'], 'restore', app.builtWith, app.spec);
  await updateMessage(appId, msg.id, { undone: true });
  await appendMessage(appId, { role: 'assistant', kind: 'undo', text: 'Undid that change.' });
  emit();
}
