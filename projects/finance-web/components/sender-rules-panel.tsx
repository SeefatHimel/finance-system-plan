"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  MagnifyingGlass,
  Plus,
  PencilSimple,
  X,
  Info,
  ArrowRight,
  CaretRight,
} from "@phosphor-icons/react";
import {
  createSenderRule,
  updateSenderRule,
  deleteSenderRule,
  type Account,
  type Category,
  type PaymentMethod,
  type SenderRule,
  type SenderRuleMatchType,
  type SenderRuleProvider,
  type TransactionType,
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { setupPathaoGroup } from "@/lib/pathao-sources-api";
import {
  senderProviderLabels,
  visibleSenderGroups,
  type SenderStatusFilter,
} from "@/lib/sender-rule-display";
import { pathaoSenders } from "../../finance-contracts/sender-groups";
import { AccountAvatar, AccountLabel } from "./account-avatar";
import { SenderRuleForm, type SenderRuleDraft } from "./sender-rule-form";
import { ModalDialog } from "./modal-dialog";
import { ButtonBusy } from "./loading-state";
import { useToast } from "./toast-provider";

type Props = {
  accounts: Account[];
  categories: Category[];
  paymentMethods: PaymentMethod[];
  rules: SenderRule[];
  excludedProviders: string[];
  onRulesChange: (rules: SenderRule[]) => void;
  onCapture: () => void;
  onBusyChange: (busy: boolean) => void;
};
type Editor =
  | { kind: "add" }
  | { kind: "edit"; rule: SenderRule }
  | { kind: "group"; members: SenderRule[] }
  | { kind: "delete"; rule: SenderRule };

const emptyDraft = (): SenderRuleDraft => ({
  account: "",
  provider: "bkash",
  sender: "",
  name: "",
  category: "",
  payment_method: "",
  default_transaction_type: "",
  match_type: "exact",
  pattern: "",
  priority: "100",
  is_active: true,
});

export function SenderRulesPanel({
  accounts,
  categories,
  paymentMethods,
  rules,
  excludedProviders,
  onRulesChange,
  onCapture,
  onBusyChange,
}: Props) {
  const { notify } = useToast();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState<SenderStatusFilter>("all"),
    [editor, setEditor] = useState<Editor | null>(null),
    [draft, setSenderRuleDraft] = useState<SenderRuleDraft>(emptyDraft),
    [preset, setPreset] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    onBusyChange(Boolean(busy));
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const groups = useMemo(
    () =>
      visibleSenderGroups(
        rules,
        accounts,
        categories,
        excludedProviders,
        query,
        status,
      ),
    [rules, accounts, categories, excludedProviders, query, status],
  );
  const allGroups = useMemo(
    () =>
      visibleSenderGroups(
        rules,
        accounts,
        categories,
        excludedProviders,
        "",
        "all",
      ),
    [rules, accounts, categories, excludedProviders],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  function edit(rule: SenderRule) {
    setSenderRuleDraft({
      account: rule.account,
      provider: rule.provider as SenderRuleProvider,
      sender: rule.sender,
      name: rule.name,
      category: rule.category ?? "",
      payment_method: rule.payment_method ?? "",
      default_transaction_type: rule.default_transaction_type as
        | TransactionType
        | "",
      match_type: rule.match_type as SenderRuleMatchType,
      pattern: rule.pattern,
      priority: String(rule.priority),
      is_active: rule.is_active,
    });
    setPreset(false);
    setAdvanced(rule.match_type !== "exact");
    setEditor({ kind: "edit", rule });
  }
  function add(group = false, account = "") {
    setSenderRuleDraft({ ...emptyDraft(), account });
    setPreset(group);
    setAdvanced(false);
    setEditor({ kind: "add" });
  }
  function close() {
    if (!inFlight.current) setEditor(null);
  }
  function updateRows(saved: SenderRule[], removed?: string) {
    const next = new Map(
      rules
        .filter((rule) => rule.id !== removed)
        .map((rule) => [rule.id, rule]),
    );
    saved.forEach((rule) => next.set(rule.id, rule));
    onRulesChange(
      [...next.values()].sort(
        (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
      ),
    );
  }
  async function mutate(key: string, operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(key);
    try {
      await operation();
    } catch (error) {
      if (alive.current)
        notify(
          error instanceof Error
            ? error.message
            : "Could not save this sender rule.",
          "error",
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  }
  function token() {
    const value = getAccessToken();
    if (!value) throw new Error("Sign in before changing sender rules.");
    return value;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor?.kind !== "add" && editor?.kind !== "edit") return;
    const current = editor;
    await mutate("save", async () => {
      const access = token();
      if (preset && current.kind === "add") {
        const saved = await setupPathaoGroup(access, draft.account);
        if (!alive.current) return;
        updateRows(saved);
        setEditor(null);
        notify("Pathao Pay group ready. Existing settings were kept.");
        return;
      }
      const payload = {
        ...draft,
        name:
          draft.name.trim() ||
          `${senderProviderLabels[draft.provider]} · ${draft.sender.trim()}`.slice(
            0,
            120,
          ),
        sender: draft.sender.trim(),
        payment_method: draft.payment_method || null,
        category: draft.category || null,
        priority: draft.priority === "" ? 100 : Number(draft.priority),
      };
      const saved =
        current.kind === "edit"
          ? await updateSenderRule(
              access,
              current.rule.id,
              // Keep unchanged links intact, including a formerly active account or category.
              Object.fromEntries(
                Object.entries(payload).filter(
                  ([key, value]) =>
                    value !== current.rule[key as keyof SenderRule],
                ),
              ) as Partial<typeof payload>,
            )
          : await createSenderRule(access, payload);
      if (!alive.current) return;
      updateRows([saved]);
      setEditor(null);
      notify(
        current.kind === "edit"
          ? "Sender rule updated."
          : "Sender rule added. Enable it in mobile Capture to sync SMS.",
      );
    });
  }
  function toggle(rule: SenderRule) {
    void mutate(rule.id, async () => {
      const saved = await updateSenderRule(token(), rule.id, {
        is_active: !rule.is_active,
      });
      if (!alive.current) return;
      updateRows([saved]);
      notify(
        saved.is_active
          ? "Rule enabled. Phone tracking is managed in mobile Capture."
          : "Rule disabled. Existing messages and transactions are kept.",
      );
    });
  }
  function remove(rule: SenderRule) {
    void mutate("delete", async () => {
      await deleteSenderRule(token(), rule.id);
      if (!alive.current) return;
      updateRows([], rule.id);
      setEditor(null);
      notify(
        "Sender rule removed. Existing messages and transactions are kept.",
      );
    });
  }
  const label =
    editor?.kind === "edit"
      ? "Edit sender"
      : editor?.kind === "group"
        ? "Pathao Pay sender names"
        : editor?.kind === "delete"
          ? "Remove sender rule?"
          : "Add sender";
  const change = (patch: Partial<SenderRuleDraft>) =>
    setSenderRuleDraft((current) => ({ ...current, ...patch }));
  return (
    <>
      <section
        className="panel sender-rules-panel"
        aria-labelledby="sender-rules-heading"
      >
        <div className="sender-rules-heading">
          <div>
            <h2 id="sender-rules-heading">Sender rules</h2>
            <p>
              Match sender names to accounts. Transactions still go to your
              review inbox.
            </p>
          </div>
          <button
            className="button button--primary"
            type="button"
            disabled={
              !accounts.some((account) => account.is_active) || Boolean(busy)
            }
            onClick={() => add()}
          >
            <Plus size={18} aria-hidden="true" />
            Add sender
          </button>
        </div>
        <div className="sender-rules-toolbar">
          <label className="sender-rule-search">
            <MagnifyingGlass size={20} aria-hidden="true" />
            <span className="sr-only">Search senders</span>
            <input
              type="search"
              placeholder="Search senders or accounts…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="sender-rule-filter">
            <span>Status</span>
            <select
              className="field__control"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as SenderStatusFilter)
              }
            >
              <option value="all">All rules</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="provider_paused">Provider paused</option>
            </select>
          </label>
        </div>
        {groups.length ? (
          <div className="sender-rules-table-scroll">
            <table className="sender-rules-table">
              <thead>
                <tr>
                  <th scope="col">Sender</th>
                  <th scope="col">Reporting account</th>
                  <th scope="col">Default category</th>
                  <th scope="col">Rule status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const rule = group.members[0],
                    account = accountById.get(rule.account),
                    count = group.members.filter(
                      (item) => item.is_active,
                    ).length,
                    paused = excludedProviders.includes(rule.provider);
                  const categories = new Set(
                    group.members.map((item) => item.category),
                  );
                  const category =
                    categories.size > 1
                      ? "Per sender"
                      : rule.category
                        ? (categoryById.get(rule.category)?.name ??
                          "Saved category")
                        : "Automatic";
                  return (
                    <tr key={group.key}>
                      <td data-label="Sender">
                        <div className="sender-rule-identity">
                          <AccountAvatar
                            account={
                              account ?? {
                                name: senderProviderLabels[rule.provider],
                              }
                            }
                            size="medium"
                          />
                          <div>
                            <strong>
                              {group.grouped ? "Pathao Pay" : rule.name}
                            </strong>
                            <span>
                              {group.grouped
                                ? `${group.members.length} sender names`
                                : `${rule.match_type === "exact" ? "Exact sender" : rule.match_type === "contains" ? "Sender contains" : "Regex match"}: ${rule.pattern && rule.match_type !== "exact" ? rule.pattern : rule.sender}`}
                            </span>
                            {group.grouped ? (
                              <small>
                                {group.members
                                  .map((item) => item.sender)
                                  .join(" · ")}
                              </small>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td data-label="Reporting account">
                        <AccountLabel
                          account={account}
                          fallback="Account unavailable"
                        />
                      </td>
                      <td data-label="Default category">
                        <span
                          className={
                            category === "Automatic" ? "muted-text" : ""
                          }
                        >
                          {category}
                        </span>
                      </td>
                      <td data-label="Rule status">
                        <div className="sender-rule-state">
                          <span
                            className={`sender-status sender-status--${paused ? "paused" : count === group.members.length ? "enabled" : count === 0 ? "disabled" : "mixed"}`}
                          >
                            {paused
                              ? "Provider paused"
                              : group.grouped
                                ? `${count} of ${group.members.length} enabled`
                                : rule.is_active
                                  ? "Enabled"
                                  : "Disabled"}
                          </span>
                          {!group.grouped && !paused ? (
                            <button
                              className="sender-rule-switch"
                              type="button"
                              role="switch"
                              aria-label={`Enable ${rule.sender} sender rule`}
                              aria-checked={rule.is_active}
                              disabled={Boolean(busy)}
                              onClick={() => toggle(rule)}
                            >
                              {busy === rule.id ? (
                                <ButtonBusy label="Saving" />
                              ) : (
                                <span />
                              )}
                            </button>
                          ) : null}
                          {paused ? (
                            <button
                              className="sender-rule-text-action"
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={onCapture}
                            >
                              Capture settings
                              <ArrowRight size={13} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td data-label="Actions">
                        <button
                          className="button button--ghost"
                          type="button"
                          disabled={Boolean(busy)}
                          aria-label={
                            group.grouped
                              ? "Manage Pathao Pay sender names"
                              : `Edit ${rule.sender} sender rule`
                          }
                          onClick={() =>
                            group.grouped
                              ? setEditor({
                                  kind: "group",
                                  members: group.members,
                                })
                              : edit(rule)
                          }
                        >
                          {group.grouped ? (
                            <>
                              Manage
                              <CaretRight size={15} aria-hidden="true" />
                            </>
                          ) : (
                            <>
                              <PencilSimple size={16} aria-hidden="true" />
                              Edit
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sender-rules-empty">
            <MagnifyingGlass size={28} aria-hidden="true" />
            <h3>
              {rules.length
                ? "No senders match these filters"
                : "Add your first sender"}
            </h3>
            <p>
              {rules.length
                ? "Search by sender name, account or category, or clear the filters."
                : "Choose the sender shown on an SMS and the account it reports on."}
            </p>
            {rules.length ? (
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Clear filters
              </button>
            ) : (
              <button
                className="button button--primary"
                type="button"
                disabled={
                  !accounts.some((account) => account.is_active) ||
                  Boolean(busy)
                }
                onClick={() => add()}
              >
                Add sender
              </button>
            )}
          </div>
        )}
        <div className="sender-rules-count" role="status">
          {query || status !== "all"
            ? `${groups.length} of ${allGroups.length} connections`
            : `${allGroups.length} connections`}{" "}
          · {rules.length} sender names
        </div>
        <p className="sender-rule-phone-note">
          <Info size={20} aria-hidden="true" />
          <span>
            Phone tracking is separate. Enable senders in the mobile app’s{" "}
            <strong>Capture</strong> tab.
          </span>
        </p>
      </section>
      {editor ? (
        <ModalDialog
          className="form-drawer sender-rule-dialog"
          labelledBy="sender-rule-dialog-heading"
          onCancel={close}
          busy={Boolean(busy)}
          initialFocus={
            editor.kind === "add" || editor.kind === "edit"
              ? "#sender-rule-account"
              : editor.kind === "delete"
                ? "#sender-rule-delete-back"
                : "#sender-rule-group-done"
          }
        >
          <header className="form-drawer__header">
            <div>
              <h2 id="sender-rule-dialog-heading">{label}</h2>
              <p>
                {editor.kind === "group"
                  ? "These exact names report on the same wallet. Each keeps its own saved settings."
                  : editor.kind === "delete"
                    ? "Existing messages and transactions will stay saved."
                    : "Choose the SMS sender and the account it reports on."}
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close sender editor"
              disabled={Boolean(busy)}
              onClick={close}
            >
              <X size={20} />
            </button>
          </header>
          {editor.kind === "group" ? (
            <>
              <div className="sender-rule-dialog-body">
                <AccountLabel
                  account={accountById.get(editor.members[0].account)}
                  size="medium"
                />
                <div className="sender-alias-list">
                  {editor.members.map((rule) => (
                    <div className="sender-alias-row" key={rule.id}>
                      <div>
                        <strong>{rule.sender}</strong>
                        <span className="muted-text">
                          {rule.category
                            ? categoryById.get(rule.category)?.name
                            : "Automatic category"}
                        </span>
                      </div>
                      <span
                        className={`sender-status sender-status--${rule.is_active ? "enabled" : "disabled"}`}
                      >
                        {rule.is_active ? "Enabled" : "Disabled"}
                      </span>
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => edit(rule)}
                        aria-label={`Edit ${rule.sender} sender rule`}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
                <p className="field__hint">
                  Editing or disabling one name leaves the others unchanged.
                  Duplicate detection still compares matching notifications for
                  this wallet.
                </p>
              </div>
              <footer className="sender-rule-dialog-footer">
                <button
                  className="button button--ghost"
                  type="button"
                  id="sender-rule-group-done"
                  onClick={close}
                >
                  Done
                </button>
                {editor.members.length < pathaoSenders.length ? (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => add(true, editor.members[0].account)}
                  >
                    Add missing names
                  </button>
                ) : null}
              </footer>
            </>
          ) : editor.kind === "delete" ? (
            <>
              <div className="sender-rule-dialog-body">
                <p>
                  Remove <strong>{editor.rule.sender}</strong> from your sender
                  rules? Future messages will no longer match this rule. Saved
                  choices tied to this rule will also be removed.
                </p>
              </div>
              <footer className="sender-rule-dialog-footer">
                <button
                  className="button button--ghost"
                  type="button"
                  id="sender-rule-delete-back"
                  disabled={Boolean(busy)}
                  onClick={() => setEditor({ kind: "edit", rule: editor.rule })}
                >
                  Back to edit
                </button>
                <button
                  className="button button--danger"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => remove(editor.rule)}
                >
                  {busy ? (
                    <ButtonBusy label="Removing" />
                  ) : (
                    "Remove sender rule"
                  )}
                </button>
              </footer>
            </>
          ) : (
            <SenderRuleForm
              mode={editor.kind}
              draft={draft}
              change={change}
              preset={preset}
              setPreset={setPreset}
              advanced={advanced}
              setAdvanced={setAdvanced}
              busy={busy}
              save={save}
              close={close}
              onRemove={() => {
                if (editor.kind === "edit")
                  setEditor({ kind: "delete", rule: editor.rule });
              }}
              accounts={accounts}
              categories={categories}
              paymentMethods={paymentMethods}
            />
          )}
        </ModalDialog>
      ) : null}
    </>
  );
}
