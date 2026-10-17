/** Share a refresh while pending; reuse success briefly from completion, never failure. */
export function createRefreshCoordinator<T>(reuseMilliseconds: number, now = Date.now) {
  const operations = new Map<string, { expiresAt: number; promise: Promise<T> }>();
  return (key: string, refresh: () => Promise<T>): Promise<T> => {
    const time = now();
    for (const [id, entry] of operations) {
      if (entry.expiresAt <= time) operations.delete(id);
    }
    const existing = operations.get(key);
    if (existing) return existing.promise;
    const operation = { expiresAt: Infinity, promise: null as unknown as Promise<T> };
    operation.promise = Promise.resolve().then(refresh).then(value => {
      operation.expiresAt = now() + reuseMilliseconds;
      return value;
    }, error => {
      if (operations.get(key) === operation) operations.delete(key);
      throw error;
    });
    operations.set(key, operation);
    return operation.promise;
  };
}
