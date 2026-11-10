"use client";
import type { Account, Category } from "@/lib/api";
import type {
  BulkConfiguration,
  BulkRowDecision,
} from "../../finance-contracts/bulk-import";
import type { BulkPreview, BulkRow } from "@/lib/bulk-import-api";
import {
  formatCalendarDate,
  formatCurrency,
  displayLabel,
} from "../../finance-contracts/presentation";
import { ClockTimeInput } from "./clock-time-input";
import { CalendarDateInput } from "./calendar-date-input";
import { useMemo, useState } from "react";
import { useToast } from "./toast-provider";
const kinds = [
  "expense",
  "refund",
  "income",
  "transfer",
  "fee",
  "adjustment",
  "lend",
  "borrow",
  "repayment_paid",
  "repayment_received",
];
type Props = {
  preview: BulkPreview;
  config: BulkConfiguration;
  accounts: Account[];
  categories: Category[];
  currency: string;
  busy: string;
  onChange: (update: Partial<BulkConfiguration>) => void;
};
export function BulkImportEntryList({
  preview,
  config,
  accounts,
  categories,
  currency,
  busy,
  onChange: edit,
}: Props) {
  const [page, setPage] = useState(1);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const { notify } = useToast();
  const visible = useMemo(
    () =>
      preview.rows.filter(
        (r) => !issuesOnly || r.errors.length || r.warnings.length,
      ),
    [preview, issuesOnly],
  );
  const lastPage = Math.max(1, Math.ceil(visible.length / 25));
  function decision(row: BulkRow, update: BulkRowDecision) {
    if (!config) return;
    edit({
      decisions: {
        ...config.decisions,
        [row.number]: {
          ...config.decisions[row.number],
          reviewed: false,
          ...update,
          ...(update.reviewed
            ? { review_fingerprint: row.review_fingerprint }
            : {}),
        },
      },
    });
  }
  return (
    <>
      <div className="bulk-import-row-toolbar">
        <h3>Entries</h3>
        <label>
          <input
            type="checkbox"
            checked={issuesOnly}
            onChange={(e) => {
              setIssuesOnly(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Only highlighted rows
        </label>
        <button
          className="button button--ghost button--small"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            const decisions = { ...config.decisions };
            for (const row of preview.rows)
              if (row.warnings.length)
                decisions[row.number] = {
                  ...decisions[row.number],
                  reviewed: true,
                  review_fingerprint: row.review_fingerprint,
                };
            edit({ decisions });
            notify(
              "Highlighted details marked reviewed. Refresh the preview to validate your choices.",
            );
          }}
        >
          Mark highlighted details reviewed
        </button>
      </div>
      <p className="muted-text">
        Compare possible matches before linking. Reviewing a warning does not
        choose a match or remove repeated purchases.
      </p>
      <div className="bulk-import-rows">
        {visible
          .slice(
            (Math.min(page, lastPage) - 1) * 25,
            Math.min(page, lastPage) * 25,
          )
          .map((row) => {
            const d = config.decisions[row.number] ?? {};
            const action = d.action ?? row.action;
            const v = row.values;
            const selectedCategoryId = Object.hasOwn(d, "category")
              ? d.category
              : v?.category;
            const selectedCategory = categories.find(
              (c) => c.id === selectedCategoryId,
            );
            const suggested =
              row.category_suggestion?.method === "alias" &&
              !Object.hasOwn(d, "category") &&
              !Object.hasOwn(config.category_map, row.source_category);
            const reviewed = d.reviewed ?? row.reviewed;
            return (
              <article
                className={`bulk-import-row${row.errors.length && action !== "skip" ? " bulk-import-row--review" : ""}${action === "skip" ? " bulk-import-row--skipped" : ""}`}
                key={row.number}
              >
                <div className="bulk-import-row-main">
                  <span className="bulk-import-row-number">{row.number}</span>
                  <div className="bulk-import-row-text">
                    <strong>
                      {d.description ??
                        v?.description ??
                        Object.values(row.original)[1] ??
                        "Imported entry"}
                    </strong>
                    <small>
                      {v?.date ? formatCalendarDate(v.date) : "Check date"} ·{" "}
                      {v?.time ?? "Time unknown"}
                      {row.source_category ? ` · ${row.source_category}` : ""}
                      {selectedCategory &&
                      selectedCategory.name !== row.source_category
                        ? ` → ${selectedCategory.name}`
                        : ""}
                    </small>
                  </div>
                  <strong
                    className={`bulk-import-money bulk-import-money--${d.direction ?? v?.direction ?? "debit"}`}
                  >
                    {v?.amount
                      ? `${v.direction === "credit" ? "+" : "−"}${formatCurrency(v.amount, currency)}`
                      : "Amount needed"}
                  </strong>
                  <label className="field">
                    <span className="sr-only">Action for row {row.number}</span>
                    <select
                      className="field__control"
                      value={action}
                      onChange={(e) =>
                        decision(row, {
                          action: e.target.value as "new" | "skip" | "link",
                          reviewed: false,
                        })
                      }
                    >
                      <option value="new">Add entry</option>
                      {row.matches.length ? (
                        <option value="link">Link existing</option>
                      ) : null}
                      <option value="skip">Skip row</option>
                    </select>
                  </label>
                </div>
                {action !== "skip" && row.errors.length ? (
                  <ul className="bulk-import-warning">
                    {row.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                <details className="bulk-import-disclosure">
                  <summary>
                    {row.matches.length
                      ? `${row.matches.length} possible ${row.matches.length === 1 ? "match" : "matches"} · `
                      : ""}
                    Edit / compare source{" "}
                    {row.warnings.length
                      ? `· ${reviewed ? "Reviewed" : "Review details"}`
                      : ""}
                  </summary>
                  {row.warnings.length ? (
                    <ul className="bulk-import-warning">
                      {row.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  {action === "link" ? (
                    <p className="muted-text">
                      Linking adds this table as evidence. The existing
                      transaction&apos;s description, notes and category stay
                      unchanged.
                    </p>
                  ) : null}
                  {row.matches.map((match) => (
                    <label className="bulk-import-match" key={match.id}>
                      <input
                        type="radio"
                        name={`match-${row.number}`}
                        checked={
                          action === "link" &&
                          (d.transaction ?? row.transaction) === match.id
                        }
                        onChange={() =>
                          decision(row, {
                            action: "link",
                            transaction: match.id,
                            reviewed: false,
                          })
                        }
                      />
                      <span>
                        <strong>
                          {match.description || displayLabel(match.type)}
                        </strong>
                        <small>
                          {formatCalendarDate(match.date)} ·{" "}
                          {match.time ?? "Time unknown"} ·{" "}
                          {match.source_labels.length
                            ? match.source_labels.join(" + ")
                            : displayLabel(match.source)}{" "}
                          · {displayLabel(match.type)}
                        </small>
                        <span>{match.note}</span>
                        <small>
                          Amount: {formatCurrency(match.amount, currency)} ·
                          Reported balance:{" "}
                          {match.balance_after === null
                            ? "Not reported"
                            : formatCurrency(match.balance_after, currency)}
                        </small>
                      </span>
                    </label>
                  ))}
                  <div className="bulk-import-grid">
                    <label className="field">
                      <span
                        className="field__label"
                        id={`bulk-description-label-${row.number}`}
                      >
                        Description for row {row.number}
                      </span>
                      <input
                        className="field__control"
                        maxLength={255}
                        aria-labelledby={`bulk-description-label-${row.number}`}
                        aria-describedby={`bulk-description-hint-${row.number}`}
                        value={d.description ?? v?.description ?? ""}
                        onChange={(e) =>
                          decision(row, { description: e.target.value })
                        }
                      />
                      <small
                        className="muted-text"
                        id={`bulk-description-hint-${row.number}`}
                      >
                        Short title shown in the transaction list.
                      </small>
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Amount for row {row.number}
                      </span>
                      <input
                        className="field__control"
                        inputMode="decimal"
                        value={d.amount ?? v?.amount ?? ""}
                        onChange={(e) =>
                          decision(row, {
                            amount: e.target.value,
                            type: d.type ?? v?.type,
                            direction: d.direction ?? v?.direction,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Date for row {row.number}
                      </span>
                      <CalendarDateInput
                        value={d.date ?? v?.date ?? ""}
                        onChange={(date) => decision(row, { date })}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Time for row {row.number} (optional)
                      </span>
                      <ClockTimeInput
                        aria-label={`Time for row ${row.number} (optional)`}
                        value={d.time ?? v?.time ?? ""}
                        onValueChange={(time) => decision(row, { time })}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Type for row {row.number}
                      </span>
                      <select
                        className="field__control"
                        value={d.type ?? v?.type ?? "expense"}
                        onChange={(e) =>
                          decision(row, { type: e.target.value })
                        }
                      >
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {displayLabel(k)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Direction for row {row.number}
                      </span>
                      <select
                        className="field__control"
                        value={d.direction ?? v?.direction ?? "debit"}
                        onChange={(e) =>
                          decision(row, {
                            direction: e.target.value as "debit" | "credit",
                          })
                        }
                      >
                        <option value="debit">Money out · debit</option>
                        <option value="credit">Money in · credit</option>
                      </select>
                    </label>
                    <label className="field">
                      <span
                        className="field__label"
                        id={`bulk-row-category-label-${row.number}`}
                      >
                        Category for row {row.number}
                      </span>
                      <select
                        className="field__control"
                        value={selectedCategoryId ?? ""}
                        aria-labelledby={`bulk-row-category-label-${row.number}`}
                        aria-describedby={
                          suggested
                            ? `bulk-row-category-hint-${row.number}`
                            : undefined
                        }
                        onChange={(e) =>
                          decision(row, {
                            category: e.target.value || null,
                          })
                        }
                      >
                        <option value="">Uncategorized</option>
                        {categories
                          .filter((c) => c.is_active)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                      {suggested ? (
                        <small
                          className="bulk-import-suggestion"
                          id={`bulk-row-category-hint-${row.number}`}
                        >
                          Suggested from “{row.source_category}”. You can change
                          it.
                        </small>
                      ) : null}
                    </label>
                    {(d.type ?? v?.type) === "transfer" ? (
                      <label className="field">
                        <span className="field__label">
                          Other account for row {row.number}
                        </span>
                        <select
                          className="field__control"
                          value={d.other_account ?? v?.other_account ?? ""}
                          onChange={(e) =>
                            decision(row, {
                              other_account: e.target.value || null,
                            })
                          }
                        >
                          <option value="">Choose other account</option>
                          {accounts
                            .filter(
                              (a) =>
                                a.id !== preview.account &&
                                a.currency === currency &&
                                a.is_active,
                            )
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <label className="field bulk-import-notes">
                    <span
                      className="field__label"
                      id={`bulk-notes-label-${row.number}`}
                    >
                      Notes for row {row.number}
                    </span>
                    <textarea
                      className="field__control"
                      rows={3}
                      maxLength={4000}
                      aria-labelledby={`bulk-notes-label-${row.number}`}
                      aria-describedby={`bulk-notes-hint-${row.number}`}
                      value={d.notes ?? v?.notes ?? ""}
                      onChange={(e) => decision(row, { notes: e.target.value })}
                    />
                    <small
                      className="muted-text"
                      id={`bulk-notes-hint-${row.number}`}
                    >
                      {action === "link"
                        ? "Saved with this import’s reviewed details; the existing transaction’s note is kept."
                        : "Extra context saved as the ledger note. The original spreadsheet stays unchanged."}
                    </small>
                  </label>
                  <details>
                    <summary>Original table row · unchanged</summary>
                    <dl className="bulk-import-original">
                      {Object.entries(row.original).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  {row.warnings.length ? (
                    <label className="bulk-import-review-check">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) =>
                          decision(row, { reviewed: e.target.checked })
                        }
                      />{" "}
                      I reviewed this row and its chosen action.
                    </label>
                  ) : null}
                </details>
              </article>
            );
          })}
      </div>
      <div className="bulk-import-pagination">
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={page <= 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Previous rows
        </button>
        <span>
          Page {Math.min(page, lastPage)} of {lastPage} · {visible.length} rows
        </span>
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={page >= lastPage}
          onClick={() => setPage((n) => n + 1)}
        >
          Next rows
        </button>
      </div>
    </>
  );
}
