"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import {
  formatCalendarDate,
  formatClockTime,
} from "../../finance-contracts/presentation";
import type { BulkPairSelection } from "../../finance-contracts/unified-bulk";
import { getAccessToken } from "@/lib/auth-storage";
import {
  approveBulkPairs,
  previewBulkApproval,
  type BulkApprovalPreview,
  type BulkApprovalResult,
} from "@/lib/bulk-approval-api";
import { ModalDialog } from "./modal-dialog";
import { LoadingState, ButtonBusy } from "./loading-state";
import { SourceEvidenceText } from "./source-evidence-text";
import { useToast } from "./toast-provider";

function Comparison({
  label,
  left,
  right,
}: {
  label: string;
  left: string | null;
  right: string | null;
}) {
  const different = left !== right;
  return (
    <div
      className={`bulk-pair-comparison${different ? " bulk-pair-comparison--different" : ""}`}
    >
      <strong>
        {label}
        {different ? <span className="sr-only"> differs</span> : null}
      </strong>
      <span>
        <small>PDF</small>
        {left ?? "Not reported"}
      </span>
      <span>
        <small>SMS</small>
        {right ?? "Not reported"}
      </span>
    </div>
  );
}

export function BulkPairApproval({
  pairs,
  onClose,
  onApproved,
  onIndividual,
}: {
  pairs: BulkPairSelection[];
  onClose: () => void;
  onApproved: (result: BulkApprovalResult) => void;
  onIndividual: (pair: BulkPairSelection) => void;
}) {
  const { notify } = useToast();
  const [preview, setPreview] = useState<BulkApprovalPreview | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [epoch, setEpoch] = useState(0),
    [stale, setStale] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(false);
  const inFlight = useRef(false),
    alive = useRef(true),
    requestId = useRef("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setConfirmed(false);
    setStale(false);
    setFailed(false);
    setRetry(false);
    requestId.current = crypto.randomUUID();
    void previewBulkApproval(token, pairs, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          notify(
            error instanceof Error
              ? error.message
              : "Could not check the selected pairs.",
            "error",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pairs, epoch, notify]);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => setStale(true),
      Math.max(0, new Date(preview.expires_at).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview]);
  async function approve() {
    const token = getAccessToken();
    if (!token || !preview?.token || !confirmed || stale || inFlight.current)
      return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await approveBulkPairs(
        token,
        preview.token,
        requestId.current,
      );
      if (alive.current) onApproved(result);
    } catch (error) {
      if (!alive.current) return;
      const status = (error as { status?: number })?.status;
      if (status === 409 || status === 400 || status === 404) setStale(true);
      else setRetry(true); // Same request ID and token make an interrupted approval safe to retry.
      notify(
        error instanceof Error
          ? error.message
          : "Could not confirm this batch.",
        "error",
      );
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const close = () => {
    if (!inFlight.current) onClose();
  };
  return (
    <ModalDialog
      className="form-drawer bulk-pair-dialog"
      labelledBy="bulk-pair-title"
      onCancel={close}
      busy={busy}
      initialFocus="#bulk-pair-close"
    >
      <header className="form-drawer__header">
        <div>
          <h2 id="bulk-pair-title">Review selected pairs</h2>
          <p>
            Each ready pair becomes one transaction with its SMS and statement
            attached.
          </p>
        </div>
        <button
          id="bulk-pair-close"
          className="icon-button"
          aria-label="Close batch preview"
          type="button"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div className="bulk-pair-body" aria-busy={loading || busy}>
        {loading ? (
          <LoadingState
            label="Checking selected pairs"
            detail="Checking sources, ledger duplicates and saved statement totals"
          />
        ) : null}
        {failed ? (
          <div className="bulk-pair-empty">
            <h3>Preview unavailable</h3>
            <p>Nothing was approved. Your selection is still here.</p>
            <button
              className="button"
              onClick={() => setEpoch((value) => value + 1)}
            >
              Retry preview
            </button>
          </div>
        ) : null}
        {preview ? (
          <>
            <div className="bulk-pair-summary" role="status">
              <span>
                <strong>{pairs.length}</strong> selected
              </span>
              <span>
                <strong>{preview.ready_count}</strong> ready
              </span>
              <span>
                <strong>{preview.needs_review}</strong> need individual review
              </span>
            </div>
            <p className="inline-note">
              Only ready pairs will be approved. Rows needing review stay
              pending. A fresh server check runs before anything is saved.
            </p>
            <div className="bulk-pair-totals">
              {Object.entries(preview.totals).map(([currency, totals]) => (
                <div key={currency}>
                  <strong>{currency}</strong>
                  <span>Money out {totals.debit}</span>
                  <span>Money in {totals.credit}</span>
                  <span>Internal transfers {totals.transfer}</span>
                </div>
              ))}
            </div>
            <div className="bulk-pair-items">
              {preview.items.map((item) => (
                <article className="bulk-pair-item" key={item.id}>
                  <header>
                    <div>
                      <strong>
                        {item.statement.description || item.sms.description || "Money movement"}
                      </strong>
                      <span>
                        {item.statement.account_name}
                        {item.other_account
                          ? ` → ${item.other_account.name}`
                          : ""} ·{" "}
                        {item.category?.name ?? "Category needed"} ·{" "}
                        {item.statement.direction}
                      </span>
                    </div>
                    <span
                      className={`status-badge ${item.ready ? "status-badge--ok" : "status-badge--warning"}`}
                    >
                      {item.ready ? "Ready" : "Needs review"}
                    </span>
                  </header>
                  <div className="bulk-pair-fields">
                    <Comparison
                      label="Reporting account"
                      left={item.statement.account_name}
                      right={item.sms.account_name}
                    />
                    <Comparison
                      label="Debit / credit"
                      left={item.statement.direction}
                      right={item.sms.direction}
                    />
                    <Comparison
                      label="Amount"
                      left={
                        item.statement.amount === null
                          ? null
                          : `${item.statement.currency} ${item.statement.amount}`
                      }
                      right={
                        item.sms.amount === null
                          ? null
                          : `${item.sms.currency} ${item.sms.amount}`
                      }
                    />
                    <Comparison
                      label="Transaction date"
                      left={formatCalendarDate(item.statement.date)}
                      right={formatCalendarDate(item.sms.date)}
                    />
                    <Comparison
                      label="Type"
                      left={item.statement.type.replaceAll("_", " ")}
                      right={item.sms.type.replaceAll("_", " ")}
                    />
                    <Comparison
                      label="Reported balance after"
                      left={item.statement.balance_after}
                      right={item.sms.balance_after}
                    />
                  </div>
                  <p className="bulk-pair-result">
                    {item.ready
                      ? `Record ${item.statement.currency} ${item.statement.amount} once · balance ${item[item.balance_source].balance_after ?? "unknown"}. Both source reports remain attached.`
                      : "No transaction will be recorded for this pair."}
                  </p>
                  {item.blockers.length ? (
                    <ul className="bulk-pair-blockers">
                      {item.blockers.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null}
                  <details>
                    <summary>Compare source details</summary>
                    <div className="bulk-pair-source-details">
                      <section>
                        <h4>Statement</h4>
                        <p>
                          {formatCalendarDate(item.statement.date)} ·{" "}
                          {formatClockTime(item.statement.time)}
                        </p>
                        <p>
                          Reference:{" "}
                          {item.statement.reference || "Not reported"}
                        </p>
                        <SourceEvidenceText
                          text={item.statement_text}
                          facts={{
                            amount: item.statement.amount,
                            balanceAfter: item.statement.balance_after,
                            direction: item.statement.direction,
                            date: item.statement.date,
                            valueDate: item.statement.value_date,
                            reference: item.statement.reference,
                          }}
                        />
                      </section>
                      <section>
                        <h4>SMS</h4>
                        <p>
                          {formatCalendarDate(item.sms.date)} · received{" "}
                          {formatClockTime(item.sms.time)}
                        </p>
                        <p>Reference: {item.sms.reference || "Not reported"}</p>
                        <SourceEvidenceText
                          text={
                            item.sms_text ||
                            "Original SMS text is unavailable or was redacted."
                          }
                          facts={{
                            amount: item.sms.amount,
                            balanceAfter: item.sms.balance_after,
                            direction: item.sms.direction,
                            date: item.sms.date,
                            reference: item.sms.reference,
                          }}
                        />
                      </section>
                    </div>
                    <p className="field__hint">
                      Source excerpts are limited to 1,200 characters.
                      Individual review shows the full evidence. SMS receipt
                      times can differ; the saved statement time is retained.
                    </p>
                  </details>
                  {!item.ready ? (
                    <button
                      className="button button--ghost button--small"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        onIndividual({
                          statement: item.statement.id,
                          sms: item.sms.id,
                        })
                      }
                    >
                      Review this pair individually
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
            {stale ? (
              <div className="bulk-pair-refresh" role="status">
                <strong>Refresh this preview before approving.</strong>
                <span>
                  Source values or eligibility may have changed. Nothing from a
                  failed approval group is saved.
                </span>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setEpoch((value) => value + 1)}
                >
                  Refresh preview
                </button>
              </div>
            ) : null}
            {retry ? (
              <p role="status" className="inline-note">
                Confirmation was interrupted. Retry uses the same request and
                cannot record this batch twice.
              </p>
            ) : null}
            {preview.ready_count > 0 ? (
              <label className="bulk-pair-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || stale}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the {preview.ready_count} ready pairs and approve
                  recording each once.
                </span>
              </label>
            ) : (
              <p className="inline-note">
                No selected pairs qualify yet. Open individual review to resolve
                the listed issues.
              </p>
            )}
            <p className="field__hint">
              Undo batch is available for the latest action for 24 hours, while
              its entries remain unchanged. Your existing SMS retention policy
              still applies; Undo cannot recover redacted text.
            </p>
          </>
        ) : null}
      </div>
      <footer className="form-drawer__footer">
        <button
          className="button button--ghost"
          disabled={busy}
          onClick={close}
        >
          Back to matches
        </button>
        <button
          className="button button--primary"
          disabled={loading || busy || stale || !confirmed || !preview?.token}
          onClick={() => void approve()}
        >
          {busy ? (
            <ButtonBusy label="Approving batch" />
          ) : retry ? (
            "Retry approval"
          ) : (
            `Approve ready${preview ? ` (${preview.ready_count})` : ""}`
          )}
        </button>
      </footer>
    </ModalDialog>
  );
}
