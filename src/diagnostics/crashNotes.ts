/**
 * Notes that survive von mini closing unexpectedly, so the next launch can say what happened instead
 * of leaving a silent crash: the JS error that brought the app down (if any), and what the agent was
 * doing at the time (writing an app's code: which step, how many lines).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import NanoBridge from '../../modules/nano-bridge';
import { appendMessage } from '../storage/store';

const KEY = 'vm:crash-notes';
type Notes = {
  activity?: { appId: string; what: string; at: number };
  /** An HTML app open on screen (its game or page running). */
  running?: { appId: string; at: number };
  error?: { message: string; at: number };
};

let notes: Notes = {};
let lastWrite = 0;
const save = () => AsyncStorage.setItem(KEY, JSON.stringify(notes)).catch(() => undefined);

/** What the agent is doing for an app right now. Saved at most every couple of seconds. */
export function noteActivity(appId: string, what: string, force = false) {
  notes = { ...notes, activity: { appId, what, at: Date.now() } };
  if (force || Date.now() - lastWrite > 2000) {
    lastWrite = Date.now();
    void save();
  }
}

/** The activity finished (or stopped) normally. */
export function clearActivity(appId: string) {
  if (notes.activity?.appId !== appId) return;
  notes = { ...notes, activity: undefined };
  void save();
}

/** An app is running on screen now / no longer. */
export function noteRunning(appId: string) {
  notes = { ...notes, running: { appId, at: Date.now() } };
  void save();
}
export function clearRunning(appId: string) {
  if (notes.running?.appId !== appId) return;
  notes = { ...notes, running: undefined };
  void save();
}

type Handler = (error: unknown, isFatal?: boolean) => void;
declare const ErrorUtils: { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void } | undefined;

/** Keeps the message of a fatal JS error before the app closes. */
export function installCrashCatcher() {
  if (typeof ErrorUtils === 'undefined') return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (!isFatal) return previous(error, isFatal);
    const message = error instanceof Error ? `${error.message}${error.stack ? `\n${error.stack.split('\n').slice(0, 3).join('\n')}` : ''}` : String(error);
    notes = { ...notes, error: { message: message.slice(0, 600), at: Date.now() } };
    // Give the write a moment before the app goes down.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      previous(error, isFatal);
    };
    void save().finally(finish);
    setTimeout(finish, 800);
  });
}

/**
 * On launch: if von mini closed while the agent was working, or with an error, say so in that app's
 * chat (where the person will look), then forget it.
 */
export async function reportPreviousCrash(): Promise<void> {
  let previous: Notes = {};
  try {
    previous = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Notes;
  } catch {
    return;
  }
  // A crash in von mini's native code (Android) leaves its stack trace there.
  let native: string | null = null;
  try {
    native = NanoBridge?.takeNativeCrash?.() ?? null;
  } catch {
    native = null;
  }
  if (native && !previous.error) previous.error = { message: `Android: ${native}`, at: Date.now() };
  if (!previous.activity && !previous.error && !previous.running) return;
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
  const { activity, error, running } = previous;
  const detail = (m: string) => m.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' · ').slice(0, 400);
  const why = error ? ` The error was: ${detail(error.message)}` : ' No error was recorded, so the phone most likely closed it (low memory) or it was swiped away.';
  if (activity) {
    await appendMessage(activity.appId, {
      role: 'assistant',
      kind: 'error',
      text: `von mini closed while working on this app (${activity.what}).${why} Your app is as it was before; send your last message again (or tap Retry on the App tab).`,
    }).catch(() => undefined);
  } else if (running) {
    await appendMessage(running.appId, {
      role: 'assistant',
      kind: 'error',
      text: `von mini closed while this app was running.${error ? ` The error was: ${detail(error.message)}` : ' If you didn’t close it yourself, the app most likely used too much memory (a game that keeps adding things without removing them, for example). Tell me what you were doing in it and I’ll fix it.'}`,
    }).catch(() => undefined);
  } else if (error) {
    // Not tied to an app: say it where the person will see it, once the screen is up.
    setTimeout(() => Alert.alert('von mini closed unexpectedly', `The error was: ${detail(error.message)}`), 1500);
  }
}
