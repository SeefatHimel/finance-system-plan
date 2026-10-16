import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { getSmsDeviceStatus, type SmsDeviceStatus } from "./api";
import type { NativeSmsBackgroundSyncStatus } from "../modules/finance-sms-capture/src";
import { smsSyncSummary } from "./sms-sync-presentation";
import { formatTimestamp } from "../../finance-contracts/presentation";
import { Disclosure } from "./disclosure";
import { ui } from "./mobile-ui";
export function useServerSyncStatus(
  token: string,
  scope: string | null,
  completion: string,
) {
  const [state, setState] = useState<{
    scope: string | null;
    value: SmsDeviceStatus | null;
    error: boolean;
  }>({ scope: null, value: null, error: false });
  const ref = useRef({ token, scope });
  ref.current = { token, scope };
  useEffect(() => {
    const owner = scope;
    let active = true;
    let request: AbortController | null = null;
    const refresh = () => {
      if (!owner) return;
      request?.abort();
      const abort = new AbortController();
      request = abort;
      void getSmsDeviceStatus(ref.current.token, abort.signal)
        .then((value) => {
          if (active && !abort.signal.aborted && ref.current.scope === owner)
            setState({ scope: owner, value, error: false });
        })
        .catch(() => {
          if (active && !abort.signal.aborted && ref.current.scope === owner)
            setState((old) => ({
              scope: owner,
              value: old.scope === owner ? old.value : null,
              error: true,
            }));
        });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      active = false;
      request?.abort();
      subscription.remove();
    };
  }, [scope, completion]);
  return state.scope === scope ? state : { scope, value: null, error: false };
}
export function SyncSummary({
  status,
  pending,
  server,
}: {
  status: NativeSmsBackgroundSyncStatus | null;
  pending: number;
  server: ReturnType<typeof useServerSyncStatus>;
}) {
  const summary = smsSyncSummary(status, pending);
  return (
    <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.title}>
        {summary.label}
      </Text>
      <Text accessibilityLiveRegion="polite" style={ui.text}>
        {summary.known
          ? `${summary.uploaded} accepted this run · ${summary.queued} still saved on device`
          : "Queue count unavailable"}
      </Text>
      {summary.known ? (
        <Text style={ui.muted}>
          {summary.waiting} waiting · {summary.delayed} temporarily delayed ·{" "}
          {summary.rejected} need correction
        </Text>
      ) : null}
      <Text style={summary.rejected || !summary.known ? ui.error : ui.text}>
        {summary.guidance}
      </Text>
      {summary.next && summary.queued > summary.rejected ? (
        <Text style={ui.muted}>
          Next retry no earlier than {formatTimestamp(summary.next)};
          connectivity and Android scheduling are required.
        </Text>
      ) : null}
      <Text style={ui.muted}>
        Last successful sync (server report):{" "}
        {server.value?.last_successful_sync_at
          ? formatTimestamp(server.value.last_successful_sync_at)
          : "Not reported"}
        {server.error ? " · Could not refresh server status" : ""}
      </Text>
      {status?.updatedAt ? (
        <Text style={ui.muted}>
          Device status updated {formatTimestamp(status.updatedAt)}
        </Text>
      ) : null}
      <Disclosure label="About sync counts">
        <Text style={ui.muted}>
          Accepted counts include duplicate acknowledgements. Importing SMS
          creates review items; confirmation creates ledger entries. Server
          timestamps can include this user’s other devices.
        </Text>
      </Disclosure>
    </View>
  );
}
