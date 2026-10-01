"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type PaymentMethod,
  type PaymentProvider,
  type SenderRule,
  type SenderRuleMatchType,
  type SenderRuleProvider,
  type SmsCapturePreference,
  createPaymentMethod,
  createSenderRule,
  deletePaymentMethod,
  deleteSenderRule,
  getSmsCapturePreference,
  listAccounts,
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
      capturePreference: SmsCapturePreference;
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
const optionalMessageKinds = ["otp_or_security", "balance_notice"] as const;

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function SmsSettingsWorkspace() {
  const [settingsState, setSettingsState] = useState<SmsSettingsState>({ status: "loading" });
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [senderRuleError, setSenderRuleError] = useState<string | null>(null);
  const [capturePreferenceError, setCapturePreferenceError] = useState<string | null>(null);
  const [updatingCaptureKey, setUpdatingCaptureKey] = useState<string | null>(null);
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false);
  const [isSavingSenderRule, setIsSavingSenderRule] = useState(false);
  const [isUpdatingPaymentMethod, setIsUpdatingPaymentMethod] = useState(false);
  const [isUpdatingSenderRule, setIsUpdatingSenderRule] = useState(false);
  const [deletingPaymentMethodId, setDeletingPaymentMethodId] = useState<string | null>(null);
  const [deletingSenderRuleId, setDeletingSenderRuleId] = useState<string | null>(null);

  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState("");
  const [editingPaymentMethodAccount, setEditingPaymentMethodAccount] = useState("");
  const [editingPaymentMethodName, setEditingPaymentMethodName] = useState("");
  const [editingPaymentMethodProvider, setEditingPaymentMethodProvider] = useState<PaymentProvider>("bkash");
  const [editingPaymentMethodIdentifier, setEditingPaymentMethodIdentifier] = useState("");

  const [editingSenderRuleId, setEditingSenderRuleId] = useState("");
  const [editingSenderRuleAccount, setEditingSenderRuleAccount] = useState("");
  const [editingSenderRulePaymentMethod, setEditingSenderRulePaymentMethod] = useState("");
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
      const [accounts, capturePreference, paymentMethods, senderRules] = await Promise.all([
        listAccounts(accessToken),
        getSmsCapturePreference(accessToken),
        listPaymentMethods(accessToken),
        listSenderRules(accessToken)
      ]);
      setSettingsState({ accounts, capturePreference, paymentMethods, senderRules, status: "ready" });
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
    patch: Partial<Pick<SmsCapturePreference, "excluded_message_kinds" | "excluded_providers">>
  ) {
    const accessToken = getAccessToken();
    if (!accessToken || settingsState.status !== "ready") return;

    setCapturePreferenceError(null);
    setUpdatingCaptureKey(key);
    try {
      const capturePreference = await updateSmsCapturePreference(accessToken, patch);
      setSettingsState({ ...settingsState, capturePreference });
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
        name: String(formData.get("name") ?? ""),
        provider: String(formData.get("provider") ?? "bkash") as PaymentProvider
      });
      form.reset();
      await loadData(false);
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
  }

  function handleSelectSenderRule(senderRuleId: string) {
    setEditingSenderRuleId(senderRuleId);
    const selected = settingsState.status === "ready"
      ? settingsState.senderRules.find((rule) => rule.id === senderRuleId)
      : null;
    setEditingSenderRuleAccount(selected?.account ?? "");
    setEditingSenderRulePaymentMethod(selected?.payment_method ?? "");
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
        name: editingPaymentMethodName,
        provider: editingPaymentMethodProvider
      });
      await loadData(false);
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
        match_type: editingSenderRuleMatchType,
        name: editingSenderRuleName,
        payment_method: editingSenderRulePaymentMethod || null,
        pattern: editingSenderRulePattern,
        priority: Number.isFinite(priority) ? priority : 100,
        provider: editingSenderRuleProvider,
        sender: editingSenderRuleSender
      });
      await loadData(false);
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
            <h1 className="section-title">Create an account first</h1>
            <p className="section-subtitle">
              Payment methods and sender rules must map SMS activity back to an account.
            </p>
            <Link className="button button--primary" href="/accounts">
              Go to accounts
            </Link>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Capture policy</h1>
          <p className="section-subtitle">
            Excluded providers and message types keep a server fingerprint for deduplication, but the API does not retain their SMS body.
          </p>
          <div className="setup-form">
            <div className="field field--wide">
              <span className="field__label">Providers</span>
              <div className="row-actions capture-policy-actions">
                {senderProviders.map((provider) => {
                  const excluded = settingsState.capturePreference.excluded_providers.includes(provider);
                  return (
                    <button
                      className={`button button--small ${excluded ? "button--danger" : "button--ghost"}`}
                      disabled={updatingCaptureKey !== null}
                      key={provider}
                      onClick={() => toggleProvider(provider)}
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
                      className={`button button--small ${excluded ? "button--danger" : "button--ghost"}`}
                      disabled={updatingCaptureKey !== null}
                      key={messageKind}
                      onClick={() => toggleMessageKind(messageKind)}
                      type="button"
                    >
                      {updatingCaptureKey === `kind:${messageKind}` ? "Updating…" : `${formatLabel(messageKind)}: ${excluded ? "Excluded" : "Allowed"}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {capturePreferenceError ? <p className="form-error">{capturePreferenceError}</p> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Payment methods</h1>
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
              <span className="field__label">Identifier</span>
              <input
                className="field__control"
                disabled={!hasAccounts}
                name="identifier"
                placeholder="Phone, card suffix, or nickname"
                type="text"
              />
            </label>

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
                      {method.identifier ? ` · ${method.identifier}` : ""}
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
              <span className="field__label">Identifier</span>
              <input
                className="field__control"
                onChange={(event) => setEditingPaymentMethodIdentifier(event.target.value)}
                type="text"
                value={editingPaymentMethodIdentifier}
              />
            </label>
            <button className="button button--ghost" disabled={isUpdatingPaymentMethod} type="submit">
              {isUpdatingPaymentMethod ? <ButtonBusy label="Updating" /> : "Update payment method"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
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
      </section>
    </div>
  );
}
