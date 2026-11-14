import { QueryClient } from "@tanstack/react-query";

export const reportFreshTime = 5 * 60 * 1000;
let client: QueryClient | undefined;
let generation = 0;
let owner: string | null = null;
function cache() {
  return client ??= new QueryClient({ defaultOptions: { queries: {
    staleTime: reportFreshTime, gcTime: reportFreshTime, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  } } });
}

/** Tab-memory only. A departing consumer must not cancel another consumer's read. */
export function readReport<T>(key: readonly unknown[], load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return load(new AbortController().signal);
  return cache().fetchQuery({ queryKey: ["reports", generation, ...key], queryFn: ({ signal }) => load(signal) });
}

export function invalidateReportCache() {
  generation++;
  // A response already in flight belongs to the old generation and cannot warm
  // the new one. Keep it alive for existing consumers; discard settled entries.
  client?.removeQueries({ predicate: query => query.state.fetchStatus !== "fetching" });
}

export function clearReportCache() {
  generation++;
  client?.clear();
  owner = null;
}

export function setReportCacheOwner(id: string | null) {
  if (owner !== id) { clearReportCache(); owner = id; }
}

export function reportWriteCompleted(path: string, method = "GET") {
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && !path.endsWith("/preview/")) invalidateReportCache();
}
