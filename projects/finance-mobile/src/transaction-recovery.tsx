import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import {
  recentTransactionAction,
  undoTransactionAction,
  type TransactionAction,
} from "./api";
import { ActionButton, ui } from "./mobile-ui";
import { formatTimestamp } from "../../finance-contracts/presentation";
export function useTransactionRecovery(
  token: string,
  scope: string | null,
  onChanged: () => void,
) {
  const current = useRef({ token, scope, onChanged });
  current.current = { token, scope, onChanged };
  const [state, setState] = useState<{
    scope: string | null;
    latest: TransactionAction | null;
    notice: string;
    error: string;
  }>({ scope, latest: null, notice: "", error: "" });
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const pending = useRef<object | null>(null),
    version = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  const refresh = useCallback(async (announce = false) => {
    const owner = current.current.scope,
      ticket = ++version.current;
    if (!owner) return null;
    try {
      const latest = await recentTransactionAction(current.current.token);
      if (
        alive.current &&
        current.current.scope === owner &&
        version.current === ticket
      )
        setState({
          scope: owner,
          latest,
          notice: announce
            ? latest?.undone
              ? "Action undone."
              : (latest?.label ?? "Transaction saved.")
            : "",
          error: "",
        });
      return current.current.scope === owner ? latest : null;
    } catch (reason) {
      if (
        alive.current &&
        current.current.scope === owner &&
        version.current === ticket
      )
        setState((old) => ({
          scope: owner,
          latest: old.scope === owner ? old.latest : null,
          notice: announce ? "Transaction saved." : "",
          error:
            (reason as { status?: number }).status === 404
              ? "Undo/Edit recovery needs the latest backend deployment."
              : "Could not check the latest action. Refresh before using Undo.",
        }));
      return null;
    }
  }, []);
  useEffect(() => {
    version.current++;
    pending.current = null;
    setBusyScope(null);
    setState({ scope, latest: null, notice: "", error: "" });
    if (scope) void refresh();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active" && current.current.scope) void refresh();
    });
    return () => {
      subscription.remove();
      version.current++;
    };
  }, [scope, refresh]);
  const visible =
    state.scope === scope
      ? state
      : { scope, latest: null, notice: "", error: "" };
  useEffect(() => {
    if (!visible.notice) return;
    const timer = setTimeout(
      () =>
        setState((old) => (old.scope === scope ? { ...old, notice: "" } : old)),
      15000,
    );
    return () => clearTimeout(timer);
  }, [visible.notice, scope]);
  useEffect(() => {
    const action = visible.latest;
    if (!action?.can_undo) return;
    const timer = setTimeout(
      () =>
        setState((old) =>
          old.scope === scope && old.latest?.id === action.id
            ? { ...old, latest: { ...action, can_undo: false } }
            : old,
        ),
      Math.max(
        0,
        Math.min(2147483647, Date.parse(action.expires_at) - Date.now()),
      ),
    );
    return () => clearTimeout(timer);
  }, [visible.latest, scope]);
  const announce = useCallback(async () => {
    // The callback is tied to its owner even if a save finishes after a user switch.
    if (scope && current.current.scope === scope) {
      current.current.onChanged();
      await refresh(true);
    }
  }, [scope, refresh]);
  const undo = useCallback(async () => {
    const action = visible.latest,
      owner = scope;
    if (!owner || current.current.scope !== owner || !action || pending.current)
      return;
    const operation = {};
    pending.current = operation;
    setBusyScope(owner);
    version.current++;
    let completed = false;
    try {
      const latest = await recentTransactionAction(current.current.token);
      if (current.current.scope !== owner || !alive.current) return;
      if (
        !latest ||
        latest.id !== action.id ||
        !latest.can_undo ||
        latest.undone ||
        Date.parse(latest.expires_at) <= Date.now()
      )
        throw new Error(
          "Undo is no longer available for this action. Review the latest saved entry instead.",
        );
      await undoTransactionAction(current.current.token, action.id);
      completed = true;
    } catch (reason) {
      if (current.current.scope !== owner || !alive.current) return;
      // A lost response may follow a successful undo. Re-read; never blindly retry a mutation.
      const latest = await recentTransactionAction(current.current.token).catch(
        () => null,
      );
      if (current.current.scope !== owner || !alive.current) return;
      completed = latest?.id === action.id && latest.undone;
      if (!completed)
        setState({
          scope: owner,
          latest: latest ?? action,
          notice: "",
          error:
            reason instanceof Error
              ? reason.message
              : "Undo failed. Your saved entry remains available to review.",
        });
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        if (alive.current && current.current.scope === owner)
          setBusyScope(null);
      }
    }
    if (completed && current.current.scope === owner && alive.current) {
      current.current.onChanged();
      await refresh();
      if (current.current.scope === owner)
        setState((old) => ({
          ...old,
          scope: owner,
          notice: "Action undone.",
          error: "",
        }));
    }
  }, [visible.latest, scope, refresh]);
  return {
    ...visible,
    busy: busyScope === scope && Boolean(scope),
    announce,
    refresh,
    undo,
    dismiss: () => setState((old) => ({ ...old, notice: "", error: "" })),
  };
}
export function RecoveryCard({
  recovery,
  onEdit,
  compact = false,
}: {
  recovery: ReturnType<typeof useTransactionRecovery>;
  onEdit: (id: string) => void;
  compact?: boolean;
}) {
  const action = recovery.latest;
  if (compact && !recovery.notice && !recovery.error) return null;
  return (
    <View style={[ui.card, { margin: compact ? 8 : 0 }]}>
      <Text accessibilityLiveRegion="polite" style={ui.text}>
        {recovery.notice ||
          (action
            ? `Latest action · ${action.label}`
            : "Latest transaction action")}
      </Text>
      {recovery.error ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {recovery.error}
        </Text>
      ) : null}
      {!compact && action ? (
        <Text style={ui.muted}>
          {formatTimestamp(action.created_at)}
          {action.undone ? " · Undone" : ""}
        </Text>
      ) : null}
      <View style={ui.row}>
        {action?.transaction && !action.undone ? (
          <ActionButton
            label="Edit last transaction"
            text={compact ? "Edit" : undefined}
            disabled={recovery.busy}
            onPress={() => onEdit(action.transaction!)}
          />
        ) : null}
        {action && !action.undone ? (
          <ActionButton
            label={recovery.busy ? "Undoing…" : "Undo last action"}
            text={compact && !recovery.busy ? "Undo" : undefined}
            disabled={
              recovery.busy ||
              !action.can_undo ||
              Date.parse(action.expires_at) <= Date.now()
            }
            onPress={() => void recovery.undo()}
          />
        ) : null}
        {compact ? (
          <ActionButton
            label="Dismiss transaction notification"
            text="Dismiss"
            onPress={recovery.dismiss}
          />
        ) : (
          <ActionButton
            label="Refresh latest action"
            disabled={recovery.busy}
            onPress={() => void recovery.refresh()}
          />
        )}
      </View>
      {!compact ? (
        <Text style={ui.muted}>
          Undo applies to the latest unchanged action for 24 hours. It cannot
          restore SMS text already removed by retention.
        </Text>
      ) : null}
    </View>
  );
}
