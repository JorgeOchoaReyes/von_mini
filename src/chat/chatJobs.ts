/**
 * Chat jobs run outside any screen: leaving the chat (or the app screen) does not cancel them.
 * Results are written to on-device storage and subscribers are notified to reload.
 */
import { useSyncExternalStore } from 'react';

import { chatAboutApp, type RouteContext } from '../ai/hybrid';
import { appendMessage, getApp, listMessages, saveApp, updateMessage, type ChatMessage } from '../storage/store';

const busy = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

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

/** Changes whenever any thread or app is updated by a chat job. */
export const useChatVersion = () => useSyncExternalStore(subscribe, () => version, () => version);

export const isBusy = (appId: string) => busy.has(appId);

export async function sendMessage(appId: string, text: string, ctx: RouteContext): Promise<void> {
  const message = text.trim();
  if (!message || busy.has(appId)) return;
  busy.add(appId);
  await appendMessage(appId, { role: 'user', text: message });
  emit();
  try {
    const app = await getApp(appId);
    if (!app) throw new Error('This app no longer exists.');
    const history = (await listMessages(appId))
      .filter((m) => m.kind !== 'error')
      .slice(0, -1)
      .map((m) => ({ role: m.role, text: m.text }));
    const reply = await chatAboutApp(app.spec, history, message, ctx);

    if (reply.kind === 'edit') {
      if (!reply.changes.length) {
        await appendMessage(appId, {
          role: 'assistant',
          kind: 'answer',
          source: reply.source,
          text: "I couldn't find anything to change for that. Try naming the field or button, e.g. “add a field for sleep hours”.",
        });
      } else {
        await saveApp({ ...app, spec: reply.spec, builtWith: reply.source });
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
    await appendMessage(appId, { role: 'assistant', kind: 'error', text: e instanceof Error ? e.message : String(e) });
  } finally {
    busy.delete(appId);
    emit();
  }
}

/** Restores the app to how it was before an edit message. */
export async function undoEdit(appId: string, msg: ChatMessage): Promise<void> {
  if (msg.kind !== 'edit' || !msg.prevSpec || msg.undone) return;
  const app = await getApp(appId);
  if (!app) return;
  await saveApp({ ...app, spec: msg.prevSpec });
  await updateMessage(appId, msg.id, { undone: true });
  await appendMessage(appId, { role: 'assistant', kind: 'undo', text: 'Undid that change.' });
  emit();
}
