import type { NativeSmsBackgroundSyncStatus } from "../modules/finance-sms-capture/src";

/** Network retries and records needing user correction are distinct states. */
export function smsSyncPresentation(
  status: NativeSmsBackgroundSyncStatus | null,
  pending: number,
) {
  const oldDnsError =
    /Unable to resolve host|No address associated with hostname/i.test(
      status?.message ?? "",
    );
  const kind = status?.failureKind || (oldDnsError ? "network" : "");
  const running = status?.workerRunning ?? status?.state === "running";
  const waiting =
    status?.state === "error" && (kind === "network" || kind === "server");
  const attention =
    (status?.state === "error" && !waiting) || (status?.rejectedCount ?? 0) > 0;
  return {
    label: !status
      ? "Not checked"
      : status.pendingCountKnown === false || status.queueReadable === false
        ? "Status unavailable"
        : running
          ? "Syncing"
          : attention
            ? "Attention"
            : waiting
              ? "Waiting"
              : pending > 0
                ? "Pending"
                : "Ready",
    tone:
      !status ||
      status.pendingCountKnown === false ||
      status.queueReadable === false ||
      attention
        ? "error"
        : waiting || pending > 0
          ? "waiting"
          : "ready",
    message: oldDnsError
      ? "The upload request could not resolve the API hostname. SMS remain saved; diagnostics are needed to identify the cause."
      : (status?.message ??
        "New trusted SMS will upload when connectivity is available."),
    waiting,
    running,
  };
}

export function smsSyncDiagnostics(
  status: NativeSmsBackgroundSyncStatus | null,
  appVersion: string,
  apiBaseUrl?: string,
) {
  // React Native's URL implementation does not expose hostname on every supported version.
  const foregroundHost =
    apiBaseUrl
      ?.match(
        /^https?:\/\/(?:[^/?#]*@)?([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i,
      )?.[1]
      ?.toLowerCase() ?? "";
  // Explicit allowlist: never include messages, senders, tokens, users or record IDs.
  return JSON.stringify(
    {
      appVersion,
      foregroundHost,
      configuredHost: status?.configuredHost ?? "",
      hostsMatch:
        foregroundHost && status?.configuredHost
          ? foregroundHost === status.configuredHost.toLowerCase()
          : null,
      state: status?.state ?? "unknown",
      stage: status?.stage ?? "unknown",
      pendingCount: status?.pendingCount ?? null,
      importedInLastRun: status?.importedCount ?? 0,
      pendingCountKnown: status?.pendingCountKnown ?? null,
      rejectedCount: status?.rejectedCount ?? 0,
      delayedCount: status?.delayedCount ?? 0,
      queueReadable: status?.queueReadable ?? null,
      httpCode: status?.httpCode ?? 0,
      errorClass: status?.errorClass ?? "",
      failureKind: status?.failureKind ?? "",
      queuedFailureCodes: status?.queuedFailureCodes ?? {},
      workerRunning: status?.workerRunning ?? null,
      retryScheduled: status?.retryScheduled ?? null,
      retryAttempt: status?.retryAttempt ?? 0,
      nextAttemptAt: status?.nextAttemptAt ?? "",
      updatedAt: status?.updatedAt ?? "",
    },
    null,
    2,
  );
}

export function smsSyncSummary(
  status: NativeSmsBackgroundSyncStatus | null,
  pending: number,
) {
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : 0;
  const known =
    Boolean(status) &&
    status?.pendingCountKnown !== false &&
    status?.queueReadable !== false;
  const queued = count(pending),
    rejected = Math.min(queued, count(status?.rejectedCount)),
    delayed = Math.min(queued - rejected, count(status?.delayedCount));
  const sync = smsSyncPresentation(status, pending);
  const failures = count(status?.rejectedCount) > 0;
  const automatic = status?.retryScheduled === true;
  const next =
    status?.nextAttemptAt && Number.isFinite(Date.parse(status.nextAttemptAt))
      ? status.nextAttemptAt
      : null;
  return {
    known,
    uploaded: count(status?.importedCount),
    queued,
    rejected,
    delayed,
    waiting: Math.max(0, queued - rejected - delayed),
    label: !status
      ? "Not checked"
      : !known
        ? "Status unavailable"
        : sync.running
          ? "Syncing"
          : failures
            ? "Needs correction"
            : sync.label,
    next,
    guidance: !known
      ? "Refresh sync status. Saved SMS are retained; queue counts cannot be verified."
      : failures
        ? "Some SMS need correction or refreshed sender rules. Other eligible messages can still upload."
        : sync.running
          ? "Uploads are in progress. Counts update after each accepted batch."
          : sync.waiting || delayed > 0
            ? automatic
              ? "Retry is scheduled. Leave SMS saved and reconnect; queued messages retry automatically."
              : "SMS remain saved. Reconnect and use Retry if no upload starts."
            : queued > 0
              ? automatic
                ? "Waiting for the scheduled upload; connectivity is required."
                : "Messages are saved on this device. Use Retry to request an upload."
              : "No queued SMS. New trusted messages will upload when capture and connectivity are available.",
  };
}
