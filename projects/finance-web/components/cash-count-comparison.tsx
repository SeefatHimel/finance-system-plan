"use client";
import { useEffect, useState } from "react";
import { ModalDialog } from "./modal-dialog";
import { ButtonBusy } from "./loading-state";
import { useToast } from "./toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { compareCashCount, type CashComparison } from "@/lib/cash-counts-api";
import {
  formatCalendarDate,
  formatCurrency,
} from "../../finance-contracts/presentation";
export function CashCountComparisonDialog({
  id,
  currency,
  onClose,
}: {
  id: string;
  currency: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CashComparison | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const { notify } = useToast();
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setFailed(false);
    const token = getAccessToken();
    if (!token) {
      setBusy(false);
      setFailed(true);
      notify("Sign in to compare cash counts.", "error");
    }
    if (token)
      void compareCashCount(token, id, 0, controller.signal)
        .then(setData)
        .catch((error) => {
          if (!controller.signal.aborted) {
            setFailed(true);
            notify(error.message, "error");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    return () => controller.abort();
  }, [id, retry, notify]);
  async function more() {
    if (!data || data.next_offset === null) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      if (!token) throw new Error("Sign in to compare cash counts.");
      const next = await compareCashCount(token, id, data.next_offset);
      if (next.revision !== data.revision) {
        setData(await compareCashCount(token, id));
        notify(
          "The ledger or counts changed. The comparison has been refreshed.",
        );
      } else {
        setData({ ...next, movements: [...data.movements, ...next.movements] });
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not load movements.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  const money = (value: string) => formatCurrency(value, currency);
  return (
    <ModalDialog
      className="cash-count-modal"
      labelledBy="cash-compare-title"
      onCancel={onClose}
    >
      <header className="cash-count-modal-header">
        <div>
          <h2 id="cash-compare-title">Compare cash counts</h2>
          <p className="muted-text">
            Current ledger comparisons keep the saved observations unchanged.
          </p>
        </div>
        <button
          type="button"
          className="button button--ghost"
          onClick={onClose}
          aria-label="Close cash count comparison"
        >
          ×
        </button>
      </header>
      <div className="cash-count-modal-body">
        {busy && !data ? <ButtonBusy label="Comparing counts" /> : null}
        {failed ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry comparison
          </button>
        ) : null}
        {data ? (
          <>
            {data.errors.map((error) => (
              <p className="cash-count-warning" key={error}>
                {error}
              </p>
            ))}
            <div className="cash-count-cards">
              <article>
                <h3>Counted · {formatCalendarDate(data.count.date)}</h3>
                <strong>{money(data.count.balance)}</strong>
                <p>{data.count.time ?? "End of day"}</p>
              </article>
              <article>
                <h3>Current ledger at this count</h3>
                <strong>
                  {data.count.current_expected === null
                    ? "Timing review needed"
                    : money(data.count.current_expected)}
                </strong>
                <p>
                  Difference:{" "}
                  {data.count.current_difference === null
                    ? "Not yet comparable"
                    : money(data.count.current_difference)}
                </p>
              </article>
            </div>
            {data.count.ledger_changed ? (
              <p className="cash-count-warning">
                The ledger has changed since this count was saved. Its recorded
                comparison was {money(data.count.expected_balance)} expected,
                with a {money(data.count.difference)} difference.
              </p>
            ) : null}
            {data.previous ? (
              <div className="cash-count-interval">
                <h3>Since {formatCalendarDate(data.previous.date)}</h3>
                <p>
                  Previous counted cash: {money(data.previous.balance)} ·
                  Previous difference against the current ledger:{" "}
                  {data.previous.current_difference === null
                    ? "Timing review needed"
                    : money(data.previous.current_difference)}
                </p>
                {data.difference_change !== null ? (
                  <p>
                    {Number(data.difference_change) === 0 &&
                    Number(data.count.current_difference) !== 0
                      ? "The same net difference persists from the previous count. This is not a new discrepancy for each count."
                      : `Change in difference: ${money(data.difference_change)}`}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted-text">
                This is the first saved count for this account. Check the
                starting balance and earlier movements if it differs.
              </p>
            )}
            <h3>Recorded movements in this interval · {data.movement_count}</h3>
            <p className="muted-text">
              Matching net totals do not prove every transaction is recorded.
              Counts never create an income, expense or adjustment.
            </p>
            <ul className="cash-count-movements">
              {data.movements.map((row) => (
                <li key={row.id}>
                  <span>
                    <strong>{row.description}</strong>
                    <small>
                      {formatCalendarDate(row.date)} ·{" "}
                      {row.time ?? "Time unknown"}
                    </small>
                  </span>
                  <strong>
                    {row.direction === "credit" ? "+" : "−"}
                    {money(row.amount)}
                  </strong>
                </li>
              ))}
            </ul>
            {data.next_offset !== null ? (
              <button
                type="button"
                disabled={busy}
                className="button button--ghost"
                onClick={() => void more()}
              >
                {busy ? (
                  <ButtonBusy label="Loading movements" />
                ) : (
                  "Load more movements"
                )}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </ModalDialog>
  );
}
