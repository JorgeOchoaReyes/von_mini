/**
 * Lets the user stop an AI request that is thinking or streaming. The underlying request can't
 * always be cancelled (the Android bridge has no cancel), so stopping settles the wait at once and
 * the late result, if any, is ignored.
 */
export class StoppedError extends Error {
  constructor() {
    super('Stopped.');
  }
}

export function stoppable<T>(work: Promise<T>): { promise: Promise<T>; stop: () => void } {
  let stop = () => {};
  const stopped = new Promise<never>((_, reject) => {
    stop = () => reject(new StoppedError());
  });
  // The abandoned request may still fail later; that's expected and must not surface.
  work.catch(() => undefined);
  return { promise: Promise.race([work, stopped]), stop };
}
