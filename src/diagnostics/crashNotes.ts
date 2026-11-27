/**
 * Notes that survive von mini closing unexpectedly, so the next launch can say what happened instead
 * of leaving a silent crash: the JS error that brought the app down (if any), and what the agent was
 * doing at the time (writing an app's code: which step, how many lines).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { appendMessage } from '../storage/store';

const KEY = 'vm:crash-notes';
type Notes = { activity?: { appId: string; what: string; at: number }; error?: { message: string; at: number } };

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
  if (!previous.activity && !previous.error) return;
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
  const { activity, error } = previous;
  const why = error ? ` The error was: ${error.message.split('\n')[0]}` : ' No error was recorded, so the phone most likely closed it (low memory) or it was swiped away.';
  if (activity) {
    await appendMessage(activity.appId, {
      role: 'assistant',
      kind: 'error',
      text: `von mini closed while working on this app (${activity.what}).${why} Your app is as it was before; tap Retry on the App tab or ask again.`,
    }).catch(() => undefined);
  } else if (error) {
    console.warn('[vm-crash] previous launch ended with:', error.message);
  }
}
