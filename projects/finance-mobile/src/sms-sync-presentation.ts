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
      ? "Could not resolve the finance server. SMS remain saved on this device. Try switching Wi-Fi/mobile data or checking Private DNS, then retry."
      : status?.message ?? "New trusted SMS will upload when connectivity is available.",
    waiting,
    running,
  };
}
