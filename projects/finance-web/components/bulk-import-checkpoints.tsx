"use client";
import type {
  BulkConfiguration,
  BulkCheckpointInput,
} from "../../finance-contracts/bulk-import";
import type { BulkPreview } from "@/lib/bulk-import-api";
import { formatCurrency } from "../../finance-contracts/presentation";
import { ClockTimeInput } from "./clock-time-input";
import { CalendarDateInput } from "./calendar-date-input";

type Props = {
  preview: BulkPreview;
  config: BulkConfiguration;
  currency: string;
  onChange: (update: Partial<BulkConfiguration>) => void;
};
export function BulkImportCheckpoints({
  preview,
  config,
  currency,
  onChange: edit,
}: Props) {
  function checkpoint(index: number, update: Partial<BulkCheckpointInput>) {
    if (config)
      edit({
        checkpoints: config.checkpoints.map((c, i) =>
          i === index ? { ...c, ...update } : c,
        ),
      });
  }
  return (
    <section className="bulk-import-checkpoints">
      <div className="bulk-import-row-toolbar">
        <div>
          <h3>Wallet balance checkpoints</h3>
          <p className="muted-text">
            Optional. Counted cash is compared with the ledger; it never creates
            an expense or income. Time zone: {preview.timezone}.
          </p>
        </div>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() =>
            edit({
              checkpoints: [
                ...config.checkpoints,
                {
                  date: "",
                  balance: "",
                  end_of_day: false,
                  unknown_position: "unresolved",
                  exceptions: {},
                  note: "",
                },
              ],
            })
          }
        >
          Add balance checkpoint
        </button>
      </div>
      {config.checkpoints.map((c, index) => {
        const check = preview.checkpoints[index];
        return (
          <article className="bulk-import-checkpoint" key={index}>
            <div className="bulk-import-grid">
              <label className="field">
                <span className="field__label">Balance date {index + 1}</span>
                <CalendarDateInput
                  value={c.date}
                  onChange={(date) => checkpoint(index, { date })}
                />
              </label>
              <label className="field">
                <span className="field__label">
                  Counted balance {index + 1} ({currency})
                </span>
                <input
                  className="field__control"
                  inputMode="decimal"
                  value={c.balance}
                  onChange={(e) =>
                    checkpoint(index, { balance: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">
                  Balance time {index + 1} (optional)
                </span>
                <ClockTimeInput
                  aria-label={`Balance time ${index + 1} (optional)`}
                  disabled={c.end_of_day}
                  value={c.time ?? ""}
                  onValueChange={(value) =>
                    checkpoint(index, { time: value || null })
                  }
                />
              </label>
              <label className="bulk-import-review-check">
                <input
                  type="checkbox"
                  checked={c.end_of_day}
                  onChange={(e) =>
                    checkpoint(index, {
                      end_of_day: e.target.checked,
                      time: null,
                    })
                  }
                />{" "}
                This is the end-of-day balance.
              </label>
            </div>
            {!c.end_of_day && c.time ? (
              <>
                <label className="field">
                  <span className="field__label">
                    Untimed entries on this day happened
                  </span>
                  <select
                    className="field__control"
                    value={c.unknown_position}
                    onChange={(e) =>
                      checkpoint(index, {
                        unknown_position: e.target
                          .value as BulkCheckpointInput["unknown_position"],
                      })
                    }
                  >
                    <option value="unresolved">
                      Choose before or after this balance
                    </option>
                    <option value="before">Before this balance</option>
                    <option value="after">After this balance</option>
                  </select>
                </label>
                <p className="muted-text">
                  This establishes relative order only. Exact transaction times
                  remain unknown.
                </p>
                {check?.unknown.length ? (
                  <details>
                    <summary>
                      Review {check.unknown.length} untimed entries / mark
                      exceptions
                    </summary>
                    {check.unknown.map((u) => (
                      <label className="bulk-import-untimed" key={u.key}>
                        <span>
                          {u.description} · {formatCurrency(u.amount, currency)}
                        </span>
                        <select
                          className="field__control"
                          value={c.exceptions[u.key] ?? c.unknown_position}
                          onChange={(e) =>
                            checkpoint(index, {
                              exceptions: {
                                ...c.exceptions,
                                [u.key]: e.target.value as "before" | "after",
                              },
                            })
                          }
                        >
                          <option value="unresolved" disabled>
                            Choose position
                          </option>
                          <option value="before">Before balance</option>
                          <option value="after">After balance</option>
                        </select>
                      </label>
                    ))}
                  </details>
                ) : null}
              </>
            ) : null}
            <label className="field">
              <span className="field__label">Checkpoint note {index + 1}</span>
              <input
                className="field__control"
                value={c.note}
                maxLength={2000}
                onChange={(e) => checkpoint(index, { note: e.target.value })}
              />
            </label>
            {check?.errors.map((e) => (
              <p className="bulk-import-warning" key={e}>
                {e}
              </p>
            ))}
            {check?.expected_balance !== null &&
            check?.expected_balance !== undefined ? (
              <div
                className={`bulk-import-balance${check.difference !== "0.00" ? " bulk-import-warning" : ""}`}
              >
                <span>
                  Calculated:{" "}
                  <strong>
                    {formatCurrency(check.expected_balance, currency)}
                  </strong>
                </span>
                <span>
                  Counted:{" "}
                  <strong>
                    {formatCurrency(check.balance ?? c.balance, currency)}
                  </strong>
                </span>
                <span>
                  Difference:{" "}
                  <strong>
                    {formatCurrency(check.difference ?? "0", currency)}
                  </strong>
                </span>
              </div>
            ) : null}
            <button
              className="text-button"
              type="button"
              onClick={() =>
                edit({
                  checkpoints: config.checkpoints.filter((_, i) => i !== index),
                })
              }
            >
              Remove checkpoint {index + 1}
            </button>
          </article>
        );
      })}
    </section>
  );
}
