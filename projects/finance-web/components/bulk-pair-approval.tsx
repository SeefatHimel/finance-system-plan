"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import {
  formatCalendarDate,
  formatClockTime,
} from "../../finance-contracts/presentation";
import type {
  BulkPairSelection,
  BulkPairInput,
  BulkPairEdits,
} from "../../finance-contracts/unified-bulk";
import { categoryTypeProposal } from "@/lib/category-type";
import type { Category, TransactionType } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import {
  approveBulkPairs,
  verifyStatementAccount,
  type StatementAccountReview,
  previewBulkApproval,
  type BulkApprovalPreview,
  type BulkApprovalResult,
} from "@/lib/bulk-approval-api";
import { ModalDialog } from "./modal-dialog";
import { LoadingState, ButtonBusy } from "./loading-state";
import { StatementOriginalViewer } from "./statement-original-viewer";
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
  categories,
  onClose,
  onApproved,
  onIndividual,
}: {
  pairs: BulkPairSelection[];
  categories: Category[];
  onClose: () => void;
  onApproved: (result: BulkApprovalResult) => void;
  onIndividual: (pair: BulkPairSelection) => void;
}) {
  const { notify } = useToast();
  const [requestPairs, setRequestPairs] = useState<BulkPairInput[]>(pairs);
  const [edits, setEdits] = useState<Record<string, BulkPairEdits>>({});
  const [dirty, setDirty] = useState(false);
  const [groupCategory, setGroupCategory] = useState("");
  const [groupMerchant, setGroupMerchant] = useState("");
  const [accountChecks, setAccountChecks] = useState<Record<string, boolean>>(
    {},
  );
  const [reviewingAccount, setReviewingAccount] = useState<string | null>(null);
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
    void previewBulkApproval(token, requestPairs, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setPreview(value);
          setAccountChecks({});
          setEdits(
            Object.fromEntries(
              value.items.map((item) => [item.id, item.final]),
            ),
          );
          setDirty(false);
        }
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
  }, [requestPairs, epoch, notify]);
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
    if (
      !token ||
      !preview?.token ||
      !confirmed ||
      stale ||
      dirty ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await approveBulkPairs(
        token,
        preview.token,
        requestId.current,
        preview.items
          .filter((item) => item.ready)
          .map((item) => ({
            statement: item.statement.id,
            sms: item.sms.id,
            edits: item.final,
          })),
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
  function changeItem(id: string, change: Partial<BulkPairEdits>) {
    setEdits((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
    setDirty(true);
    setConfirmed(false);
  }
  function recheck() {
    setRequestPairs(
      pairs.map((pair) => ({
        ...pair,
        edits: edits[`${pair.statement}:${pair.sms}`],
      })),
    );
    setEpoch((value) => value + 1);
  }
  async function confirmStatementAccount(item: StatementAccountReview) {
    const token = getAccessToken();
    if (!token || !accountChecks[item.id] || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setReviewingAccount(item.id);
    try {
      await verifyStatementAccount(token, item.token);
      if (alive.current) {
        notify(
          `Reporting account confirmed for this statement: ${item.account_name}.`,
          "success",
        );
        recheck();
      }
    } catch (error) {
      if (alive.current) {
        setStale(true);
        notify(
          error instanceof Error
            ? error.message
            : "Could not confirm the statement account.",
          "error",
        );
      }
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setBusy(false);
        setReviewingAccount(null);
      }
    }
  }
  function applyCategory() {
    const category = categories.find(
      (item) => item.id === groupCategory && item.is_active,
    );
    if (!category || !preview) return;
    const compatibleItems = preview.items.filter(
      (item) =>
        !categoryTypeProposal(category, item.statement.type as TransactionType),
    );
    if (!compatibleItems.length) {
      notify(
        "This category does not fit any selected transaction type.",
        "error",
      );
      return;
    }
    setEdits((current) => {
      const next = { ...current };
      for (const item of compatibleItems) {
        next[item.id] = { ...current[item.id], category: category.id };
      }
      return next;
    });
    setDirty(true);
    setConfirmed(false);
  }
  function applyMerchant() {
    const merchant = groupMerchant.trim();
    if (!merchant || !preview) return;
    setEdits((current) => {
      const next = { ...current };
      for (const item of preview.items) {
        next[item.id] = { ...current[item.id], description: merchant };
      }
      return next;
    });
    setDirty(true);
    setConfirmed(false);
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
                <strong>{preview.ready_count}</strong>{" "}
                {dirty ? "previously ready · recheck" : "ready"}
              </span>
              <span>
                <strong>{preview.needs_review}</strong> need attention
              </span>
            </div>
            <p className="inline-note">
              Only ready pairs will be approved. Rows needing review stay
              pending with their edits unsaved. A fresh server check runs before
              anything is saved.
            </p>
            {preview.imports.length ? (
              <section
                className="bulk-account-reviews"
                aria-label="Statement reporting account review"
              >
                <h3>Confirm the account once per statement</h3>
                <p className="field__hint">
                  A matching suffix is a hint. Check the original PDF against
                  the selected account. Your confirmation is saved for this
                  import and does not waive transaction conflicts.
                </p>
                {preview.imports.map((item) => (
                  <article className="bulk-account-review" key={item.id}>
                    <header>
                      <strong>{item.account_name}</strong>
                      <span
                        className={`status-badge ${item.verified ? "status-badge--ok" : "status-badge--warning"}`}
                      >
                        {item.verified
                          ? "Account confirmed by you"
                          : "Account confirmation needed"}
                      </span>
                    </header>
                    <p>
                      Statement account: {item.account_hint} ·{" "}
                      {item.profile.replaceAll("_", " ")}
                    </p>
                    {item.verified ? (
                      <p className="field__hint">
                        Saved for this statement. Its transactions still undergo
                        their own checks.
                      </p>
                    ) : (
                      <>
                        {item.has_original_file ? (
                          <details>
                            <summary>Check original PDF</summary>
                            <StatementOriginalViewer batchId={item.id} />
                          </details>
                        ) : (
                          <p className="field__hint">
                            No PDF is archived for this import. Check your
                            original copy before confirming.
                          </p>
                        )}
                        <label className="bulk-pair-confirm">
                          <input
                            type="checkbox"
                            disabled={busy || retry}
                            checked={accountChecks[item.id] ?? false}
                            onChange={(event) =>
                              setAccountChecks((current) => ({
                                ...current,
                                [item.id]: event.target.checked,
                              }))
                            }
                          />
                          <span>
                            I checked the original statement and confirm it
                            belongs to {item.account_name} ({item.account_hint}
                            ).
                          </span>
                        </label>
                        <button
                          type="button"
                          className="button button--primary button--small"
                          disabled={!accountChecks[item.id] || busy || retry}
                          onClick={() => void confirmStatementAccount(item)}
                        >
                          {reviewingAccount === item.id ? (
                            <ButtonBusy label="Confirming account" />
                          ) : (
                            "Confirm account and recheck"
                          )}
                        </button>
                      </>
                    )}
                  </article>
                ))}
              </section>
            ) : null}
            <details className="bulk-pair-group-tools">
              <summary>Set category or merchant for selected pairs</summary>
              <div className="bulk-pair-group-edit">
                <label className="field">
                  <span className="field__label">
                    Category for compatible selected pairs
                  </span>
                  <select
                    className="field__control"
                    value={groupCategory}
                    disabled={busy || retry}
                    onChange={(event) => setGroupCategory(event.target.value)}
                  >
                    <option value="">Choose a category</option>
                    {categories
                      .filter((category) => category.is_active)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button button--ghost"
                  disabled={!groupCategory || busy || retry}
                  onClick={applyCategory}
                >
                  Apply category to compatible pairs
                </button>
              </div>
              <div className="bulk-pair-group-edit">
                <label className="field">
                  <span className="field__label">
                    Merchant / counterparty for all {pairs.length} selected
                    pairs
                  </span>
                  <input
                    className="field__control"
                    placeholder="For example, Pathao Pay"
                    maxLength={255}
                    value={groupMerchant}
                    disabled={busy || retry}
                    onChange={(event) => setGroupMerchant(event.target.value)}
                  />
                </label>
                <button
                  className="button button--ghost"
                  disabled={!groupMerchant.trim() || busy || retry}
                  onClick={applyMerchant}
                >
                  Apply merchant to {pairs.length} selected pairs
                </button>
              </div>
              <p className="field__hint">
                Applies to this selection only. Notes and original source
                wording stay unchanged.
              </p>
            </details>
            <p className="field__hint">
              Category, merchant and notes can change here. Financial values
              stay fixed. Recheck changes before approving; original sources
              stay unchanged.
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
                        {item.statement.description ||
                          item.sms.description ||
                          "Money movement"}
                      </strong>
                      <span>
                        {item.statement.account_name}
                        {item.other_account
                          ? ` → ${item.other_account.name}`
                          : ""}{" "}
                        · {item.category?.name ?? "Category needed"} ·{" "}
                        {item.statement.direction}
                      </span>
                    </div>
                    <span
                      className={`status-badge ${item.ready ? "status-badge--ok" : "status-badge--warning"}`}
                    >
                      {dirty
                        ? "Recheck changes"
                        : item.ready
                          ? "Ready"
                          : "Needs review"}
                    </span>
                  </header>
                  <section
                    className="bulk-pair-final"
                    aria-label={`Final transaction for ${item.statement.description}`}
                  >
                    <strong>Final transaction</strong>
                    <div className="bulk-pair-final__facts">
                      <span>
                        {item.statement.currency} {item.statement.amount} ·{" "}
                        {item.statement.direction} ·{" "}
                        {item.statement.type.replaceAll("_", " ")}
                      </span>
                      <span>
                        {item.statement.account_name}
                        {item.other_account
                          ? ` → ${item.other_account.name}`
                          : ""}
                      </span>
                      <span>
                        {formatCalendarDate(item.statement.date)} ·{" "}
                        {formatClockTime(item.statement.time)}
                      </span>
                      <span>
                        Reported balance after:{" "}
                        {item[item.balance_source].balance_after ??
                          "Not reported"}
                      </span>
                    </div>
                    <div className="bulk-pair-edit-fields">
                      <label className="field">
                        <span className="field__label">
                          Category
                          {item.category_origin === "suggested"
                            ? " · suggested"
                            : ""}
                        </span>
                        <select
                          className="field__control"
                          aria-label={`Category for ${item.statement.description}`}
                          disabled={busy || retry}
                          value={edits[item.id]?.category ?? ""}
                          onChange={(event) =>
                            changeItem(item.id, {
                              category: event.target.value || null,
                            })
                          }
                        >
                          <option value="">Choose a category</option>
                          {categories
                            .filter(
                              (category) =>
                                category.is_active &&
                                !categoryTypeProposal(
                                  category,
                                  item.statement.type as TransactionType,
                                ),
                            )
                            .map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field__label">
                          Merchant / counterparty
                        </span>
                        <input
                          className="field__control"
                          aria-label={`Merchant or counterparty for ${item.statement.description}`}
                          maxLength={255}
                          disabled={busy || retry}
                          value={edits[item.id]?.description ?? ""}
                          onChange={(event) =>
                            changeItem(item.id, {
                              description: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field bulk-pair-edit-note">
                        <span className="field__label">Notes</span>
                        <textarea
                          className="field__control"
                          aria-label={`Notes for ${item.statement.description}`}
                          rows={2}
                          maxLength={4000}
                          disabled={busy || retry}
                          value={edits[item.id]?.note ?? ""}
                          onChange={(event) =>
                            changeItem(item.id, { note: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </section>
                  <details>
                    <summary>Compare PDF and SMS values</summary>
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
                  </details>
                  <p className="bulk-pair-result">
                    {dirty
                      ? "Changes are not saved. Recheck this preview to update eligibility and totals."
                      : item.ready
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
            {stale || dirty ? (
              <div className="bulk-pair-refresh" role="status">
                <strong>
                  {dirty
                    ? "Recheck your changes before approving."
                    : "Refresh this preview before approving."}
                </strong>
                <span>
                  Source values or eligibility may have changed. Nothing from a
                  failed approval group is saved.
                </span>
                <span>Use the preview button below to run fresh checks.</span>
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
                  disabled={busy || stale || dirty}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the {preview.ready_count} ready{" "}
                  {preview.ready_count === 1 ? "pair" : "pairs"} and approve
                  recording each once.
                </span>
              </label>
            ) : (
              <p className="inline-note">
                {preview.imports.some((item) => !item.verified)
                  ? "Confirm the statement reporting account above, then recheck the pairs. Other listed conflicts may still need individual review."
                  : "No selected pairs qualify yet. Resolve the listed issues and recheck; financial conflicts require individual review."}
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
        {dirty || stale ? (
          <button
            className="button button--primary"
            disabled={loading || busy}
            onClick={recheck}
          >
            {dirty ? "Recheck changes" : "Refresh preview"}
          </button>
        ) : (
          <button
            className="button button--primary"
            disabled={loading || busy || !confirmed || !preview?.token}
            onClick={() => void approve()}
          >
            {busy ? (
              <ButtonBusy
                label={
                  reviewingAccount ? "Confirming account" : "Approving batch"
                }
              />
            ) : retry ? (
              "Retry approval"
            ) : (
              `Approve ready${preview ? ` (${preview.ready_count})` : ""}`
            )}
          </button>
        )}
      </footer>
    </ModalDialog>
  );
}
