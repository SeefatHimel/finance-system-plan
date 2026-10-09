"use client";

import { PaymentIdentityFields, type ExtraIdentifier, type IdentifierKind } from "@/components/payment-identity-fields";

import { useFeedbackMessage, useToast } from "@/components/toast-provider";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type PaymentMethod,
  type PaymentProvider,
  type SenderRule,
  type SenderRuleMatchType,
  type SenderRuleProvider,
  type SmsCapturePreference,
  type SmsDeviceStatus,
  type TransactionType,
  createPaymentMethod,
  createSenderRule,
  deletePaymentMethod,
  deleteSenderRule,
  getSmsCapturePreference,
  getSmsDeviceStatus,
  listAccounts,
  listCategories,
  listPaymentMethods,
  listSenderRules,
  updateSmsCapturePreference,
  updatePaymentMethod,
  updateSenderRule
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";

type SmsSettingsState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      accounts: Account[];
      categories: Category[];
      capturePreference: SmsCapturePreference;
      deviceStatus: SmsDeviceStatus;
      paymentMethods: PaymentMethod[];
      senderRules: SenderRule[];
      status: "ready";
    };

const paymentProviders: PaymentProvider[] = [
  "cash",
  "bkash",
  "nagad",
  "rocket",
  "ebl",
  "city_bank",
  "pathao_pay",
  "bank",
  "card",
  "manual",
  "other"
];
const senderProviders: SenderRuleProvider[] = [
  "bkash",
  "nagad",
  "rocket",
  "ebl",
  "city_bank",
  "pathao_pay",
  "bank",
  "card",
  "other"
];
const matchTypes: SenderRuleMatchType[] = ["exact", "contains", "regex"];
const transactionTypes: TransactionType[] = ["expense", "income", "transfer", "adjustment", "fee", "refund"];
const optionalMessageKinds = ["otp_or_security", "balance_notice", "promotional"] as const;

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function SmsSettingsWorkspace() {
  const { notify } = useToast();
  const [settingsState, setSettingsState] = useState<SmsSettingsState>({ status: "loading" });
  const [paymentMethodError, setPaymentMethodError] = useFeedbackMessage("error");
  const [senderRuleError, setSenderRuleError] = useFeedbackMessage("error");
  const [capturePreferenceError, setCapturePreferenceError] = useFeedbackMessage("error");
  const [updatingCaptureKey, setUpdatingCaptureKey] = useState<string | null>(null);
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false);
  const [isSavingSenderRule, setIsSavingSenderRule] = useState(false);
  const [isUpdatingPaymentMethod, setIsUpdatingPaymentMethod] = useState(false);
  const [isUpdatingSenderRule, setIsUpdatingSenderRule] = useState(false);
  const [deletingPaymentMethodId, setDeletingPaymentMethodId] = useState<string | null>(null);
  const [deletingSenderRuleId, setDeletingSenderRuleId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"capture" | "senders" | "payments">("capture");

  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState("");
  const [editingPaymentMethodAccount, setEditingPaymentMethodAccount] = useState("");
  const [editingPaymentMethodName, setEditingPaymentMethodName] = useState("");
  const [editingPaymentMethodProvider, setEditingPaymentMethodProvider] = useState<PaymentProvider>("bkash");
  const [editingPaymentMethodIdentifier, setEditingPaymentMethodIdentifier] = useState("");
  const [newIdentifierKind, setNewIdentifierKind] = useState<IdentifierKind>("any");
  const [newIdentifiers, setNewIdentifiers] = useState<ExtraIdentifier[]>([]);
  const [newAliases, setNewAliases] = useState("");
  const [editingIdentifierKind, setEditingIdentifierKind] = useState<IdentifierKind>("any");
  const [editingIdentifiers, setEditingIdentifiers] = useState<ExtraIdentifier[]>([]);
  const [editingAliases, setEditingAliases] = useState("");

  const [editingSenderRuleId, setEditingSenderRuleId] = useState("");
  const [editingSenderRuleAccount, setEditingSenderRuleAccount] = useState("");
  const [editingSenderRulePaymentMethod, setEditingSenderRulePaymentMethod] = useState("");
  const [editingSenderRuleCategory, setEditingSenderRuleCategory] = useState("");
  const [editingSenderRuleTransactionType, setEditingSenderRuleTransactionType] = useState<TransactionType | "">("");
  const [editingSenderRuleName, setEditingSenderRuleName] = useState("");
  const [editingSenderRuleProvider, setEditingSenderRuleProvider] = useState<SenderRuleProvider>("bkash");
  const [editingSenderRuleSender, setEditingSenderRuleSender] = useState("");
  const [editingSenderRuleMatchType, setEditingSenderRuleMatchType] = useState<SenderRuleMatchType>("exact");
  const [editingSenderRulePattern, setEditingSenderRulePattern] = useState("");
  const [editingSenderRulePriority, setEditingSenderRulePriority] = useState("100");

  async function loadData(showLoading = true) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setSettingsState({ message: "Sign in before managing SMS settings.", status: "error" });
      return;
    }

    if (showLoading) {
      setSettingsState({ status: "loading" });
    }

    try {
      const [accounts, categories, capturePreference, deviceStatus, paymentMethods, senderRules] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        getSmsCapturePreference(accessToken),
        getSmsDeviceStatus(accessToken),
        listPaymentMethods(accessToken),
        listSenderRules(accessToken)
      ]);
      setSettingsState({ accounts, categories, capturePreference, deviceStatus, paymentMethods, senderRules, status: "ready" });
    } catch (error) {
      setSettingsState({
        message: error instanceof Error ? error.message : "Could not load SMS settings.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function updateCapturePreference(
    key: string,
    patch: Partial<Pick<SmsCapturePreference, "excluded_message_kinds" | "excluded_providers" | "raw_sms_retention_days">>
  ) {
    const accessToken = getAccessToken();
    if (!accessToken || settingsState.status !== "ready") return;

    setCapturePreferenceError(null);
    setUpdatingCaptureKey(key);
    try {
      const capturePreference = await updateSmsCapturePreference(accessToken, patch);
      setSettingsState({ ...settingsState, capturePreference });
      notify("SMS capture preferences updated.");
    } catch (error) {
      setCapturePreferenceError(error instanceof Error ? error.message : "Could not update SMS capture policy.");
    } finally {
      setUpdatingCaptureKey(null);
    }
  }

  function toggleProvider(provider: SenderRuleProvider) {
    if (settingsState.status !== "ready") return;
    const excluded = settingsState.capturePreference.excluded_providers;
    void updateCapturePreference(`provider:${provider}`, {
      excluded_providers: excluded.includes(provider)
        ? excluded.filter((value) => value !== provider)
        : [...excluded, provider]
    });
  }

  function toggleMessageKind(messageKind: string) {
    if (settingsState.status !== "ready") return;
    const excluded = settingsState.capturePreference.excluded_message_kinds;
    void updateCapturePreference(`kind:${messageKind}`, {
      excluded_message_kinds: excluded.includes(messageKind)
        ? excluded.filter((value) => value !== messageKind)
        : [...excluded, messageKind]
    });
  }

  const accountNameById = useMemo(() => {
    if (settingsState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(settingsState.accounts.map((account) => [account.id, account.name]));
  }, [settingsState]);

  const paymentMethodNameById = useMemo(() => {
    if (settingsState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(settingsState.paymentMethods.map((method) => [method.id, method.name]));
  }, [settingsState]);

  const categoryNameById = useMemo(() => {
    if (settingsState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(settingsState.categories.map((category) => [category.id, category.name]));
  }, [settingsState]);

  async function handlePaymentMethodSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setPaymentMethodError("Sign in before creating a payment method.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setPaymentMethodError(null);
    setIsSavingPaymentMethod(true);

    try {
      await createPaymentMethod(accessToken, {
        account: String(formData.get("account") ?? ""),
        identifier: String(formData.get("identifier") ?? ""),
        identifier_kind: newIdentifierKind,
        additional_identifiers: newIdentifiers,
        aliases: newAliases.split("\n").map(value => value.trim()).filter(Boolean),
        name: String(formData.get("name") ?? ""),
        provider: String(formData.get("provider") ?? "bkash") as PaymentProvider
      });
      form.reset();
      await loadData(false);
      setNewIdentifiers([]); setNewAliases(""); setNewIdentifierKind("any");
      notify("Payment method added.");
    } catch (error) {
      setPaymentMethodError(error instanceof Error ? error.message : "Could not create payment method.");
    } finally {
      setIsSavingPaymentMethod(false);
    }
  }

  async function handleSenderRuleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setSenderRuleError("Sign in before creating a sender rule.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const priority = Number(formData.get("priority") ?? 100);
    setSenderRuleError(null);
    setIsSavingSenderRule(true);

    try {
      await createSenderRule(accessToken, {
        account: String(formData.get("account") ?? ""),
        category: String(formData.get("category") ?? "") || null,
        default_transaction_type: String(formData.get("default_transaction_type") ?? "") as TransactionType | "",
        match_type: String(formData.get("match_type") ?? "exact") as SenderRuleMatchType,
        name: String(formData.get("name") ?? ""),
        payment_method: String(formData.get("payment_method") ?? "") || null,
        pattern: String(formData.get("pattern") ?? ""),
        priority: Number.isFinite(priority) ? priority : 100,
        provider: String(formData.get("provider") ?? "bkash") as SenderRuleProvider,
        sender: String(formData.get("sender") ?? "")
      });
      form.reset();
      await loadData(false);
      notify("Sender rule added.");
    } catch (error) {
      setSenderRuleError(error instanceof Error ? error.message : "Could not create sender rule.");
    } finally {
      setIsSavingSenderRule(false);
    }
  }

  function handleSelectPaymentMethod(paymentMethodId: string) {
    setEditingPaymentMethodId(paymentMethodId);
    const selected = settingsState.status === "ready"
      ? settingsState.paymentMethods.find((method) => method.id === paymentMethodId)
      : null;
    setEditingPaymentMethodAccount(selected?.account ?? "");
    setEditingPaymentMethodName(selected?.name ?? "");
    setEditingPaymentMethodProvider((selected?.provider ?? "bkash") as PaymentProvider);
    setEditingPaymentMethodIdentifier(selected?.identifier ?? "");
    setEditingIdentifierKind(selected?.identifier_kind ?? "any");
    setEditingIdentifiers(selected?.additional_identifiers ?? []);
    setEditingAliases(selected?.aliases.join("\n") ?? "");
  }

  function handleSelectSenderRule(senderRuleId: string) {
    setEditingSenderRuleId(senderRuleId);
    const selected = settingsState.status === "ready"
      ? settingsState.senderRules.find((rule) => rule.id === senderRuleId)
      : null;
    setEditingSenderRuleAccount(selected?.account ?? "");
    setEditingSenderRulePaymentMethod(selected?.payment_method ?? "");
    setEditingSenderRuleCategory(selected?.category ?? "");
    setEditingSenderRuleTransactionType((selected?.default_transaction_type ?? "") as TransactionType | "");
    setEditingSenderRuleName(selected?.name ?? "");
    setEditingSenderRuleProvider((selected?.provider ?? "bkash") as SenderRuleProvider);
    setEditingSenderRuleSender(selected?.sender ?? "");
    setEditingSenderRuleMatchType((selected?.match_type ?? "exact") as SenderRuleMatchType);
    setEditingSenderRulePattern(selected?.pattern ?? "");
    setEditingSenderRulePriority(String(selected?.priority ?? 100));
  }

  async function handlePaymentMethodUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();
    if (!accessToken) {
      setPaymentMethodError("Sign in before updating a payment method.");
      return;
    }
    if (!editingPaymentMethodId) {
      setPaymentMethodError("Select a payment method to edit.");
      return;
    }

    setPaymentMethodError(null);
    setIsUpdatingPaymentMethod(true);
    try {
      await updatePaymentMethod(accessToken, editingPaymentMethodId, {
        account: editingPaymentMethodAccount,
        identifier: editingPaymentMethodIdentifier,
        identifier_kind: editingIdentifierKind,
        additional_identifiers: editingIdentifiers,
        aliases: editingAliases.split("\n").map(value => value.trim()).filter(Boolean),
        name: editingPaymentMethodName,
        provider: editingPaymentMethodProvider
      });
      await loadData(false);
      notify("Payment method updated.");
    } catch (error) {
      setPaymentMethodError(error instanceof Error ? error.message : "Could not update payment method.");
    } finally {
      setIsUpdatingPaymentMethod(false);
    }
  }

  async function handleSenderRuleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();
    if (!accessToken) {
      setSenderRuleError("Sign in before updating a sender rule.");
      return;
    }
    if (!editingSenderRuleId) {
      setSenderRuleError("Select a sender rule to edit.");
      return;
    }

    const priority = Number(editingSenderRulePriority);
    setSenderRuleError(null);
    setIsUpdatingSenderRule(true);
    try {
      await updateSenderRule(accessToken, editingSenderRuleId, {
        account: editingSenderRuleAccount,
        category: editingSenderRuleCategory || null,
        default_transaction_type: editingSenderRuleTransactionType,
        match_type: editingSenderRuleMatchType,
        name: editingSenderRuleName,
        payment_method: editingSenderRulePaymentMethod || null,
        pattern: editingSenderRulePattern,
        priority: Number.isFinite(priority) ? priority : 100,
        provider: editingSenderRuleProvider,
        sender: editingSenderRuleSender
      });
      await loadData(false);
      notify("Sender rule updated.");
    } catch (error) {
      setSenderRuleError(error instanceof Error ? error.message : "Could not update sender rule.");
    } finally {
      setIsUpdatingSenderRule(false);
    }
  }

  async function handleDeletePaymentMethod(paymentMethod: PaymentMethod) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setPaymentMethodError("Sign in before deleting a payment method.");
      return;
    }

    const confirmed = window.confirm(
      `Delete payment method "${paymentMethod.name}"? This fails if sender rules still reference it.`
    );
    if (!confirmed) {
      return;
    }

    setPaymentMethodError(null);
    setDeletingPaymentMethodId(paymentMethod.id);
    try {
      await deletePaymentMethod(accessToken, paymentMethod.id);
      await loadData(false);
      notify("Payment method deleted.");
    } catch (error) {
      setPaymentMethodError(error instanceof Error ? error.message : "Could not delete payment method.");
    } finally {
      setDeletingPaymentMethodId(null);
    }
  }

  async function handleDeleteSenderRule(senderRule: SenderRule) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setSenderRuleError("Sign in before deleting a sender rule.");
      return;
    }

    const confirmed = window.confirm(`Delete sender rule "${senderRule.name}"?`);
    if (!confirmed) {
      return;
    }

    setSenderRuleError(null);
    setDeletingSenderRuleId(senderRule.id);
    try {
      await deleteSenderRule(accessToken, senderRule.id);
      await loadData(false);
      notify("Sender rule deleted.");
    } catch (error) {
      setSenderRuleError(error instanceof Error ? error.message : "Could not delete sender rule.");
    } finally {
      setDeletingSenderRuleId(null);
    }
  }

  if (settingsState.status === "loading") {
    return <LoadingState detail="Loading payment methods and sender rules" label="Preparing SMS automation" />;
  }

  if (settingsState.status === "error") {
    return (
      <div className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">SMS settings</h1>
          <p className="section-subtitle">{settingsState.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const hasAccounts = settingsState.accounts.length > 0;

  return (
    <div className="workspace-grid">
      {!hasAccounts ? (
        <section className="panel">
          <div className="panel__body empty-state">
            <h2 className="section-title">Create an account first</h2>
            <p className="section-subtitle">
              Payment methods and sender rules must map SMS activity back to an account.
            </p>
            <Link className="button button--primary" href="/accounts">
              Go to accounts
            </Link>
          </div>
        </section>
      ) : null}

      <section className="panel settings-overview">
        <div className="panel__body">
          <div className="settings-overview__header">
            <div>
              <h1 className="section-title">SMS automation settings</h1>
              <p className="section-subtitle">Control what the app captures, where transactions land, and how long original message text is retained.</p>
            </div>
            <span className={`status-badge ${settingsState.deviceStatus.health_state === "healthy" ? "status-badge--ok" : "status-badge--idle"}`}>
              {settingsState.deviceStatus.health_label}
            </span>
          </div>
          <div className="setup-checklist" aria-label="SMS automation setup progress">
            <span className={hasAccounts ? "setup-checklist__done" : ""}>1. Account</span>
            <span className={settingsState.senderRules.some((rule) => rule.is_active) ? "setup-checklist__done" : ""}>2. Trusted sender</span>
            <span className={settingsState.deviceStatus.sms_permission_state === "granted" ? "setup-checklist__done" : ""}>3. SMS permission</span>
            <span className={settingsState.deviceStatus.last_successful_sync_at ? "setup-checklist__done" : ""}>4. First sync</span>
          </div>
          <div className="settings-tabs" role="tablist" aria-label="SMS settings sections">
            {([
              ["capture", "Capture & privacy"],
              ["senders", `Sender rules (${settingsState.senderRules.length})`],
              ["payments", `Payment methods (${settingsState.paymentMethods.length})`]
            ] as const).map(([key, label]) => (
              <button
                aria-selected={activeSection === key}
                className={activeSection === key ? "settings-tab settings-tab--active" : "settings-tab"}
                key={key}
                onClick={() => setActiveSection(key)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {activeSection === "capture" ? <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Capture policy</h2>
          <p className="section-subtitle">
            Excluded messages keep only a private duplicate-check ID. Their message text is never stored by the server.
          </p>
          <div className="setup-form">
            <div className="field field--wide">
              <span className="field__label">Providers</span>
              <div className="row-actions capture-policy-actions">
                {senderProviders.map((provider) => {
                  const excluded = settingsState.capturePreference.excluded_providers.includes(provider);
                  return (
                    <button
                      aria-checked={!excluded}
                      className={`button button--small ${excluded ? "button--danger" : "button--ghost"}`}
                      disabled={updatingCaptureKey !== null}
                      key={provider}
                      onClick={() => toggleProvider(provider)}
                      role="switch"
                      type="button"
                    >
                      {updatingCaptureKey === `provider:${provider}` ? "Updating…" : `${formatLabel(provider)}: ${excluded ? "Excluded" : "Tracking"}`}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field field--wide">
              <span className="field__label">Non-transaction messages</span>
              <div className="row-actions capture-policy-actions">
                {optionalMessageKinds.map((messageKind) => {
                  const excluded = settingsState.capturePreference.excluded_message_kinds.includes(messageKind);
                  return (
                    <button
                      aria-checked={!excluded}
                      className={`button button--small ${excluded ? "button--danger" : "button--ghost"}`}
                      disabled={updatingCaptureKey !== null}
                      key={messageKind}
                      onClick={() => toggleMessageKind(messageKind)}
                      role="switch"
                      type="button"
                    >
                      {updatingCaptureKey === `kind:${messageKind}` ? "Updating…" : `${formatLabel(messageKind)}: ${excluded ? "Excluded" : "Allowed"}`}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="field field--wide">
              <span className="field__label">Original SMS retention after confirmation</span>
              <select
                className="field__control"
                disabled={updatingCaptureKey !== null}
                onChange={(event) => void updateCapturePreference("retention", {
                  raw_sms_retention_days: event.target.value === "keep" ? null : Number(event.target.value)
                })}
                value={settingsState.capturePreference.raw_sms_retention_days ?? "keep"}
              >
                <option value="0">Redact immediately</option>
                <option value="7">Keep for 7 days</option>
                <option value="30">Keep for 30 days</option>
                <option value="keep">Keep until I redact it</option>
              </select>
              <span className="field__hint">Confirmed transactions keep parsed evidence such as amount, balance, merchant, and reference.</span>
            </label>
          </div>
          {capturePreferenceError ? <p className="form-error">{capturePreferenceError}</p> : null}
        </div>
      </section> : null}

      {activeSection === "payments" ? <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Payment methods</h2>
          <p className="section-subtitle">
            Link wallets, cards, and bank channels to the account they affect.
          </p>

          <form className="setup-form" onSubmit={handlePaymentMethodSubmit}>
            <label className="field">
              <span className="field__label">Account</span>
              <select className="field__control" disabled={!hasAccounts} name="account" required>
                <option value="">Select account</option>
                {settingsState.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Name</span>
              <input className="field__control" disabled={!hasAccounts} name="name" required type="text" />
            </label>

            <label className="field">
              <span className="field__label">Provider</span>
              <select className="field__control" disabled={!hasAccounts} name="provider" required>
                {paymentProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {formatLabel(provider)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--wide">
              <span className="field__label">Safe identifier or masked suffix</span>
              <input
                className="field__control"
                disabled={!hasAccounts}
                name="identifier"
                placeholder="For example: 7890 or 017…1234"
                type="text"
              />
              <span className="field__hint">Used to match SMS account/card evidence to this alias. Never enter a full card number.</span>
            </label>

            <PaymentIdentityFields kind={newIdentifierKind} onKind={setNewIdentifierKind} identifiers={newIdentifiers} onIdentifiers={setNewIdentifiers} aliases={newAliases} onAliases={setNewAliases} disabled={!hasAccounts || isSavingPaymentMethod} />
            {paymentMethodError ? <p className="form-error field--wide">{paymentMethodError}</p> : null}

            <button className="button button--primary" disabled={!hasAccounts || isSavingPaymentMethod} type="submit">
              {isSavingPaymentMethod ? <ButtonBusy label="Saving" /> : "Add payment method"}
            </button>
          </form>

          <div className="list-stack">
            {settingsState.paymentMethods.length === 0 ? (
              <p className="muted-text">No payment methods yet.</p>
            ) : (
              settingsState.paymentMethods.map((method) => (
                <div className="list-row" key={method.id}>
                  <div>
                    <strong>{method.name}</strong>
                    <span className="list-row__meta">
                      {formatLabel(method.provider)} · {accountNameById.get(method.account) ?? "Unknown account"}
                      {method.identifier ? ` · ${method.identifier}` : ""}{method.additional_identifiers.length ? ` · ${method.additional_identifiers.length} more identifiers` : ""}{method.aliases.length ? ` · Aliases: ${method.aliases.join(", ")}` : ""}
                    </span>
                  </div>
                  <div className="list-row__actions">
                    <button
                      className="button button--danger"
                      disabled={deletingPaymentMethodId === method.id}
                      onClick={() => void handleDeletePaymentMethod(method)}
                      type="button"
                    >
                      {deletingPaymentMethodId === method.id ? <ButtonBusy label="Deleting" /> : "Delete"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <form className="setup-form" onSubmit={handlePaymentMethodUpdate}>
            <label className="field">
              <span className="field__label">Edit payment method</span>
              <select
                className="field__control"
                onChange={(event) => handleSelectPaymentMethod(event.target.value)}
                value={editingPaymentMethodId}
              >
                <option value="">Select payment method</option>
                {settingsState.paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Account</span>
              <select
                className="field__control"
                onChange={(event) => setEditingPaymentMethodAccount(event.target.value)}
                required
                value={editingPaymentMethodAccount}
              >
                <option value="">Select account</option>
                {settingsState.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__control"
                onChange={(event) => setEditingPaymentMethodName(event.target.value)}
                required
                type="text"
                value={editingPaymentMethodName}
              />
            </label>
            <label className="field">
              <span className="field__label">Provider</span>
              <select
                className="field__control"
                onChange={(event) => setEditingPaymentMethodProvider(event.target.value as PaymentProvider)}
                value={editingPaymentMethodProvider}
              >
                {paymentProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {formatLabel(provider)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Safe identifier or masked suffix</span>
              <input
                className="field__control"
                onChange={(event) => setEditingPaymentMethodIdentifier(event.target.value)}
                type="text"
                value={editingPaymentMethodIdentifier}
              />
              <span className="field__hint">Use a masked value or last four digits only.</span>
            </label>
            <PaymentIdentityFields kind={editingIdentifierKind} onKind={setEditingIdentifierKind} identifiers={editingIdentifiers} onIdentifiers={setEditingIdentifiers} aliases={editingAliases} onAliases={setEditingAliases} disabled={!editingPaymentMethodId || isUpdatingPaymentMethod} />
            <button className="button button--ghost" disabled={isUpdatingPaymentMethod} type="submit">
              {isUpdatingPaymentMethod ? <ButtonBusy label="Updating" /> : "Update payment method"}
            </button>
          </form>
        </div>
      </section> : null}

      {activeSection === "senders" ? <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">SMS sender rules</h2>
          <p className="section-subtitle">
            Define which senders are trusted and where their transactions should land.
          </p>

          <form className="setup-form" onSubmit={handleSenderRuleSubmit}>
            <label className="field">
              <span className="field__label">Account</span>
              <select className="field__control" disabled={!hasAccounts} name="account" required>
                <option value="">Select account</option>
                {settingsState.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Payment method</span>
              <select className="field__control" disabled={!hasAccounts} name="payment_method">
                <option value="">No specific method</option>
                {settingsState.paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Default category</span>
              <select className="field__control" disabled={!hasAccounts} name="category">
                <option value="">Learn during review</option>
                {settingsState.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Fallback transaction type</span>
              <select className="field__control" disabled={!hasAccounts} name="default_transaction_type">
                <option value="">Detect from each message</option>
                {transactionTypes.map((transactionType) => (
                  <option key={transactionType} value={transactionType}>
                    {formatLabel(transactionType)}
                  </option>
                ))}
              </select>
              <span className="field__hint">Only used when the parser cannot identify the message kind. Confirmed choices are learned per message pattern.</span>
            </label>

            <label className="field">
              <span className="field__label">Rule name</span>
              <input className="field__control" disabled={!hasAccounts} name="name" required type="text" />
            </label>

            <label className="field">
              <span className="field__label">Provider</span>
              <select className="field__control" disabled={!hasAccounts} name="provider" required>
                {senderProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {formatLabel(provider)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Sender</span>
              <input className="field__control" disabled={!hasAccounts} name="sender" required type="text" />
            </label>

            <label className="field">
              <span className="field__label">Match type</span>
              <select className="field__control" disabled={!hasAccounts} name="match_type" required>
                {matchTypes.map((matchType) => (
                  <option key={matchType} value={matchType}>
                    {matchType}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">Pattern</span>
              <input className="field__control" disabled={!hasAccounts} name="pattern" type="text" />
            </label>

            <label className="field">
              <span className="field__label">Priority</span>
              <input
                className="field__control"
                defaultValue="100"
                disabled={!hasAccounts}
                min="0"
                name="priority"
                type="number"
              />
            </label>

            {senderRuleError ? <p className="form-error field--wide">{senderRuleError}</p> : null}

            <button className="button button--primary" disabled={!hasAccounts || isSavingSenderRule} type="submit">
              {isSavingSenderRule ? <ButtonBusy label="Saving" /> : "Add sender rule"}
            </button>
          </form>

          <div className="list-stack">
            {settingsState.senderRules.length === 0 ? (
              <p className="muted-text">No sender rules yet.</p>
            ) : (
              settingsState.senderRules.map((rule) => (
                <div className="list-row" key={rule.id}>
                  <div>
                    <strong>{rule.name}</strong>
                    <span className="list-row__meta">
                      {rule.sender} · {formatLabel(rule.provider)} · {rule.match_type} · {accountNameById.get(rule.account) ?? "Unknown account"}
                      {rule.payment_method ? ` · ${paymentMethodNameById.get(rule.payment_method) ?? "Unknown method"}` : ""}
                      {rule.category ? ` · ${categoryNameById.get(rule.category) ?? "Unknown category"}` : ""}
                      {rule.default_transaction_type ? ` · ${formatLabel(rule.default_transaction_type)}` : ""}
                    </span>
                  </div>
                  <div className="list-row__actions">
                    <span>Priority {rule.priority}</span>
                    <button
                      className="button button--danger"
                      disabled={deletingSenderRuleId === rule.id}
                      onClick={() => void handleDeleteSenderRule(rule)}
                      type="button"
                    >
                      {deletingSenderRuleId === rule.id ? <ButtonBusy label="Deleting" /> : "Delete"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <form className="setup-form" onSubmit={handleSenderRuleUpdate}>
            <label className="field">
              <span className="field__label">Edit sender rule</span>
              <select
                className="field__control"
                onChange={(event) => handleSelectSenderRule(event.target.value)}
                value={editingSenderRuleId}
              >
                <option value="">Select sender rule</option>
                {settingsState.senderRules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Account</span>
              <select
                className="field__control"
                onChange={(event) => setEditingSenderRuleAccount(event.target.value)}
                required
                value={editingSenderRuleAccount}
              >
                <option value="">Select account</option>
                {settingsState.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Payment method</span>
              <select
                className="field__control"
                onChange={(event) => setEditingSenderRulePaymentMethod(event.target.value)}
                value={editingSenderRulePaymentMethod}
              >
                <option value="">No specific method</option>
                {settingsState.paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Default category</span>
              <select
                className="field__control"
                onChange={(event) => setEditingSenderRuleCategory(event.target.value)}
                value={editingSenderRuleCategory}
              >
                <option value="">Learn during review</option>
                {settingsState.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Default transaction type</span>
              <select
                className="field__control"
                onChange={(event) => setEditingSenderRuleTransactionType(event.target.value as TransactionType | "")}
                value={editingSenderRuleTransactionType}
              >
                <option value="">Detect from each message</option>
                {transactionTypes.map((transactionType) => (
                  <option key={transactionType} value={transactionType}>
                    {formatLabel(transactionType)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__control"
                onChange={(event) => setEditingSenderRuleName(event.target.value)}
                required
                type="text"
                value={editingSenderRuleName}
              />
            </label>
            <label className="field">
              <span className="field__label">Provider</span>
              <select
                className="field__control"
                onChange={(event) => setEditingSenderRuleProvider(event.target.value as SenderRuleProvider)}
                value={editingSenderRuleProvider}
              >
                {senderProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {formatLabel(provider)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Sender</span>
              <input
                className="field__control"
                onChange={(event) => setEditingSenderRuleSender(event.target.value)}
                required
                type="text"
                value={editingSenderRuleSender}
              />
            </label>
            <label className="field">
              <span className="field__label">Match type</span>
              <select
                className="field__control"
                onChange={(event) => setEditingSenderRuleMatchType(event.target.value as SenderRuleMatchType)}
                value={editingSenderRuleMatchType}
              >
                {matchTypes.map((matchType) => (
                  <option key={matchType} value={matchType}>
                    {matchType}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Pattern</span>
              <input
                className="field__control"
                onChange={(event) => setEditingSenderRulePattern(event.target.value)}
                type="text"
                value={editingSenderRulePattern}
              />
            </label>
            <label className="field">
              <span className="field__label">Priority</span>
              <input
                className="field__control"
                min="0"
                onChange={(event) => setEditingSenderRulePriority(event.target.value)}
                type="number"
                value={editingSenderRulePriority}
              />
            </label>
            <button className="button button--ghost" disabled={isUpdatingSenderRule} type="submit">
              {isUpdatingSenderRule ? <ButtonBusy label="Updating" /> : "Update sender rule"}
            </button>
          </form>
        </div>
      </section> : null}
    </div>
  );
}
