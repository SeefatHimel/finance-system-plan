import type { NativeSmsBackgroundSyncStatus } from "../modules/finance-sms-capture/src";

/** Network retries and records needing user correction are distinct states. */
export function smsSyncPresentation(status: NativeSmsBackgroundSyncStatus | null, pending: number) {
  const oldDnsError = /Unable to resolve host|No address associated with hostname/i.test(status?.message ?? "");
  const kind = status?.failureKind || (oldDnsError ? "network" : "");
  const running = status?.workerRunning ?? status?.state === "running";
  const waiting = status?.state === "error" && (kind === "network" || kind === "server");
  const attention = status?.state === "error" && !waiting;
  return {
    label: running ? "Syncing" : waiting ? "Waiting" : attention ? "Attention" : pending > 0 ? "Pending" : "Ready",
    tone: attention ? "error" : waiting || pending > 0 ? "waiting" : "ready",
    message: oldDnsError
      ? "The upload request could not resolve the API hostname. SMS remain saved; diagnostics are needed to identify the cause."
      : status?.message ?? "New trusted SMS will upload when connectivity is available.",
    waiting,
    running,
  };
}

export function smsSyncDiagnostics(status: NativeSmsBackgroundSyncStatus | null, appVersion: string, apiBaseUrl?: string) {
  // React Native's URL implementation does not expose hostname on every supported version.
  const foregroundHost = apiBaseUrl?.match(/^https?:\/\/(?:[^/?#]*@)?([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i)?.[1]?.toLowerCase() ?? "";
  // Explicit allowlist: never include messages, senders, tokens, users or record IDs.
  return JSON.stringify({
    appVersion, foregroundHost, configuredHost: status?.configuredHost ?? "",
    hostsMatch: foregroundHost && status?.configuredHost ? foregroundHost === status.configuredHost.toLowerCase() : null,
    state: status?.state ?? "unknown", stage: status?.stage ?? "unknown",
    pendingCount: status?.pendingCount ?? null, importedInLastRun: status?.importedCount ?? 0,
    pendingCountKnown: status?.pendingCountKnown ?? null,
    rejectedCount: status?.rejectedCount ?? 0, delayedCount: status?.delayedCount ?? 0,
    queueReadable: status?.queueReadable ?? null, httpCode: status?.httpCode ?? 0,
    errorClass: status?.errorClass ?? "", failureKind: status?.failureKind ?? "",
    queuedFailureCodes: status?.queuedFailureCodes ?? {},
    workerRunning: status?.workerRunning ?? null, retryScheduled: status?.retryScheduled ?? null,
    retryAttempt: status?.retryAttempt ?? 0, nextAttemptAt: status?.nextAttemptAt ?? "",
    updatedAt: status?.updatedAt ?? "",
  }, null, 2);
}
