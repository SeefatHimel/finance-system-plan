"use client";
import { SenderRulesPanel } from "./sender-rules-panel";

import { PaymentIdentityFields, type ExtraIdentifier, type IdentifierKind } from "@/components/payment-identity-fields";

import { useFeedbackMessage, useToast } from "@/components/toast-provider";

import type React from "react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type Account,
  type Category,
  type PaymentMethod,
  type PaymentProvider,
  type SenderRule,
  type SenderRuleProvider,
  type SmsCapturePreference,
  type SmsDeviceStatus,
  createPaymentMethod,
  deletePaymentMethod,
  getSmsCapturePreference,
  getSmsDeviceStatus,
  listAccounts,
  listCategories,
  listPaymentMethods,
  listSenderRules,
  revealPaymentMethodIdentifiers,
  updateSmsCapturePreference,
  updatePaymentMethod
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
const optionalMessageKinds = ["otp_or_security", "balance_notice", "promotional"] as const;
const settingsSections = ["capture", "senders", "payments"] as const;

function formatLabel(value: string) {
  const providers: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", ebl: "EBL", ebl_bank: "EBL bank", city_bank: "City Bank", pathao_pay: "Pathao Pay", card: "Card", bank: "Bank" };
  return providers[value] ?? value.replaceAll("_", " ");
}

