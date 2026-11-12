import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View, Pressable } from "react-native";
import { ModalFrame, ActionButton, useMobileUi } from "./mobile-ui";
import { Disclosure } from "./disclosure";
import { getPathaoSources, resolvePathaoSources } from "./api";
import { newEntryId } from "../../finance-contracts/quick-add";
import type { PathaoSourcePreview } from "../../finance-contracts/sender-groups";

export function PathaoSourceReview({
  id,
  token,
  keepTransactionId,
  onClose,
  onSaved,
}: {
  id: string;
  token: string;
  keepTransactionId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ui = useMobileUi();
  const owner = useRef({ id, token, active: true });
  useEffect(() => {
    const session = { id, token, active: true };
    owner.current = session;
    return () => {
      session.active = false;
    };
  }, [id, token]);
  const [data, setData] = useState<PathaoSourcePreview | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0),
    [keep, setKeep] = useState<string | undefined>(keepTransactionId);
  const request = useRef(newEntryId()),
    saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setChecked(false);
    setData(null);
    request.current = newEntryId();
    void getPathaoSources(token, id, controller.signal, keep)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not compare sources.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, token, epoch, keep]);
  async function save() {
    if (!data || !checked || saving.current) return;
    const session = owner.current;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await resolvePathaoSources(
        token,
        id,
        data.preview_token,
        request.current,
      );
      if (session.active && owner.current === session) onSaved();
    } catch (e) {
      if (!session.active || owner.current !== session) return;
      setError(
        e instanceof Error ? e.message : "Refresh the source comparison.",
      );
      setChecked(false);
    } finally {
      if (session.active && owner.current === session) setBusy(false);
      saving.current = false;
    }
  }
  return (
    <ModalFrame
      title="Pathao Pay SMS sources"
      busy={busy}
      onClose={onClose}
      footer={
        <View style={ui.row}>
          <ActionButton
            label="Back to review"
            disabled={busy}
            onPress={onClose}
          />
          <ActionButton
            label="Refresh comparison"
            disabled={busy || loading}
            onPress={() => setEpoch((n) => n + 1)}
          />
          {data?.can_resolve ? (
            <ActionButton
              primary
              label={
                data.transactions.length > 1
                  ? "Merge entries · keep all sources"
                  : "Link SMS · record once"
              }
              disabled={busy || !checked}
              onPress={() => void save()}
            />
          ) : null}
        </View>
      }
    >
      {loading ? (
        <ActivityIndicator accessibilityLabel="Comparing original SMS" />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {error}
        </Text>
      ) : null}
      {data ? (
        <>
          <Text style={[ui.text, { fontWeight: "700" }]}>
            {data.sources.length} SMS · {data.transactions.length} saved entries
          </Text>
          <Text style={ui.muted}>
            Original messages remain attached. Money is counted once.
          </Text>
          {data.reference ? (
            <Text selectable style={ui.text}>
              Provider reference: {data.reference}
            </Text>
          ) : (
            <Text style={ui.muted}>
              No verified provider reference. Review each message individually.
            </Text>
          )}
          {data.blockers.map((issue) => (
            <Text accessibilityRole="alert" key={issue} style={ui.error}>
              {issue}
            </Text>
          ))}
          {data.sources.map((source) => (
            <Disclosure
              key={source.id}
              label={`${source.sender} · BDT ${source.amount ?? "Amount unknown"} · ${source.direction || "Direction unknown"} · ${source.status === "confirmed" ? "Linked" : "Pending review"}`}
            >
              <Text style={ui.muted}>
                {source.received_at} · Balance{" "}
                {source.balance_after ?? "Not reported"} · Fee{" "}
                {source.fee_amount ?? "Not reported"}
              </Text>
              <Text selectable style={ui.text}>
                {source.text}
              </Text>
            </Disclosure>
          ))}
          {data.transactions.length ? (
            <>
              <Text style={[ui.text, { fontWeight: "700" }]}>
                Saved entry to keep
              </Text>
              <Text style={ui.muted}>
                Its date, type, note, category and reported balance stay
                unchanged. All linked SMS, PDF and spreadsheet sources are
                retained.{" "}
                {keepTransactionId
                  ? "The transaction you opened will be kept."
                  : ""}
              </Text>
              {data.transactions.map((entry) => (
                <ActionButton
                  key={entry.id}
                  disabled={busy || Boolean(keepTransactionId)}
                  label={`${data.keep === entry.id ? "Selected · " : ""}${entry.account_name} · ${entry.date} · BDT ${entry.amount} · ${entry.note || entry.description}`}
                  onPress={() => setKeep(entry.id)}
                />
              ))}
            </>
          ) : (
            <Text style={ui.muted}>
              Continue your SMS review. Confirming one verified notification
              links its matching originals to the same transaction.
            </Text>
          )}
          {data.can_resolve ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled: busy }}
              disabled={busy}
              style={ui.button}
              onPress={() => setChecked((value) => !value)}
            >
              <Text style={ui.text}>
                {checked ? "✓ " : "□ "}I compared the originals. These describe
                one movement
                {data.transactions.length > 1
                  ? "; merge the recorded duplicates"
                  : ""}
                .
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </ModalFrame>
  );
}
