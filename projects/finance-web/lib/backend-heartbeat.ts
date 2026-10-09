export const heartbeatIntervalMs = 10 * 60 * 1000;

type HeartbeatOptions = {
  ping: (signal: AbortSignal) => Promise<unknown>;
  online: () => boolean;
  now?: () => number;
  lastSuccess?: () => number;
  recordSuccess?: (time: number) => void;
};

/** One bounded request at a time; teardown cancels work and clears its timer. */
export function startBackendHeartbeat(options: HeartbeatOptions) {
  let active = true;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const now = options.now ?? Date.now;
  function schedule(delay = heartbeatIntervalMs) {
    if (!active) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), Math.max(1, delay));
  }
  async function check() {
    if (!active || controller) return;
    if (!options.online()) { schedule(); return; }
    const last = options.lastSuccess?.() ?? 0;
    const elapsed = now() - last;
    if (last && elapsed >= 0 && elapsed < heartbeatIntervalMs) {
      schedule(heartbeatIntervalMs - elapsed);
      return;
    }
    controller = new AbortController();
    const request = controller;
    const startedAt = now();
    if (timer) clearTimeout(timer);
    const timeout = setTimeout(() => request.abort(), 20_000);
    try {
      await options.ping(request.signal);
      if (active && !request.signal.aborted) options.recordSuccess?.(startedAt);
    } catch {
      // Background availability checks never interrupt financial workflows.
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = null;
      schedule(heartbeatIntervalMs - (now() - startedAt));
    }
  }
  void check();
  return { check, stop: () => { active = false; if (timer) clearTimeout(timer); controller?.abort(); } };
}
