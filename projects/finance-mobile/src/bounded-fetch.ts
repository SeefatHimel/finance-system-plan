/** Bound both response headers and body so sync cannot wait forever on one request. */
export async function boundedFetch(url: string, init?: RequestInit, timeoutMs = 25_000): Promise<Response> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (init?.signal?.aborted) controller.abort();
  init?.signal?.addEventListener("abort", forwardAbort);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return new Response(body || null, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      throw new Error(`Server did not respond within ${timeoutMs / 1000} seconds. Check your connection and retry.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", forwardAbort);
  }
}
