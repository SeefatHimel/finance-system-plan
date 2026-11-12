"use client";

import { useEffect, useRef, useState } from "react";
import { X, ArrowsMerge } from "@phosphor-icons/react";
import { ModalDialog } from "./modal-dialog";
import { LoadingState } from "./loading-state";
import { useToast } from "./toast-provider";
import { useTransactionRecovery } from "./transaction-recovery";
import { getAccessToken } from "@/lib/auth-storage";
import {
  duplicateCandidates,
  previewDuplicateMerge,
  mergeDuplicates,
  type MergeEntry,
  type MergePreview,
} from "@/lib/duplicate-merge-api";
import {
  formatCalendarDate,
  formatCurrency,
  displayLabel,
} from "../../finance-contracts/presentation";

export function DuplicateMergeDialog({
  anchorId,
  initialIds,
  statementRow,
  onClose,
  onMerged,
}: {
  anchorId: string;
  initialIds?: string[];
  statementRow?: string;
  onClose: () => void;
  onMerged: (id: string) => void;
}) {
  const [entries, setEntries] = useState<MergeEntry[]>([]);
  const [selected, setSelected] = useState<string[]>(initialIds ?? [anchorId]);
  const [keep, setKeep] = useState(anchorId);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const request = useRef("");
  const saving = useRef(false);
  const { notify } = useToast();
  const { announce } = useTransactionRecovery();
  const initialKey = (initialIds ?? [anchorId]).join(",");
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setPreview(null);
    setConfirmed(false);
    const ids = initialKey.split(",");
    void Promise.all([
      duplicateCandidates(token, anchorId, controller.signal),
      ids.length > 1
        ? previewDuplicateMerge(
            token,
            { transactions: ids, keep: anchorId, statement_row: statementRow },
            controller.signal,
          )
        : Promise.resolve(null),
    ])
      .then(([choices, result]) => {
        if (controller.signal.aborted) return;
        const all = [
          ...(result?.entries ?? []),
          choices.entry,
          ...choices.candidates,
        ];
        setEntries([...new Map(all.map((item) => [item.id, item])).values()]);
        setSelected(ids);
        setKeep(anchorId);
        setPreview(result);
        request.current = crypto.randomUUID();
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          notify(
            error instanceof Error
              ? error.message
              : "Could not load duplicate entries.",
            "error",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [anchorId, initialKey, statementRow, revision, notify]);
  function invalidate() {
    setPreview(null);
    setConfirmed(false);
  }
  async function review() {
    const token = getAccessToken();
    if (!token || busy) return;
    setBusy(true);
    invalidate();
    try {
      const result = await previewDuplicateMerge(token, {
        transactions: selected,
        keep,
        statement_row: statementRow,
      });
      setPreview(result);
      request.current = crypto.randomUUID();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not preview this merge.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const token = getAccessToken();
    if (!token || !preview || !confirmed || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const result = await mergeDuplicates(token, {
        transactions: selected,
        keep,
        statement_row: statementRow,
        preview_token: preview.preview_token,
        request_id: request.current,
        confirmed,
      });
      announce(result.undo_action);
      window.dispatchEvent(new Event("finance:transactions-changed"));
      onMerged(result.transaction);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Could not merge these entries.",
        "error",
      );
      setConfirmed(false);
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 409
      )
        setPreview(null);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const kept = preview?.entries.find((item) => item.id === keep);
  return (
    <ModalDialog
      className="duplicate-merge-dialog"
      labelledBy="duplicate-merge-title"
      busy={busy}
      onCancel={onClose}
    >
      <header className="duplicate-merge-header">
        <div>
          <h2 id="duplicate-merge-title">Merge duplicate entries</h2>
          <p>One money movement. Keep every original source.</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close merge review"
          disabled={busy}
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </header>
      <div className="duplicate-merge-body" aria-busy={loading || busy}>
        {loading ? (
          <LoadingState
            compact
            label="Checking duplicate entries"
            detail="Loading saved entries and original evidence"
          />
        ) : failed ? (
          <div className="empty-state">
            <p>Duplicate entries could not be loaded.</p>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry duplicate review
            </button>
          </div>
        ) : (
          <>
            <fieldset disabled={busy}>
              <legend>1. Choose entries for the same movement</legend>
              <p className="inline-note">
                Similar amounts and dates are suggestions. Repeated purchases
                can be separate movements.
              </p>
              <div className="duplicate-merge-choices">
                {entries.map((item) => (
                  <label
                    key={item.id}
                    className={selected.includes(item.id) ? "is-selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      disabled={
                        item.id === anchorId ||
                        (!selected.includes(item.id) && selected.length >= 10)
                      }
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...selected, item.id]
                          : selected.filter((id) => id !== item.id);
                        setSelected(next);
                        if (!next.includes(keep)) setKeep(anchorId);
                        invalidate();
                      }}
                    />
                    <span>
                      <strong>
                        {item.description ||
                          item.note ||
                          displayLabel(item.type)}
                      </strong>
                      <small>
                        {formatCalendarDate(item.date)} ·{" "}
                        {item.time ?? "Time unknown"} ·{" "}
                        {item.source.toUpperCase()}
                      </small>
                      <small>
                        {item.account_name}
                        {item.transfer_account_name
                          ? ` → ${item.transfer_account_name}`
                          : ""}
                      </small>
                    </span>
                    <strong>
                      {item.direction === "credit" ? "+" : "−"}
                      {formatCurrency(item.amount, item.currency)}
                    </strong>
                  </label>
                ))}
              </div>
              {entries.length < 2 ? (
                <p>
                  No similar entries found in the three-day window. Nothing has
                  changed.
                </p>
              ) : null}
            </fieldset>
            {selected.length > 1 ? (
              <fieldset disabled={busy}>
                <legend>2. Choose the entry whose saved values to keep</legend>
                <p className="inline-note">
                  This chooses the final date, type, note, category, reference
                  and balance. The other saved versions remain in source
                  history.
                </p>
                <div className="duplicate-merge-keepers">
                  {entries
                    .filter((item) => selected.includes(item.id))
                    .map((item) => (
                      <label key={item.id}>
                        <input
                          type="radio"
                          name="merge-keeper"
                          checked={keep === item.id}
                          onChange={() => {
                            setKeep(item.id);
                            invalidate();
                          }}
                        />
                        <span>
                          <strong>
                            {item.source.toUpperCase()} ·{" "}
                            {item.description || displayLabel(item.type)}
                          </strong>
                          <small>
                            {formatCalendarDate(item.date)} ·{" "}
                            {item.time ?? "Time unknown"} · Balance{" "}
                            {item.balance_after ?? "not reported"}
                          </small>
                          <small>
                            Note: {item.note || "None"} · Saved reference:{" "}
                            {item.reference || "None"}
                          </small>
                        </span>
                      </label>
                    ))}
                </div>
              </fieldset>
            ) : null}
            {preview ? (
              <section
                aria-label="Merge preview"
                className="duplicate-merge-preview"
              >
                <h3>3. Review the result</h3>
                <div className="duplicate-merge-result">
                  <span>{preview.entries.length} ledger entries</span>
                  <ArrowsMerge size={24} aria-hidden="true" />
                  <strong>
                    1 entry ·{" "}
                    {kept ? formatCurrency(kept.amount, kept.currency) : ""}
                  </strong>
                </div>
                <p>{preview.retained_fields}</p>
                {statementRow ? (
                  <p>
                    The pending statement will also be attached to this entry.
                  </p>
                ) : null}
                {preview.blockers.length ? (
                  <div className="source-differences">
                    <strong>Resolve before merging</strong>
                    <ul>
                      {preview.blockers.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="duplicate-merge-evidence">
                  {preview.entries.map((item) => (
                    <section key={item.id}>
                      <h4>
                        {item.id === keep ? "Keep" : "Merge into kept entry"} ·{" "}
                        {item.source.toUpperCase()}
                      </h4>
                      <dl>
                        {[
                          [
                            "Date / time",
                            `${formatCalendarDate(item.date)} · ${item.time ?? "Unknown"}`,
                            item.date !== kept?.date ||
                              item.time !== kept?.time,
                          ],
                          [
                            "Type",
                            displayLabel(item.type),
                            item.type !== kept?.type,
                          ],
                          [
                            "Reported balance",
                            item.balance_after ?? "Not reported",
                            item.balance_after !== kept?.balance_after,
                          ],
                          [
                            "Saved reference",
                            item.reference || "Not reported",
                            false,
                          ],
                        ].map(([label, value, different]) => (
                          <div
                            key={String(label)}
                            className={
                              different
                                ? "statement-balance-value--conflict"
                                : undefined
                            }
                          >
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <details>
                        <summary>
                          Original sources ({item.sources?.length ?? 0})
                        </summary>
                        {item.sources?.map((source) => (
                          <article key={`${source.kind}-${source.id}`}>
                            <strong>{source.kind}</strong>
                            <p>
                              Transaction ID:{" "}
                              <b>
                                {source.transaction_id || "Not established"}
                              </b>
                              {source.message_reference
                                ? ` · Message reference: ${source.message_reference}`
                                : ""}
                            </p>
                            <p className="duplicate-merge-original">
                              {source.text}
                            </p>
                          </article>
                        ))}
                        {!item.sources?.length ? (
                          <p>
                            No captured source attached; the original ledger
                            values will be archived.
                          </p>
                        ) : null}
                      </details>
                    </section>
                  ))}
                </div>
                {preview.statement ? (
                  <details>
                    <summary>Statement being attached</summary>
                    <p>
                      Transaction ID:{" "}
                      {preview.statement.transaction_id || "Not established"}
                    </p>
                    <p className="duplicate-merge-original">
                      {preview.statement.text}
                    </p>
                  </details>
                ) : null}
                <label className="duplicate-merge-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || preview.blockers.length > 0}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I compared the originals. These entries are the same
                    movement; keep the selected values and count the amount
                    once.
                  </span>
                </label>
                <p className="inline-note">
                  {preview.removed_count} duplicate ledger{" "}
                  {preview.removed_count === 1 ? "entry" : "entries"} will be
                  removed. Original SMS, PDF and spreadsheet evidence stays
                  attached. Undo is available for the latest action for 24 hours
                  while its records remain unchanged.
                </p>
              </section>
            ) : null}
          </>
        )}
      </div>
      <footer className="duplicate-merge-footer">
        <button
          className="button button--ghost"
          type="button"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="button button--ghost"
          type="button"
          disabled={busy || loading || selected.length < 2 || failed}
          onClick={() => void review()}
        >
          {busy ? "Checking…" : preview ? "Refresh preview" : "Review merge"}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={
            busy || !preview || !confirmed || preview.blockers.length > 0
          }
          onClick={() => void save()}
        >
          {busy ? "Working…" : "Merge · count once"}
        </button>
      </footer>
    </ModalDialog>
  );
}
