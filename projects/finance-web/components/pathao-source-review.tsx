"use client";
import { useEffect, useRef, useState } from "react";
import type { PathaoSourcePreview } from "../../finance-contracts/sender-groups";
import {
  getPathaoSources,
  resolvePathaoSources,
} from "@/lib/pathao-sources-api";
import { getAccessToken } from "@/lib/auth-storage";
import { useToast } from "./toast-provider";
import { useTransactionRecovery } from "./transaction-recovery";
import { ModalDialog } from "./modal-dialog";
import { LoadingState } from "./loading-state";
import {
  formatCalendarDate,
  formatCurrency,
  formatTimestamp,
} from "../../finance-contracts/presentation";

export function PathaoSourceReview({
  candidateId,
  keepTransactionId,
  onClose,
  onSaved,
}: {
  candidateId: string;
  keepTransactionId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<PathaoSourcePreview | null>(null),
    [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false),
    [revision, setRevision] = useState(0),
    [keep, setKeep] = useState<string | undefined>(keepTransactionId);
  const requestId = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [candidateId]);
  const { notify } = useToast();
  const recovery = useTransactionRecovery();
  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    setLoading(true);
    setFailed(false);
    setChecked(false);
    setData(null);
    requestId.current = crypto.randomUUID();
    if (!token) {
      setLoading(false);
      setFailed(true);
      return;
    }
    void getPathaoSources(token, candidateId, controller.signal, keep)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          notify(
            e instanceof Error ? e.message : "Could not compare SMS sources.",
            "error",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [candidateId, revision, keep, notify]);
  async function save() {
    const token = getAccessToken();
    if (!token || !data || !checked || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const result = await resolvePathaoSources(
        token,
        candidateId,
        data.preview_token,
        requestId.current,
      );
      if (!alive.current) return;
      if (result.undo_action) recovery.announce(result.undo_action);
      else
        notify(`${result.source_count} SMS sources linked to one transaction.`);
      window.dispatchEvent(new Event("finance:transactions-changed"));
      onSaved();
    } catch (e) {
      if (!alive.current) return;
      setChecked(false);
      notify(
        e instanceof Error
          ? e.message
          : "Sources changed. Refresh the comparison.",
        "error",
      );
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <ModalDialog
      labelledBy="pathao-source-title"
      className="form-drawer pathao-source-dialog"
      onCancel={onClose}
      busy={busy}
    >
      <div className="form-drawer__header">
        <div>
          <h2 id="pathao-source-title">Pathao Pay · compare SMS sources</h2>
          <p>Original notifications stay attached. Money is recorded once.</p>
        </div>
        <button
          className="button button--ghost"
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close SMS source review"
        >
          ×
        </button>
      </div>
      <div className="form-drawer__body">
        {loading ? (
          <LoadingState label="Comparing original notifications…" />
        ) : failed ? (
          <button className="button" onClick={() => setRevision((n) => n + 1)}>
            Retry comparison
          </button>
        ) : data ? (
          <>
            <p>
              <strong>
                {data.sources.length} SMS · {data.transactions.length} saved{" "}
                {data.transactions.length === 1 ? "entry" : "entries"}
              </strong>
              {data.reference
                ? ` · Reference ${data.reference}`
                : " · No verified provider reference"}
            </p>
            {!data.available ? (
              <p className="inline-note">
                A matching amount alone does not prove duplication. Review these
                messages individually.
              </p>
            ) : null}
            {data.blockers.map((issue) => (
              <p role="alert" key={issue} className="inline-note">
                {issue}
              </p>
            ))}
            <div className="list-stack">
              {data.sources.map((source) => (
                <details className="raw-message" key={source.id}>
                  <summary>
                    {source.sender} · {formatCurrency(source.amount)} ·{" "}
                    {source.direction} ·{" "}
                    {source.status === "confirmed"
                      ? "Linked"
                      : "Pending review"}
                  </summary>
                  <p>
                    {formatTimestamp(source.received_at)} · Balance{" "}
                    {source.balance_after ?? "Not reported"} · Fee{" "}
                    {source.fee_amount ?? "Not reported"}
                  </p>
                  <p className="statement-evidence-text">{source.text}</p>
                </details>
              ))}
            </div>
            {data.transactions.length ? (
              <fieldset>
                <legend>Saved transaction to keep</legend>
                <p>
                  Its date, type, category, note and reported balance stay
                  unchanged. All linked SMS, PDFs and spreadsheet sources are
                  retained.
                </p>
                {data.transactions.map((entry) => (
                  <label className="checkbox-field" key={entry.id}>
                    <input
                      type="radio"
                      name="pathao-keep"
                      disabled={busy || loading || Boolean(keepTransactionId)}
                      checked={data.keep === entry.id}
                      onChange={() => setKeep(entry.id)}
                    />
                    <span>
                      {entry.account_name} · {formatCalendarDate(entry.date)} ·{" "}
                      {formatCurrency(entry.amount)}
                      <br />
                      {entry.note || entry.description} · Balance{" "}
                      {entry.balance_after ?? "Not reported"}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="inline-note">
                Continue reviewing this SMS. Confirming one verified
                notification will link its matching notifications to the same
                transaction.
              </p>
            )}
            {data.can_resolve ? (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  I compared the originals. These describe one money movement
                  {data.transactions.length > 1
                    ? `; merge ${data.transactions.length} recorded entries`
                    : ""}
                  .
                </span>
              </label>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="form-drawer__footer">
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          Back to review
        </button>
        <button
          className="button"
          type="button"
          disabled={busy || loading}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh comparison
        </button>
        {data?.can_resolve ? (
          <button
            className="button button--primary"
            type="button"
            disabled={busy || !checked}
            onClick={() => void save()}
          >
            {busy
              ? "Saving…"
              : data.transactions.length > 1
                ? "Merge entries · keep all sources"
                : "Link SMS · keep one transaction"}
          </button>
        ) : null}
      </div>
    </ModalDialog>
  );
}
