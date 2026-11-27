/**
 * Work the user may leave running: a build or a chat edit keeps going when they switch apps.
 *
 * Android freezes a backgrounded app within seconds and cuts its network, which used to fail a
 * build the moment the user looked away. Two layers stop that:
 *
 *  1. While work runs, a foreground service (a quiet "Building your app…" notification) keeps the
 *     app alive. Needs an APK with the service; older ones skip it.
 *  2. If the request still dies while the app was in the background (no service, or the phone
 *     refused it), it isn't reported as a failure: it waits until the user is back and runs again.
 */
import { AppState } from 'react-native';

import NanoBridge from '../../modules/nano-bridge';
import { notify } from '../alerts/notifications';
import { isCloudUnavailable } from './hybrid';
import { StoppedError } from './stoppable';

let holders = 0;
let pendingStop: ReturnType<typeof setTimeout> | undefined;

/**
 * How long the service outlives the last job. Stopping and restarting a foreground service back
 * to back (one chat turn ends, the edit it asked for starts) crashes the whole app on Android:
 * "startForegroundService() did not then call startForeground()". Keeping it a few seconds lets
 * the next job reuse the running service, and never stops one that is still starting up.
 */
const STOP_DELAY_MS = 6000;

function hold(title: string) {
  if (holders++ === 0) {
    if (pendingStop) {
      // Still running from the last job: keep it.
      clearTimeout(pendingStop);
      pendingStop = undefined;
    } else {
      try {
        NanoBridge?.startKeepAlive?.(title);
      } catch {
        // Not available in this build, or not allowed right now: the work runs unprotected.
      }
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holders === 0) {
      pendingStop = setTimeout(() => {
        pendingStop = undefined;
        if (holders > 0) return;
        try {
          NanoBridge?.stopKeepAlive?.();
        } catch {
          // Nothing to stop.
        }
      }, STOP_DELAY_MS);
    }
  };
}

const untilActive = () =>
  new Promise<void>((resolve) => {
    if (AppState.currentState === 'active') return resolve();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      sub.remove();
      resolve();
    });
  });

/**
 * Runs `work` so it survives the user switching away, and lets them stop it. Like `stoppable`,
 * stopping settles the wait at once (the request itself may finish later and is ignored).
 */
export function backgroundWork<T>(
  title: string,
  work: () => Promise<T>,
  opts: { resumeNote?: { title: string; body: string; url: string } } = {},
): { promise: Promise<T>; stop: () => void } {
  let stopped = false;
  let stop = () => {};
  const release = hold(title);
  const halted = new Promise<never>((_, reject) => {
    stop = () => {
      stopped = true;
      release();
      reject(new StoppedError());
    };
  });

  const run = async (): Promise<T> => {
    let left = AppState.currentState !== 'active';
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') left = true;
    });
    try {
      return await work();
    } catch (e) {
      // Cut off while the user was away: not a real failure. Pick it up again once they're back.
      if (stopped || !left || !isCloudUnavailable(e)) throw e;
      if (AppState.currentState !== 'active' && opts.resumeNote) void notify(opts.resumeNote);
      await untilActive();
      if (stopped) throw new StoppedError();
      return await work();
    } finally {
      sub.remove();
    }
  };

  const promise = run();
  promise.then(release, release);
  // The abandoned work may still fail after a stop; that's expected and must not surface.
  promise.catch(() => undefined);
  return { promise: Promise.race([promise, halted]), stop };
}