export function SmsSettingsWorkspace() {
  const { notify } = useToast();
  const [settingsState, setSettingsState] = useState<SmsSettingsState>({ status: "loading" });
  const [paymentMethodError, setPaymentMethodError] = useFeedbackMessage("error");
  const [capturePreferenceError, setCapturePreferenceError] = useFeedbackMessage("error");
  const [updatingCaptureKey, setUpdatingCaptureKey] = useState<string | null>(null);
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false);
  const [isUpdatingPaymentMethod, setIsUpdatingPaymentMethod] = useState(false);
  const [deletingPaymentMethodId, setDeletingPaymentMethodId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"capture" | "senders" | "payments">("capture");

  const [editingPaymentMethodId, setEditingPaymentMethodId] = useState("");
  const revealPaymentId = useRef("");
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
  useEffect(() => {
    if (activeSection !== "payments") {
      revealPaymentId.current = "";
      setEditingPaymentMethodIdentifier("");
      setEditingIdentifiers([]);
      setEditingPaymentMethodId("");
    }
  }, [activeSection]);

  const [senderBusy, setSenderBusy] = useState(false);
  const settingsBusy = senderBusy || isSavingPaymentMethod || isUpdatingPaymentMethod
    || Boolean(deletingPaymentMethodId) || Boolean(updatingCaptureKey);

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
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "capture" || section === "senders" || section === "payments") {
      setActiveSection(section);
    }
    void loadData();
  }, []);

  function changeSection(section: "capture" | "senders" | "payments") {
    if (settingsBusy) return;
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    window.history.replaceState(window.history.state, "", url);
  }

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
      setSettingsState((current) => current.status === "ready"
        ? { ...current, capturePreference }
        : current);
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

  function handleSelectPaymentMethod(paymentMethodId: string) {
    revealPaymentId.current = paymentMethodId;
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

  async function revealSelectedPaymentNumbers() {
    const token = getAccessToken();
    if (!token || !editingPaymentMethodId) return;
    try {
      const original = await revealPaymentMethodIdentifiers(token, editingPaymentMethodId);
      if (revealPaymentId.current !== editingPaymentMethodId) return;
      const hasFullValue = Boolean(original.identifier && original.identifier !== editingPaymentMethodIdentifier) || original.additional_identifiers.some((item, index) => item.value !== editingIdentifiers[index]?.value);
      if (!hasFullValue) {
        notify("Only masked values were saved for this older method. Enter the full numbers and save to archive them.");
        return;
      }
      setEditingPaymentMethodIdentifier(original.identifier || editingPaymentMethodIdentifier);
      if (original.additional_identifiers.length) setEditingIdentifiers(original.additional_identifiers);
      notify("Saved numbers are shown in the editor until you leave this page.");
    } catch (error) {
      setPaymentMethodError(error instanceof Error ? error.message : "Could not show saved numbers.");
    }
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
            {activeSection !== "senders" ? <span className={`status-badge ${settingsState.deviceStatus.health_state === "healthy" ? "status-badge--ok" : "status-badge--idle"}`}>
              {settingsState.deviceStatus.health_label}
            </span> : null}
          </div>
          {activeSection !== "senders" ? <div className="setup-checklist" aria-label="SMS automation setup progress">
            <span className={hasAccounts ? "setup-checklist__done" : ""}>1. Account</span>
            <span className={settingsState.senderRules.some((rule) => rule.is_active) ? "setup-checklist__done" : ""}>2. Trusted sender</span>
            <span className={settingsState.deviceStatus.sms_permission_state === "granted" ? "setup-checklist__done" : ""}>3. SMS permission</span>
            <span className={settingsState.deviceStatus.last_successful_sync_at ? "setup-checklist__done" : ""}>4. First sync</span>
          </div>
          : null}
          <div className="settings-tabs" role="tablist" aria-label="SMS settings sections">
            {([
              ["capture", "Capture & privacy"],
              ["senders", "Sender rules"],
              ["payments", `Payment methods (${settingsState.paymentMethods.length})`]
            ] as const).map(([key, label]) => (
              <button
                disabled={settingsBusy}
                aria-selected={activeSection === key}
                aria-controls={`sms-settings-panel-${key}`}
                id={`sms-settings-tab-${key}`}
                tabIndex={activeSection === key ? 0 : -1}
                className={activeSection === key ? "settings-tab settings-tab--active" : "settings-tab"}
                key={key}
                onClick={() => changeSection(key)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const current = settingsSections.indexOf(key);
                  const next = event.key === "Home" ? "capture" : event.key === "End" ? "payments"
                    : settingsSections[(current + (event.key === "ArrowRight" ? 1 : 2)) % settingsSections.length];
                  changeSection(next);
                  event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#sms-settings-tab-${next}`)?.focus();
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {activeSection === "capture" ? <section className="panel" role="tabpanel" id="sms-settings-panel-capture" aria-labelledby="sms-settings-tab-capture">
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

      {activeSection === "payments" ? <section className="panel" role="tabpanel" id="sms-settings-panel-payments" aria-labelledby="sms-settings-tab-payments">
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
              <span className="field__label">Account / card number or masked suffix</span>
              <input
                className="field__control"
                autoComplete="off"
                disabled={!hasAccounts}
                name="identifier"
                placeholder="For example: full number or ****1234"
                type="text"
              />
              <span className="field__hint">Full numbers are encrypted by the API; normal views show only a safe suffix.</span>
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
            <button className="button button--ghost" disabled={!editingPaymentMethodId} onClick={() => void revealSelectedPaymentNumbers()} type="button">Show saved full numbers</button>
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
              <span className="field__label">Account / card number or masked suffix</span>
              <input
                className="field__control"
                autoComplete="off"
                onChange={(event) => setEditingPaymentMethodIdentifier(event.target.value)}
                type="text"
                value={editingPaymentMethodIdentifier}
              />
              <span className="field__hint">Enter a full number to store it encrypted. Normal views show only its safe suffix.</span>
            </label>
            <PaymentIdentityFields kind={editingIdentifierKind} onKind={setEditingIdentifierKind} identifiers={editingIdentifiers} onIdentifiers={setEditingIdentifiers} aliases={editingAliases} onAliases={setEditingAliases} disabled={!editingPaymentMethodId || isUpdatingPaymentMethod} />
            <button className="button button--ghost" disabled={isUpdatingPaymentMethod} type="submit">
              {isUpdatingPaymentMethod ? <ButtonBusy label="Updating" /> : "Update payment method"}
            </button>
          </form>
        </div>
      </section> : null}

      {activeSection === "senders" ? <div role="tabpanel" id="sms-settings-panel-senders" aria-labelledby="sms-settings-tab-senders"><SenderRulesPanel
        accounts={settingsState.accounts} categories={settingsState.categories}
        paymentMethods={settingsState.paymentMethods} rules={settingsState.senderRules}
        excludedProviders={settingsState.capturePreference.excluded_providers}
        onRulesChange={rules=>setSettingsState(current=>current.status==="ready"?{...current,senderRules:rules}:current)}
        onCapture={()=>changeSection("capture")} onBusyChange={setSenderBusy}
      /></div> : null}
    </div>
  );
}
