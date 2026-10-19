"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "@phosphor-icons/react";
import { formatCalendarDate } from "../../finance-contracts/presentation";
import { CalendarDateInput } from "@/components/calendar-date-input";
import { useAuth } from "./auth-provider";
import { useTransactionRecovery } from "./transaction-recovery";
import { useToast } from "./toast-provider";
import { ModalDialog } from "./modal-dialog";
import { QuickTimePicker } from "./quick-time-picker";
import { getAccessToken } from "@/lib/auth-storage";
import {
  getApiBaseUrl,
  listAccounts,
  listCategories,
  listQuickPresets,
  saveQuickPreset,
  reorderQuickPresets,
  postQuickEntry,
  type Account,
  type Category,
} from "@/lib/api";
import {
  applyQuickPreset,
  entrySnapshot,
  draftFromEntry,
  buildQuickEntry,
  categoryFits,
  isRejectedEntry,
  localDay,
  localTime,
  newEntryId,
  newQuickDraft,
  type PresetInput,
  type QuickDraft,
  type QuickEntryInput,
  type QuickPreset,
} from "../../finance-contracts/quick-add";

type Data = {
  accounts: Account[];
  categories: Category[];
  presets: QuickPreset[];
};
type Context = Data & {
  loaded: boolean;
  error: string;
  busy: boolean;
  load: (force?: boolean) => Promise<void>;
  open: (preset?: QuickPreset) => void;
  savePreset: (input: Partial<PresetInput>, id?: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  fullDraft: QuickDraft | null;
  consumeFullDraft: () => void;
};
const QuickContext = createContext<Context | null>(null);
export function useQuickAdd() {
  const value = useContext(QuickContext);
  if (!value) throw new Error("QuickAddProvider is required");
  return value;
}

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  // Session changes discard financial drafts and outstanding UI responses.
  const owner = session.status === "signed-in" ? session.user.id : null;
  return (
    <QuickAddSession key={owner ?? "signed-out"} owner={owner}>
      {children}
    </QuickAddSession>
  );
}
function QuickAddSession({
  children,
  owner,
}: {
  children: React.ReactNode;
  owner: number | null;
}) {
  const [data, setData] = useState<Data>({
    accounts: [],
    categories: [],
    presets: [],
  });
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [surface, setSurface] = useState<"launcher" | "entry" | null>(null);
  const [draft, setDraft] = useState<QuickDraft>(newQuickDraft),
    [title, setTitle] = useState("Quick entry");
  const [allPresets, setAllPresets] = useState(false),
    [more, setMore] = useState(false),
    [clock, setClock] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [fullDraft, setFullDraft] = useState<QuickDraft | null>(null);
  const consumeFullDraft = useCallback(() => setFullDraft(null), []);
  const inFlight = useRef(false),
    alive = useRef(true),
    loading = useRef<Promise<void> | null>(null);
  const pending = useRef<QuickEntryInput | null>(null);
  const loadRevision = useRef(0);
  const router = useRouter();
  const { notify } = useToast();
  const recovery = useTransactionRecovery();
  const retryKey = `finance.quick.pending.${getApiBaseUrl()}.${owner}`;
  const [invalidRetry, setInvalidRetry] = useState(false);
  useEffect(() => {
    if (owner === null) return;
    try {
      const stored = window.sessionStorage.getItem(retryKey);
      if (stored) {
        const request = entrySnapshot(JSON.parse(stored), "web");
        pending.current = request;
        setDraft(draftFromEntry(request));
        setTitle("Pending quick entry");
      }
    } catch {
      setInvalidRetry(true);
    }
  }, [owner, retryKey]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(
    (force = false) => {
      if (loading.current && !force) return loading.current;
      if (owner === null) return Promise.resolve();
      const token = getAccessToken();
      if (!token) return Promise.resolve();
      const revision = ++loadRevision.current;
      const promise = Promise.all([
        listAccounts(token),
        listCategories(token),
        listQuickPresets(token),
      ])
        .then(([accounts, categories, presets]) => {
          if (alive.current && revision === loadRevision.current) {
            setData({ accounts, categories, presets });
            setLoaded(true);
            setError("");
          }
        })
        .catch((err) => {
          if (alive.current && revision === loadRevision.current)
            setError(
              err instanceof Error ? err.message : "Could not load presets.",
            );
        })
        .finally(() => {
          if (revision === loadRevision.current) loading.current = null;
        });
      loading.current = promise;
      return promise;
    },
    [owner],
  );
  function open(preset?: QuickPreset) {
    void load();
    setEntryError("");
    if (pending.current) {
      setSurface("entry");
      return;
    }
    if (invalidRetry) {
      setSurface("launcher");
      return;
    }
    if (preset) {
      if (!preset.available) {
        setEntryError(
          "Edit this preset or choose active account/category options.",
        );
        setDraft(newQuickDraft(preset));
      } else
        setDraft((old) =>
          surface === "entry"
            ? applyQuickPreset(old, preset)
            : newQuickDraft(preset),
        );
      setTitle(preset.name);
      setSurface("entry");
    } else {
      setSurface("launcher");
      setAllPresets(false);
    }
  }
  async function savePreset(input: Partial<PresetInput>, id?: string) {
    const token = getAccessToken();
    if (!token) throw new Error("Sign in to manage presets.");
    await saveQuickPreset(token, input, id);
    await load(true);
  }
  async function reorder(ids: string[]) {
    const token = getAccessToken();
    if (!token) throw new Error("Sign in to manage presets.");
    const presets = await reorderQuickPresets(token, ids);
    ++loadRevision.current;
    loading.current = null;
    if (alive.current) setData((old) => ({ ...old, presets }));
  }
  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setEntryError("");
    try {
      const token = getAccessToken();
      if (!token) throw new Error("Sign in before saving.");
      if (
        !pending.current &&
        (!data.accounts.some((a) => a.id === draft.account && a.is_active) ||
          (draft.category &&
            !data.categories.some(
              (c) =>
                c.id === draft.category &&
                c.is_active &&
                categoryFits(c.kind, draft.type),
            )))
      )
        throw new Error(
          "Choose active account/category options before saving.",
        );
      const request =
        pending.current ?? buildQuickEntry(draft, newEntryId(), "web");
      window.sessionStorage.setItem(retryKey, JSON.stringify(request));
      pending.current = request;
      inFlight.current = true;
      setBusy(true);
      const saved = await postQuickEntry(token, request);
      if (!alive.current) return;
      window.sessionStorage.removeItem(retryKey);
      pending.current = null;
      setSurface(null);
      setDraft(newQuickDraft());
      if (saved.undo_action) recovery.announce(saved.undo_action);
      else notify("Transaction saved.", "success");
      window.dispatchEvent(new Event("finance:transactions-changed"));
      router.refresh();
    } catch (err) {
      if (isRejectedEntry(err)) {
        pending.current = null;
        window.sessionStorage.removeItem(retryKey);
      }
      if (alive.current)
        setEntryError(
          err instanceof Error ? err.message : "Save failed. Retry this entry.",
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const enabled = data.presets.filter((p) => p.is_enabled);
  const favorites = enabled.filter((p) => p.is_favorite).slice(0, 6);
  const locked = busy || pending.current !== null;
  const choose = (patch: Partial<QuickDraft>) =>
    setDraft((old) => ({ ...old, ...patch }));
  return (
    <QuickContext.Provider
      value={{
        ...data,
        loaded,
        error,
        busy,
        load,
        open,
        savePreset,
        reorder,
        fullDraft,
        consumeFullDraft,
      }}
    >
      {children}
      {surface ? (
        <ModalDialog
          initialFocus={
            surface === "entry"
              ? pending.current
                ? 'button[type="submit"]'
                : 'input[aria-label="Quick entry amount"]'
              : undefined
          }
          labelledBy="quick-add-title"
          className="decision-modal quick-add-modal"
          busy={busy}
          onCancel={() => setSurface(null)}
        >
          <div className="quick-heading">
            <h2 id="quick-add-title">
              {surface === "entry" ? title : "Quick Add"}
            </h2>
            <button
              className="button button--ghost"
              aria-label="Close Quick Add"
              type="button"
              disabled={busy}
              onClick={() => setSurface(null)}
            >
              <X size={18} />
            </button>
          </div>
          {invalidRetry ? (
            <p className="form-error">
              The saved retry request is invalid. Review your ledger before
              discarding it.{" "}
              <button
                type="button"
                onClick={() => {
                  window.sessionStorage.removeItem(retryKey);
                  setInvalidRetry(false);
                }}
              >
                Discard invalid retry request
              </button>
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}{" "}
              <button type="button" onClick={() => void load()}>
                Retry loading
              </button>
            </p>
          ) : null}
          {!loaded && !error ? (
            <p role="status">Loading your presets…</p>
          ) : null}
          {surface === "launcher" ? (
            <>
              <p>Choose a shortcut. Nothing is saved until you press Save.</p>
              <div className="quick-preset-grid">
                {(allPresets ? enabled : favorites).map((p) => (
                  <button
                    className="quick-preset-tile"
                    type="button"
                    disabled={invalidRetry}
                    key={p.id}
                    onClick={() => open(p)}
                  >
                    <strong>{p.name}</strong>
                    <span>
                      {data.accounts.find((a) => a.id === p.account)?.name ??
                        "Choose account"}{" "}
                      ·{" "}
                      {data.categories.find((c) => c.id === p.category)?.name ??
                        "Uncategorized"}
                    </span>
                    {!p.available ? <small>Needs active options</small> : null}
                  </button>
                ))}
              </div>
              {enabled.length > favorites.length && !allPresets ? (
                <button
                  className="button button--ghost"
                  onClick={() => setAllPresets(true)}
                  type="button"
                >
                  See all presets
                </button>
              ) : null}
              {!enabled.length && loaded ? (
                <p>
                  No enabled presets yet. Create your first shortcut or use a
                  blank entry.
                </p>
              ) : null}
              <div className="decision-modal__actions">
                <Link
                  className="button button--ghost"
                  href="/quick-add"
                  onClick={() => setSurface(null)}
                >
                  Manage presets
                </Link>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={invalidRetry}
                  onClick={() => {
                    setDraft(newQuickDraft());
                    setTitle("Quick entry");
                    setSurface("entry");
                  }}
                >
                  Blank entry
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={saveEntry}>
              <div className="quick-entry-scroll">
                <fieldset disabled={locked} className="quick-entry-fields">
                  <label className="field">
                    <span className="field__label">Amount</span>
                    <input
                      autoFocus
                      className="field__control quick-amount"
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(event) =>
                        choose({ amount: event.target.value })
                      }
                      required
                      aria-label="Quick entry amount"
                    />
                  </label>
                  <QuickChoice
                    label="Account"
                    value={draft.account}
                    options={data.accounts
                      .filter((a) => a.is_active)
                      .map((a) => ({ id: a.id, name: a.name }))}
                    pinned={data.presets
                      .filter((p) => p.is_enabled && p.is_favorite)
                      .map((p) => p.account)
                      .filter((id): id is string => Boolean(id))}
                    onChange={(account) => choose({ account })}
                  />
                  <QuickChoice
                    label="Category"
                    value={draft.category}
                    options={data.categories
                      .filter(
                        (c) => c.is_active && categoryFits(c.kind, draft.type),
                      )
                      .map((c) => ({ id: c.id, name: c.name }))}
                    pinned={data.presets
                      .filter((p) => p.is_enabled && p.is_favorite)
                      .map((p) => p.category)
                      .filter((id): id is string => Boolean(id))}
                    onChange={(category) => choose({ category })}
                    allowEmpty
                  />
                  <div className="quick-summary">
                    <span>
                      {draft.type === "expense"
                        ? "Expense · Money out"
                        : "Income · Money in"}
                    </span>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => {
                        const type =
                          draft.type === "expense" ? "income" : "expense";
                        choose({
                          type,
                          category: data.categories.some(
                            (c) =>
                              c.id === draft.category &&
                              categoryFits(c.kind, type),
                          )
                            ? draft.category
                            : "",
                        });
                      }}
                    >
                      Change type
                    </button>
                  </div>
                  <div className="quick-time-tabs">
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() =>
                        choose({ dateMode: "today", date: localDay() })
                      }
                    >
                      Today
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => {
                        const date = new Date();
                        date.setDate(date.getDate() - 1);
                        choose({ dateMode: "custom", date: localDay(date) });
                      }}
                    >
                      Yesterday
                    </button>
                    <label className="field">
                      <span className="field__label">Entry date</span>
                      <CalendarDateInput
                        value={
                          draft.dateMode === "today" ? localDay() : draft.date
                        }
                        onChange={(date) =>
                          choose({
                            dateMode: "custom",
                            date,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="quick-time-tabs">
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() =>
                        choose({ dateMode: "today", timeMode: "now" })
                      }
                    >
                      Now
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => setClock(true)}
                    >
                      Change time
                      {draft.timeMode === "custom" ? ` · ${draft.time}` : ""}
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      aria-pressed={draft.timeMode === "none"}
                      onClick={() => choose({ timeMode: "none" })}
                    >
                      Time unknown
                    </button>
                  </div>
                  <small>
                    {draft.dateMode === "today" ? "Today" : formatCalendarDate(draft.date)} ·{" "}
                    {draft.timeMode === "now"
                      ? "Current time at Save"
                      : draft.timeMode === "none"
                        ? "No time recorded"
                        : draft.time}{" "}
                    · Local timezone
                  </small>
                  <button
                    className="button button--ghost"
                    type="button"
                    aria-expanded={more}
                    onClick={() => setMore(!more)}
                  >
                    More details
                  </button>
                  {more ? (
                    <>
                      <label className="field">
                        <span className="field__label">
                          Merchant / counterparty
                        </span>
                        <input
                          className="field__control"
                          value={draft.counterparty_text}
                          maxLength={255}
                          onChange={(event) =>
                            choose({ counterparty_text: event.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">Note</span>
                        <input
                          className="field__control"
                          maxLength={2000}
                          value={draft.note}
                          onChange={(event) =>
                            choose({ note: event.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  {enabled.length ? (
                    <label className="field">
                      <span className="field__label">
                        Apply another preset (keeps typed amount/note)
                      </span>
                      <select
                        className="field__control"
                        value=""
                        onChange={(event) => {
                          const preset = enabled.find(
                            (p) => p.id === event.target.value,
                          );
                          if (preset) open(preset);
                        }}
                      >
                        <option value="">Choose preset</option>
                        {enabled
                          .filter((p) => p.available)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                </fieldset>
                {entryError ? (
                  <p className="form-error" role="alert">
                    {entryError}
                  </p>
                ) : null}
                {pending.current && !busy ? (
                  <p role="status">
                    Your original values are retained for retry. Closing this
                    window keeps the pending request.
                  </p>
                ) : null}
              </div>
              <div className="quick-entry-footer">
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setFullDraft(draft);
                    setSurface(null);
                    router.push("/transactions");
                  }}
                >
                  Full entry
                </button>
                <button
                  className="button button--primary"
                  disabled={busy}
                  type="submit"
                >
                  {busy
                    ? "Saving…"
                    : pending.current
                      ? "Retry same entry"
                      : "Save transaction"}
                </button>
              </div>
            </form>
          )}
        </ModalDialog>
      ) : null}
      {clock ? (
        <QuickTimePicker
          value={draft.timeMode === "now" ? localTime() : draft.time}
          onCancel={() => setClock(false)}
          onApply={(time) => {
            choose({ timeMode: "custom", time });
            setClock(false);
          }}
        />
      ) : null}
    </QuickContext.Provider>
  );
}
function QuickChoice({
  label,
  value,
  options,
  pinned,
  onChange,
  allowEmpty,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  pinned: string[];
  onChange: (id: string) => void;
  allowEmpty?: boolean;
}) {
  const [all, setAll] = useState(false),
    [query, setQuery] = useState("");
  const shortlist = options
    .filter((o) => pinned.includes(o.id) || o.id === value)
    .sort((a, b) => Number(b.id === value) - Number(a.id === value))
    .slice(0, label === "Account" ? 4 : 6);
  const shown = (
    all
      ? options
      : shortlist.length
        ? shortlist
        : options.slice(0, label === "Account" ? 4 : 6)
  ).filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="quick-choice">
      <span className="field__label">
        {label}:{" "}
        {options.find((o) => o.id === value)?.name ??
          (allowEmpty ? "Uncategorized" : "Choose account")}
      </span>
      <div className="quick-choice__buttons">
        {shown.map((o) => (
          <button
            className="button button--ghost"
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
            key={o.id}
            type="button"
          >
            {o.id === value ? <span aria-hidden="true">✓ </span> : null}{o.name}
          </button>
        ))}
        {allowEmpty ? (
          <button
            className="button button--ghost"
            type="button"
            aria-pressed={!value}
            onClick={() => onChange("")}
          >
            {!value ? <span aria-hidden="true">✓ </span> : null}Uncategorized
          </button>
        ) : null}
      </div>
      <button
        className="quick-see-all"
        type="button"
        aria-expanded={all}
        onClick={() => setAll(!all)}
      >
        {all
          ? "Show favorites"
          : `See all ${label === "Category" ? "categories" : "accounts"}`}
      </button>
      {all ? (
        <input
          className="field__control"
          placeholder={`Search ${label === "Category" ? "categories" : "accounts"}`}
          aria-label={`Search quick ${label === "Category" ? "categories" : "accounts"}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
    </div>
  );
}
export function QuickAddButton() {
  const quick = useQuickAdd();
  return (
    <button
      className="button button--primary quick-toolbar-button"
      aria-label="Quick Add"
      onClick={() => quick.open()}
      type="button"
    >
      <Plus aria-hidden="true" size={18} />
      <span>Quick Add</span>
    </button>
  );
}
export function QuickAddShortcuts({ compact = false }: { compact?: boolean }) {
  const quick = useQuickAdd();
  const { load } = quick;
  useEffect(() => {
    void load();
  }, [load]);
  const presets = quick.presets
    .filter((p) => p.is_enabled && p.is_favorite)
    .slice(0, 6);
  return (
    <section className={`panel${compact ? " quick-shortcuts--compact" : ""}`} aria-label="Quick Add shortcuts">
      <div className="panel__body">
        <div className="quick-heading">
          <h2 className="section-title">Quick Add</h2>
          <Link href="/quick-add">Manage presets</Link>
        </div>
        <div className="quick-preset-grid">
          {presets.map((p) => (
            <button
              className="quick-preset-tile"
              key={p.id}
              onClick={() => quick.open(p)}
              type="button"
            >
              <strong>{p.name}</strong>
              <span>
                {quick.accounts.find((a) => a.id === p.account)?.name ??
                  "Choose account"}{" "}
                ·{" "}
                {quick.categories.find((c) => c.id === p.category)?.name ??
                  "Uncategorized"}
              </span>
            </button>
          ))}
        </div>
        <button
          className="button button--ghost"
          onClick={() => quick.open()}
          type="button"
        >
          {presets.length ? "See all / blank entry" : "Add a manual entry"}
        </button>
        {quick.error ? <p className="form-error">{quick.error}</p> : null}
      </div>
    </section>
  );
}
