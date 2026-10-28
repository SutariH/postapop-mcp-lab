/**
 * Runs work one at a time per key, such as a post id. Two calls for the same
 * post take turns; calls for different posts run side by side.
 *
 * This works because the lab is one process. With several server instances,
 * use a lock that all of them share, such as a database row lock.
 */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();

  return async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      // Forget the key when nobody else is waiting, so the map does not grow.
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
