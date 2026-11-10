"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { listAccounts, type Account } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import {
  cashCountHistory,
  previewCashCounts,
  saveCashCounts,
  type CashPreview,
  type CashHistory,
} from "@/lib/cash-counts-api";
import type {
  CashCountDraft,
  CashCountRowInput,
} from "../../finance-contracts/cash-counts";
import {
  formatCalendarDate,
  formatCurrency,
} from "../../finance-contracts/presentation";
import { CalendarDateInput } from "./calendar-date-input";
import { ClockTimeInput } from "./clock-time-input";
import { ButtonBusy } from "./loading-state";
import { useToast } from "./toast-provider";
const Comparison = dynamic(() =>
  import("./cash-count-comparison").then((m) => m.CashCountComparisonDialog),
);
const fields = [
  "account",
  "date",
  "balance",
  "time",
  "note",
  "source_expected",
];
const fieldNames: Record<string, string> = {
  account: "Storage account",
  date: "Date",
  balance: "Counted balance",
  time: "Time",
  note: "Notes",
  source_expected: "Spreadsheet expected balance (reference only)",
};
function token() {
  const value = getAccessToken();
  if (!value) throw new Error("Sign in to record cash counts.");
  return value;
}
function initial(account = ""): CashCountDraft {
  return {
    rows: [{ account, date: "", time: "", balance: "", note: "" }],
    filename: "Cash count",
    mapping: {},
    account_map: {},
    decisions: {},
    date_order: "ISO",
    end_of_day: false,
  };
}
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not complete the cash count request.";
}
export function CashCountsWorkspace() {
  const { notify } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<"single" | "table">("single");
  const [draft, setDraft] = useState<CashCountDraft>(() => initial());
  const [preview, setPreview] = useState<CashPreview | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(0);
  const [page, setPage] = useState(1);
  const saveKey = useRef("");
  const [history, setHistory] = useState<CashHistory | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const historyGeneration = useRef(0);
  const [filter, setFilter] = useState("");
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [active, setActive] = useState<{
    id: string;
    currency: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const cash = accounts.filter((a) => ["cash", "home_cash"].includes(a.type));
  const available = cash.filter((a) => a.is_active);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    void Promise.resolve()
      .then(() => listAccounts(token(), controller.signal))
      .then((items) => {
        if (controller.signal.aborted) return;
        setAccounts(items);
        const first = items.find(
          (a) => a.is_active && ["cash", "home_cash"].includes(a.type),
        );
        setDraft((d) =>
          d.rows && !d.rows[0].account
            ? { ...d, rows: [{ ...d.rows[0], account: first?.id ?? "" }] }
            : d,
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          notify(errorText(error), "error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [notify, retry]);
  useEffect(() => {
    const controller = new AbortController();
    historyGeneration.current += 1;
    setHistoryBusy(true);
    setHistoryFailed(false);
    setHistory(null);
    void Promise.resolve()
      .then(() => cashCountHistory(token(), filter, 0, controller.signal))
      .then((value) => {
        if (!controller.signal.aborted) setHistory(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setHistoryFailed(true);
          notify(errorText(error), "error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryBusy(false);
      });
    return () => controller.abort();
  }, [filter, historyEpoch, notify]);
  function edit(change: Partial<CashCountDraft>) {
    setDraft((d) => ({ ...d, ...change }));
    setDirty(true);
    setSaved(0);
    saveKey.current = "";
  }
  function single(change: CashCountRowInput) {
    edit({ rows: [{ ...draft.rows?.[0], ...change }] });
  }
  function decision(number: number, change: CashCountRowInput) {
    edit({
      decisions: {
        ...draft.decisions,
        [number]: { ...draft.decisions[number], ...change },
      },
    });
  }
  function switchMode(value: "single" | "table") {
    setMode(value);
    setPreview(null);
    setDirty(false);
    setPage(1);
    setSaved(0);
    saveKey.current = "";
    const next = initial(available[0]?.id);
    if (value === "table") {
      delete next.rows;
      next.text = "";
      next.filename = "Pasted cash counts";
    }
    setDraft(next);
  }
  async function refresh() {
    setBusy("Checking counts");
    try {
      const next = await previewCashCounts(token(), draft);
      setPreview(next);
      setDirty(false);
      setPage(1);
    } catch (error) {
      notify(errorText(error), "error");
    } finally {
      setBusy("");
    }
  }
  async function save() {
    if (!preview) return;
    setBusy("Saving counts");
    saveKey.current ||= crypto.randomUUID();
    try {
      const receipt = await saveCashCounts(
        token(),
        draft,
        preview.review_token,
        saveKey.current,
      );
      setSaved(receipt.saved);
      setPreview(null);
      setDirty(false);
      setDraft(initial(draft.rows?.[0]?.account ?? available[0]?.id));
      setMode("single");
      setHistoryEpoch((n) => n + 1);
      saveKey.current = "";
      notify(
        `${receipt.saved} cash ${receipt.saved === 1 ? "count" : "counts"} saved.`,
      );
    } catch (error) {
      notify(errorText(error), "error");
      if (errorText(error).includes("changed")) {
        try {
          setPreview(await previewCashCounts(token(), draft));
          setDirty(false);
        } catch {
          /* The error toast retains the original failure. */
        }
      }
    } finally {
      setBusy("");
    }
  }
  async function more() {
    if (!history || history.next_offset === null) return;
    const generation = historyGeneration.current;
    setHistoryBusy(true);
    try {
      const next = await cashCountHistory(token(), filter, history.next_offset);
      if (generation === historyGeneration.current)
        setHistory({ ...next, results: [...history.results, ...next.results] });
    } catch (error) {
      notify(errorText(error), "error");
    } finally {
      if (generation === historyGeneration.current) setHistoryBusy(false);
    }
  }
  async function file(file?: File) {
    if (!file) return;
    if (file.size > 1_000_000 || !/^.*\.(csv|tsv|txt)$/i.test(file.name)) {
      notify(
        "Copy spreadsheet cells, or choose UTF-8 CSV/TSV/text up to 1 MB.",
        "error",
      );
      return;
    }
    setBusy("Reading table");
    try {
      edit({ text: await file.text(), filename: file.name });
    } catch (error) {
      notify(errorText(error), "error");
    } finally {
      setBusy("");
    }
  }
  function correct(row: CashHistory["results"][number]) {
    setMode("single");
    setDraft({
      ...initial(row.account),
      end_of_day: row.precision === "end_of_day",
      rows: [
        {
          account: row.account,
          date: row.date,
          time: row.time ?? "",
          balance: row.balance,
          note: row.note,
          action: "replace",
          replace_id: row.id,
        },
      ],
    });
    setPreview(null);
    setDirty(true);
    setSaved(0);
    saveKey.current = "";
    document
      .getElementById("cash-count-entry")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  if (loading)
    return (
      <div className="panel cash-count-initial" role="status">
        <ButtonBusy label="Loading cash counts" />
      </div>
    );
  if (loadFailed)
    return (
      <div className="panel panel__body">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setRetry((n) => n + 1)}
        >
          Retry cash counts
        </button>
      </div>
    );
  const row = draft.rows?.[0] ?? {};
  const pages = Math.max(1, Math.ceil((preview?.rows.length ?? 0) / 10));
  return (
    <div className="cash-count-workspace">
      <section className="panel panel__body">
        <div className="cash-count-heading">
          <div>
            <h2>Cash counts</h2>
            <p className="muted-text">
              Count your wallet or stored cash whenever you need. A difference
              can be saved for review.
            </p>
          </div>
          <Link href="/timeline" className="button button--ghost">
            Digital reported balances
          </Link>
        </div>
        <p className="cash-count-explanation">
          A count records what you observed. It never creates spending, income
          or a balance adjustment, and you do not need to count every day.
        </p>
      </section>
      {!available.length ? (
        <section className="panel panel__body">
          <h3>No active physical cash account</h3>
          <p>
            Create an account with type Cash or Home cash first. Digital
            wallets, bank accounts and credit cards keep their SMS/statement
            checks.
          </p>
          <Link className="button button--primary" href="/accounts">
            Manage accounts
          </Link>
        </section>
      ) : (
        <section className="panel panel__body" id="cash-count-entry">
          <div className="cash-count-heading">
            <h3>Record a count</h3>
            <div className="cash-count-switch">
              <button
                type="button"
                className="button button--ghost"
                aria-pressed={mode === "single"}
                disabled={Boolean(busy)}
                onClick={() => switchMode("single")}
              >
                One count
              </button>
              <button
                type="button"
                className="button button--ghost"
                aria-pressed={mode === "table"}
                disabled={Boolean(busy)}
                onClick={() => switchMode("table")}
              >
                Paste count table
              </button>
            </div>
          </div>
          {saved > 0 ? (
            <p className="cash-count-success" role="status">
              {saved} cash {saved === 1 ? "count was" : "counts were"} saved.
              Any difference remains available for review.
            </p>
          ) : null}
          <fieldset className="cash-count-fields" disabled={Boolean(busy)}>
            {mode === "single" ? (
              <div className="cash-count-grid">
                <label className="field">
                  <span className="field__label">Cash account</span>
                  <select
                    aria-label="Cash account"
                    className="field__control"
                    value={row.account ?? ""}
                    onChange={(e) => single({ account: e.target.value })}
                  >
                    <option value="">Choose cash account</option>
                    {available.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Count date</span>
                  <CalendarDateInput
                    aria-label="Count date"
                    value={row.date ?? ""}
                    onChange={(date) => single({ date })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">
                    Counted cash (
                    {available.find((a) => a.id === row.account)?.currency ??
                      "currency"}
                    )
                  </span>
                  <input
                    className="field__control"
                    inputMode="decimal"
                    value={row.balance ?? ""}
                    onChange={(e) => single({ balance: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Count time (optional)</span>
                  <ClockTimeInput
                    aria-label="Count time (optional)"
                    value={row.time ?? ""}
                    onValueChange={(time) => single({ time })}
                  />
                </label>
                <label className="field cash-count-wide">
                  <span className="field__label">Count notes</span>
                  <textarea
                    rows={2}
                    className="field__control"
                    value={row.note ?? ""}
                    maxLength={2000}
                    onChange={(e) => single({ note: e.target.value })}
                  />
                </label>
              </div>
            ) : (
              <>
                <label className="field">
                  <span className="field__label">Paste count table</span>
                  <textarea
                    className="field__control cash-count-paste"
                    rows={6}
                    value={draft.text ?? ""}
                    onChange={(e) => edit({ text: e.target.value })}
                    placeholder={
                      "Storage Account\tDate\tCounted Balance\tExpected Balance\nExample wallet\t2026-01-02\t1200\t1150"
                    }
                  />
                </label>
                <div className="cash-count-file">
                  <label className="field">
                    <span className="field__label">Upload count table</span>
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={(e) => void file(e.target.files?.[0])}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Table date order</span>
                    <select
                      className="field__control"
                      value={draft.date_order}
                      onChange={(e) =>
                        edit({
                          date_order: e.target
                            .value as CashCountDraft["date_order"],
                        })
                      }
                    >
                      <option value="ISO">Year-month-day</option>
                      <option value="DMY">Day/month/year</option>
                      <option value="MDY">Month/day/year</option>
                    </select>
                  </label>
                </div>
                <p className="muted-text">
                  Up to 100 counts across your cash accounts. Paste spreadsheet
                  cells, CSV/TSV or a Markdown table. Expected Balance is kept
                  as reference; the app calculates its own.
                </p>
              </>
            )}
            <label className="cash-count-confirm">
              <input
                type="checkbox"
                checked={draft.end_of_day}
                onChange={(e) => edit({ end_of_day: e.target.checked })}
              />{" "}
              Counts without a time are end-of-day balances.
            </label>
            <p className="muted-text">
              Exact transaction times remain unknown. Specific-time counts
              require ordering any untimed entries on that date. Time zone:
              Asia/Dhaka.
            </p>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => void refresh()}
            >
              {busy ? (
                <ButtonBusy label={busy} />
              ) : preview ? (
                "Refresh count preview"
              ) : (
                "Preview cash counts"
              )}
            </button>
            {preview?.headers.length ? (
              <details className="cash-count-mapping">
                <summary>Count table column mapping</summary>
                <div className="cash-count-grid">
                  {fields.map((field) => (
                    <label className="field" key={field}>
                      <span className="field__label">{fieldNames[field]}</span>
                      <select
                        className="field__control"
                        value={
                          draft.mapping[field] ?? preview.mapping[field] ?? ""
                        }
                        onChange={(e) =>
                          edit({
                            mapping: {
                              ...preview.mapping,
                              ...draft.mapping,
                              [field]: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Not provided</option>
                        {preview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            ) : null}
            {preview ? (
              <>
                {mode === "table" ? (
                  <details className="cash-count-mapping">
                    <summary>Map table account names</summary>
                    <div className="cash-count-grid">
                      {[
                        ...new Set(
                          preview.rows.map((p) =>
                            String(p.original.account ?? ""),
                          ),
                        ),
                      ].map((name) => {
                        const matching = preview.rows.find(
                          (p) => p.original.account === name,
                        );
                        return (
                          <label className="field" key={name}>
                            <span className="field__label">
                              {name || "Rows without an account name"}
                            </span>
                            <select
                              className="field__control"
                              value={
                                draft.account_map[name] ??
                                matching?.account ??
                                ""
                              }
                              onChange={(e) =>
                                edit({
                                  account_map: {
                                    ...draft.account_map,
                                    [name]: e.target.value || null,
                                  },
                                })
                              }
                            >
                              <option value="">Choose cash account</option>
                              {available.map((a) => (
                                <option value={a.id} key={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
                <div className="cash-count-heading">
                  <h3>
                    Review {preview.rows.length}{" "}
                    {preview.rows.length === 1 ? "count" : "counts"}
                  </h3>
                  <span className="muted-text">
                    {dirty
                      ? "Refresh to check your edits"
                      : preview.ready
                        ? "Ready to save observations"
                        : "Resolve highlighted rows"}
                  </span>
                </div>
                {preview.rows
                  .slice(
                    (Math.min(page, pages) - 1) * 10,
                    Math.min(page, pages) * 10,
                  )
                  .map((p) => {
                    const d = draft.decisions[p.number] ?? {};
                    const action = d.action ?? p.action;
                    return (
                      <article
                        className="cash-count-preview-row"
                        key={p.number}
                      >
                        <div className="cash-count-heading">
                          <strong>
                            {p.number}. {p.account_name} ·{" "}
                            {p.date ? formatCalendarDate(p.date) : "Check date"}{" "}
                            · {p.time ?? "End of day"}
                          </strong>
                          <label>
                            <span className="sr-only">
                              Action for count {p.number}
                            </span>
                            <select
                              className="field__control"
                              value={action}
                              onChange={(e) =>
                                decision(p.number, {
                                  action: e.target
                                    .value as CashCountRowInput["action"],
                                })
                              }
                            >
                              <option value="add">Add count</option>
                              {p.duplicate ? (
                                <option value="replace">
                                  Correct saved count
                                </option>
                              ) : null}
                              <option value="skip">Skip count</option>
                            </select>
                          </label>
                        </div>
                        {p.errors.length && action !== "skip" ? (
                          <ul className="cash-count-warning">
                            {p.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        ) : null}
                        {action !== "skip" ? (
                          <>
                            <div className="cash-count-cards">
                              <article>
                                <span>Counted cash</span>
                                <strong>
                                  {p.balance
                                    ? formatCurrency(
                                        p.balance,
                                        p.currency || "BDT",
                                      )
                                    : "Enter amount"}
                                </strong>
                              </article>
                              <article>
                                <span>Calculated ledger balance</span>
                                <strong>
                                  {p.expected_balance === null
                                    ? "Not yet checked"
                                    : formatCurrency(
                                        p.expected_balance,
                                        p.currency,
                                      )}
                                </strong>
                              </article>
                              <article>
                                <span>Difference</span>
                                <strong>
                                  {p.difference === null
                                    ? "Not yet checked"
                                    : formatCurrency(p.difference, p.currency)}
                                </strong>
                                <small>
                                  {p.difference === null
                                    ? "Resolve timing/input first"
                                    : Number(p.difference) === 0
                                      ? "Matches ledger"
                                      : "Needs review · saving is allowed"}
                                </small>
                              </article>
                            </div>
                            {p.previous && p.difference_change !== null ? (
                              <p className="cash-count-explanation">
                                {Number(p.difference_change) === 0 &&
                                Number(p.difference) !== 0
                                  ? "The same net difference persists from the previous count."
                                  : `Change in difference since ${formatCalendarDate(p.previous.date)}: ${formatCurrency(p.difference_change, p.currency)}`}
                              </p>
                            ) : null}
                            {p.source_expected ? (
                              <p className="muted-text">
                                Spreadsheet expected balance:{" "}
                                {p.source_expected} (reference only).
                              </p>
                            ) : null}
                            <details>
                              <summary>
                                Edit count / inspect original input
                              </summary>
                              <div className="cash-count-grid">
                                <label className="field">
                                  <span className="field__label">
                                    Account for count {p.number}
                                  </span>
                                  <select
                                    className="field__control"
                                    value={d.account ?? p.account ?? ""}
                                    onChange={(e) =>
                                      decision(p.number, {
                                        account: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">
                                      Choose cash account
                                    </option>
                                    {available.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="field">
                                  <span className="field__label">
                                    Date for count {p.number}
                                  </span>
                                  <CalendarDateInput
                                    aria-label={`Date for count ${p.number}`}
                                    value={d.date ?? p.date ?? ""}
                                    onChange={(date) =>
                                      decision(p.number, { date })
                                    }
                                  />
                                </label>
                                <label className="field">
                                  <span className="field__label">
                                    Amount for count {p.number}
                                  </span>
                                  <input
                                    className="field__control"
                                    inputMode="decimal"
                                    value={d.balance ?? p.balance}
                                    onChange={(e) =>
                                      decision(p.number, {
                                        balance: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="field">
                                  <span className="field__label">
                                    Time for count {p.number} (optional)
                                  </span>
                                  <ClockTimeInput
                                    aria-label={`Time for count ${p.number} (optional)`}
                                    value={d.time ?? p.time ?? ""}
                                    onValueChange={(time) =>
                                      decision(p.number, { time })
                                    }
                                  />
                                </label>
                                <label className="field cash-count-wide">
                                  <span className="field__label">
                                    Notes for count {p.number}
                                  </span>
                                  <textarea
                                    className="field__control"
                                    rows={2}
                                    maxLength={2000}
                                    value={d.note ?? p.note}
                                    onChange={(e) =>
                                      decision(p.number, {
                                        note: e.target.value,
                                      })
                                    }
                                  />
                                </label>
                              </div>
                              <details>
                                <summary>
                                  Original count input · unchanged
                                </summary>
                                <dl className="bulk-import-original">
                                  {Object.entries(p.original).map(
                                    ([key, value]) => (
                                      <div key={key}>
                                        <dt>{key}</dt>
                                        <dd>
                                          {typeof value === "string"
                                            ? value || "—"
                                            : JSON.stringify(value)}
                                        </dd>
                                      </div>
                                    ),
                                  )}
                                </dl>
                              </details>
                            </details>
                            {p.unknown.length ? (
                              <section className="cash-count-timing">
                                <h4>Untimed entries on this count date</h4>
                                <label className="field">
                                  <span className="field__label">
                                    Default order for count {p.number}
                                  </span>
                                  <select
                                    className="field__control"
                                    value={d.unknown_position ?? "unresolved"}
                                    onChange={(e) =>
                                      decision(p.number, {
                                        unknown_position: e.target
                                          .value as CashCountRowInput["unknown_position"],
                                      })
                                    }
                                  >
                                    <option value="unresolved">
                                      Choose before or after
                                    </option>
                                    <option value="before">
                                      Before the count
                                    </option>
                                    <option value="after">
                                      After the count
                                    </option>
                                  </select>
                                </label>
                                <details>
                                  <summary>
                                    Review {p.unknown.length} untimed entries /
                                    exceptions
                                  </summary>
                                  {p.unknown.map((item) => (
                                    <label
                                      className="cash-count-unknown"
                                      key={item.id}
                                    >
                                      <span>
                                        {item.description} · {item.amount}
                                      </span>
                                      <select
                                        aria-label={`Timing of ${item.description} for count ${p.number}`}
                                        className="field__control"
                                        value={
                                          d.timing_order?.[item.id] ??
                                          d.unknown_position ??
                                          item.position
                                        }
                                        onChange={(e) =>
                                          decision(p.number, {
                                            timing_order: {
                                              ...d.timing_order,
                                              [item.id]: e.target.value as
                                                | "before"
                                                | "after",
                                            },
                                          })
                                        }
                                      >
                                        <option value="unresolved" disabled>
                                          Choose order
                                        </option>
                                        <option value="before">
                                          Before count
                                        </option>
                                        <option value="after">
                                          After count
                                        </option>
                                      </select>
                                    </label>
                                  ))}
                                </details>
                              </section>
                            ) : null}
                          </>
                        ) : null}
                      </article>
                    );
                  })}
                {pages > 1 ? (
                  <div className="cash-count-heading">
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((n) => n - 1)}
                    >
                      Previous preview rows
                    </button>
                    <span>
                      Page {Math.min(page, pages)} of {pages}
                    </span>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={page >= pages}
                      onClick={() => setPage((n) => n + 1)}
                    >
                      Next preview rows
                    </button>
                  </div>
                ) : null}
                <div className="cash-count-save">
                  <p>
                    Differences are saved for review. No adjustment will be
                    created.
                  </p>
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={dirty || !preview.ready}
                    onClick={() => void save()}
                  >
                    Save cash counts
                  </button>
                </div>
              </>
            ) : null}
          </fieldset>
        </section>
      )}
      <section className="panel panel__body">
        <div className="cash-count-heading">
          <div>
            <h3>Cash count history</h3>
            <p className="muted-text">
              Saved comparisons stay as recorded. Compare movements to
              recalculate both counts against the current ledger.
            </p>
          </div>
          <label className="field">
            <span className="field__label">History account</span>
            <select
              aria-label="History account"
              className="field__control"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">All cash accounts</option>
              {cash.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {historyBusy ? (
          <div role="status">
            <ButtonBusy label="Loading count history" />
          </div>
        ) : null}
        {historyFailed ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setHistoryEpoch((n) => n + 1)}
          >
            Retry count history
          </button>
        ) : null}
        {history?.results.length ? (
          <div className="table-wrap">
            <table className="cash-count-history">
              <thead>
                <tr>
                  <th scope="col">Account / date</th>
                  <th scope="col">Counted cash</th>
                  <th scope="col">Ledger at save</th>
                  <th scope="col">Difference / review</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.results.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      {item.account_name}
                      <small>
                        {formatCalendarDate(item.date)} ·{" "}
                        {item.time ?? "End of day"}
                      </small>
                      {item.note ? <small>{item.note}</small> : null}
                    </th>
                    <td>{formatCurrency(item.balance, item.currency)}</td>
                    <td>
                      {formatCurrency(item.expected_balance, item.currency)}
                    </td>
                    <td>
                      <strong>
                        {formatCurrency(item.difference, item.currency)}
                      </strong>
                      <small>
                        {Number(item.difference) === 0
                          ? "Matches ledger"
                          : "Needs review"}
                      </small>
                      {item.same_recorded_difference ? (
                        <small>
                          Same recorded difference as previous count
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <div className="cash-count-actions">
                        <button
                          type="button"
                          className="button button--ghost button--small"
                          onClick={(event) =>
                            setActive({
                              id: item.id,
                              currency: item.currency,
                              trigger: event.currentTarget,
                            })
                          }
                        >
                          Compare movements
                        </button>
                        {available.some((a) => a.id === item.account) ? (
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            disabled={Boolean(busy)}
                            onClick={() => correct(item)}
                          >
                            Correct count
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !historyBusy && !historyFailed ? (
          <p className="muted-text">
            No cash counts saved for this selection. Count when you need to;
            there is no daily requirement.
          </p>
        ) : null}
        {history?.next_offset !== null && history?.next_offset !== undefined ? (
          <button
            className="button button--ghost"
            type="button"
            disabled={historyBusy}
            onClick={() => void more()}
          >
            Load older counts
          </button>
        ) : null}
      </section>
      {active ? (
        <Comparison
          id={active.id}
          currency={active.currency}
          onClose={() => {
            const trigger = active.trigger;
            setActive(null);
            // Capture the actual row trigger before the lazy-loaded dialog
            // mounts, then restore it after the native dialog has closed.
            requestAnimationFrame(() => {
              if (trigger.isConnected) trigger.focus({ preventScroll: true });
            });
          }}
        />
      ) : null}
    </div>
  );
}
