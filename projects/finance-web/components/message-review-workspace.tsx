"use client";

import { ArrowClockwise, ArrowLeft, ArrowRight, CheckCircle, FunnelSimple, MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

import { ButtonBusy, LoadingState } from "@/components/loading-state";
import {
  type Account,
  type Category,
  type ParsedMessageCandidate,
  type PaymentMethod,
  type TransactionDirection,
  type TransactionType,
  confirmMessageCandidate,
  listAccounts,
  listCategories,
  listMessageCandidates,
  listPaymentMethods,
  redactRawMessage,
  reprocessMessageCandidate,
  rejectMessageCandidate
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type ReviewState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; candidates: ParsedMessageCandidate[]; categories: Category[]; paymentMethods: PaymentMethod[]; status: "ready" };

type RejectDraft = {
  candidate: ParsedMessageCandidate;
  note: string;
  reason: string;
  redact: boolean;
  scope: "message" | "provider" | "sender";
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function dateInputFromTimestamp(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeInputFromTimestamp(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function confidencePercent(value: string) {
  const score = Number(value);
  return Number.isNaN(score) ? "Unknown" : `${Math.round(score * 100)}%`;
}

function confidenceLabel(value: string) {
  const score = Number(value);
  if (Number.isNaN(score)) return "Unknown confidence";
  if (score >= 0.85) return "High confidence";
  if (score >= 0.65) return "Medium confidence";
  return "Low confidence";
}

function candidateIssues(candidate: ParsedMessageCandidate) {
  const issues: string[] = [];
  if (!candidate.account) issues.push("Choose account");
  if (!candidate.amount) issues.push("Enter amount");
  if (!candidate.category && candidate.transaction_type !== "transfer") issues.push("Choose category");
  if (candidate.possible_internal_transfer && !candidate.destination_account) issues.push("Verify destination");
  if (Number(candidate.confidence) < 0.65) issues.push("Check source SMS");
  return issues;
}

function reviewReason(candidate: ParsedMessageCandidate) {
  const issues = candidateIssues(candidate);
  if (candidate.raw_message.duplicate_of) return "Possible duplicate message";
  if (candidate.related_match_reason) return candidate.related_match_reason;
  if (issues.length) return issues.join(" · ");
  return "Ready for a quick verification";
}

function normalizedNote(candidate: ParsedMessageCandidate) {
  const parts = [formatLabel(candidate.message_kind)];
  if (candidate.counterparty_text) parts.push(candidate.counterparty_text);
  return parts.join(" · ");
}

export function MessageReviewWorkspace() {
  const [reviewState, setReviewState] = useState<ReviewState>({ status: "loading" });
  const [activeCandidateId, setActiveCandidateId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [workingCandidateId, setWorkingCandidateId] = useState<string | null>(null);
  const [reprocessingCandidateId, setReprocessingCandidateId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [rejectDraft, setRejectDraft] = useState<RejectDraft | null>(null);

  async function loadData(showLoading = true) {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setReviewState({ message: "Sign in before reviewing SMS candidates.", status: "error" });
      return;
    }
    if (showLoading) setReviewState({ status: "loading" });
    try {
      const [accounts, categories, candidates, paymentMethods] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        listMessageCandidates(accessToken),
        listPaymentMethods(accessToken)
      ]);
      setReviewState({ accounts, candidates, categories, paymentMethods, status: "ready" });
      const requestedCandidateId = new URLSearchParams(window.location.search).get("candidate") ?? "";
      setActiveCandidateId((current) => {
        if (candidates.some((candidate) => candidate.id === current)) return current;
        if (candidates.some((candidate) => candidate.id === requestedCandidateId)) return requestedCandidateId;
        return candidates[0]?.id ?? "";
      });
    } catch (error) {
      setReviewState({ message: error instanceof Error ? error.message : "Could not load SMS review inbox.", status: "error" });
    }
  }

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (reviewState.status !== "ready") return;
    const params = new URLSearchParams(window.location.search);
    if (activeCandidateId) params.set("candidate", activeCandidateId);
    else params.delete("candidate");
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params.toString()}` : ""}`);
  }, [activeCandidateId, reviewState.status]);

  const filteredCandidates = useMemo(() => {
    if (reviewState.status !== "ready") return [];
    const normalizedQuery = query.trim().toLowerCase();
    return reviewState.candidates.filter((candidate) => {
      if (providerFilter !== "all" && candidate.provider !== providerFilter) return false;
      const issues = candidateIssues(candidate);
      if (issueFilter === "ready" && issues.length) return false;
      if (issueFilter === "missing" && !issues.length) return false;
      if (!normalizedQuery) return true;
      return [candidate.provider, candidate.message_kind, candidate.raw_message.sender, candidate.counterparty_text, candidate.reference]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [issueFilter, providerFilter, query, reviewState]);

  const activeCandidate = filteredCandidates.find((candidate) => candidate.id === activeCandidateId) ?? filteredCandidates[0] ?? null;
  const activeIndex = activeCandidate ? filteredCandidates.findIndex((candidate) => candidate.id === activeCandidate.id) : -1;
  const accountNameById = useMemo(() => reviewState.status === "ready"
    ? new Map(reviewState.accounts.map((account) => [account.id, account.name]))
    : new Map<string, string>(), [reviewState]);
  const providers = useMemo(() => reviewState.status === "ready"
    ? Array.from(new Set(reviewState.candidates.map((candidate) => candidate.provider))).sort()
    : [], [reviewState]);

  async function handleConfirm(candidate: ParsedMessageCandidate, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before confirming SMS candidates.");
    const formData = new FormData(event.currentTarget);
    setActionError(null);
    setActionMessage(null);
    setWorkingCandidateId(candidate.id);
    try {
      await confirmMessageCandidate(accessToken, candidate.id, {
        account: String(formData.get("account") ?? "") || undefined,
        amount: String(formData.get("amount") ?? "") || undefined,
        balance_after: String(formData.get("balance_after") ?? "") || null,
        category: String(formData.get("category") ?? "") || null,
        counterparty_text: String(formData.get("counterparty_text") ?? ""),
        date: String(formData.get("date") ?? "") || undefined,
        direction: String(formData.get("direction") ?? "") as TransactionDirection,
        note: String(formData.get("note") ?? ""),
        payment_method: String(formData.get("payment_method") ?? "") || null,
        reference: String(formData.get("reference") ?? ""),
        remember_mapping: formData.get("remember_mapping") === "on",
        time: String(formData.get("time") ?? "") || null,
        transfer_account: String(formData.get("transfer_account") ?? "") || null,
        type: String(formData.get("type") ?? candidate.transaction_type) as TransactionType
      });
      setActionMessage("Message confirmed and added to the ledger.");
      await loadData(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not confirm candidate.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleReject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectDraft) return;
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before rejecting SMS candidates.");
    setActionError(null);
    setActionMessage(null);
    setWorkingCandidateId(rejectDraft.candidate.id);
    try {
      await rejectMessageCandidate(accessToken, rejectDraft.candidate.id, {
        exclude_provider: rejectDraft.scope === "provider",
        exclude_sender: rejectDraft.scope === "sender",
        note: rejectDraft.note,
        reason: rejectDraft.reason,
        redact_raw_sms: rejectDraft.redact
      });
      setRejectDraft(null);
      setActionMessage("Message rejected. Your capture rules were updated if requested.");
      await loadData(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reject candidate.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleRedact(candidate: ParsedMessageCandidate) {
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before redacting raw SMS messages.");
    setWorkingCandidateId(candidate.id);
    setActionError(null);
    try {
      await redactRawMessage(accessToken, candidate.raw_message.id);
      setActionMessage("Original SMS text was redacted; parsed evidence remains available.");
      await loadData(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not redact raw SMS.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleReprocess(candidate: ParsedMessageCandidate) {
    const accessToken = getAccessToken();
    if (!accessToken) return setActionError("Sign in before re-running the parser.");
    setReprocessingCandidateId(candidate.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const updated = await reprocessMessageCandidate(accessToken, candidate.id);
      setReviewState((current) => current.status === "ready"
        ? { ...current, candidates: current.candidates.map((item) => item.id === updated.id ? updated : item) }
        : current);
      setActionMessage("Parser re-run complete. Review the refreshed fields before confirming.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not re-run the parser.");
    } finally {
      setReprocessingCandidateId(null);
    }
  }

  if (reviewState.status === "loading") return <LoadingState detail="Checking messages and parser confidence" label="Preparing the review inbox" />;
  if (reviewState.status === "error") return <section className="panel"><div className="panel__body"><h2 className="section-title">SMS review inbox</h2><p className="section-subtitle">{reviewState.message}</p></div></section>;

  return (
    <div className="workspace-grid review-workspace">
      <section className="panel">
        <div className="panel__body review-hero">
          <div><h2 className="section-title">SMS review inbox</h2><p className="section-subtitle">Resolve one message at a time. Required corrections are highlighted before confirmation.</p></div>
          <span className="status-badge status-badge--idle">{reviewState.candidates.length} pending</span>
        </div>
      </section>

      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      {actionMessage ? <p className="form-success" role="status"><CheckCircle aria-hidden="true" size={18} weight="fill" />{actionMessage}</p> : null}

      {reviewState.candidates.length === 0 ? (
        <section className="panel"><div className="panel__body empty-state"><CheckCircle aria-hidden="true" size={34} weight="fill" /><h2 className="section-title">Review queue is clear</h2><p className="section-subtitle">No captured messages currently require a decision.</p></div></section>
      ) : (
        <section className="review-split">
          <aside className="panel review-queue" aria-label="Pending messages">
            <div className="review-queue__filters">
              <label className="review-search"><MagnifyingGlass aria-hidden="true" size={18} /><input aria-label="Search review queue" onChange={(event) => setQuery(event.target.value)} placeholder="Search sender or merchant" type="search" value={query} /></label>
              <div className="review-filter-row"><FunnelSimple aria-hidden="true" size={17} /><select aria-label="Filter by provider" onChange={(event) => setProviderFilter(event.target.value)} value={providerFilter}><option value="all">All providers</option>{providers.map((provider) => <option key={provider} value={provider}>{formatLabel(provider)}</option>)}</select><select aria-label="Filter by issue" onChange={(event) => setIssueFilter(event.target.value)} value={issueFilter}><option value="all">All states</option><option value="missing">Needs input</option><option value="ready">Ready to confirm</option></select></div>
            </div>
            <div className="review-queue__list">
              {filteredCandidates.map((candidate) => {
                const issues = candidateIssues(candidate);
                const selected = candidate.id === activeCandidate?.id;
                return <button aria-current={selected ? "true" : undefined} className={`review-queue-item${selected ? " review-queue-item--active" : ""}`} key={candidate.id} onClick={() => setActiveCandidateId(candidate.id)} type="button"><span className="review-queue-item__top"><strong>{candidate.amount ? `BDT ${candidate.amount}` : "Amount needed"}</strong><small>{confidencePercent(candidate.confidence)}</small></span><span>{formatLabel(candidate.provider)} · {formatLabel(candidate.message_kind)}</span><small>{candidate.counterparty_text || candidate.raw_message.sender}</small><span className={issues.length ? "review-queue-item__issue" : "review-queue-item__ready"}>{issues[0] ?? "Ready to confirm"}</span></button>;
              })}
              {!filteredCandidates.length ? <div className="review-queue__empty">No messages match these filters.</div> : null}
            </div>
          </aside>

          {activeCandidate ? (
            <article className="panel review-detail" key={activeCandidate.id}>
              <form onSubmit={(event) => void handleConfirm(activeCandidate, event)}>
                <div className="review-detail__header">
                  <div><span className="review-card__eyebrow">{formatLabel(activeCandidate.provider)} / {formatLabel(activeCandidate.message_kind)}</span><h2 className="review-card__amount">{activeCandidate.amount ? `BDT ${activeCandidate.amount}` : "Complete the amount"}</h2><p className="review-card__confidence">{confidenceLabel(activeCandidate.confidence)} ({confidencePercent(activeCandidate.confidence)})</p></div>
                  <div className="review-detail__pager"><button aria-label="Previous message" disabled={activeIndex <= 0} onClick={() => setActiveCandidateId(filteredCandidates[activeIndex - 1]?.id ?? activeCandidate.id)} type="button"><ArrowLeft size={18} /></button><span>{activeIndex + 1} / {filteredCandidates.length}</span><button aria-label="Next message" disabled={activeIndex >= filteredCandidates.length - 1} onClick={() => setActiveCandidateId(filteredCandidates[activeIndex + 1]?.id ?? activeCandidate.id)} type="button"><ArrowRight size={18} /></button></div>
                </div>

                <div className="review-issue-bar"><Warning aria-hidden="true" size={19} weight="fill" /><div><strong>{reviewReason(activeCandidate)}</strong><span>{formatDateTime(activeCandidate.raw_message.received_at)} · {activeCandidate.raw_message.sender}</span></div></div>
                <div className="review-issue-chips">{candidateIssues(activeCandidate).map((issue) => <span key={issue}>{issue}</span>)}{!candidateIssues(activeCandidate).length ? <span className="review-issue-chip--ready">All required fields detected</span> : null}</div>

                <div className="review-form review-form--focused">
                  <label className="field"><span className="field__label">Account</span><select className="field__control" defaultValue={activeCandidate.account ?? ""} name="account" required><option value="">Select account</option>{reviewState.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                  <label className="field"><span className="field__label">Amount</span><input className="field__control" defaultValue={activeCandidate.amount ?? ""} inputMode="decimal" name="amount" required /></label>
                  <label className="field"><span className="field__label">Type</span><select className="field__control" defaultValue={activeCandidate.transaction_type} name="type">{["expense", "income", "transfer", "fee", "refund", "adjustment"].map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}</select></label>
                  <label className="field"><span className="field__label">Debit / credit</span><select className="field__control" defaultValue={activeCandidate.transaction_type === "income" || activeCandidate.transaction_type === "refund" ? "credit" : "debit"} name="direction"><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
                  <label className="field"><span className="field__label">Category</span><select className="field__control" defaultValue={activeCandidate.category ?? ""} name="category"><option value="">No category</option>{reviewState.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label className="field"><span className="field__label">Payment method</span><select className="field__control" defaultValue={activeCandidate.payment_method ?? ""} name="payment_method"><option value="">No payment method</option>{reviewState.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
                  <label className="field"><span className="field__label">Transfer destination</span><select className="field__control" defaultValue={activeCandidate.destination_account ?? ""} name="transfer_account"><option value="">No destination</option>{reviewState.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                  <label className="field"><span className="field__label">Date</span><input className="field__control" defaultValue={dateInputFromTimestamp(activeCandidate.raw_message.received_at)} name="date" type="date" /></label>
                  <label className="field"><span className="field__label">Time</span><input className="field__control" defaultValue={timeInputFromTimestamp(activeCandidate.raw_message.received_at)} name="time" type="time" /></label>
                  <label className="field"><span className="field__label">Balance after</span><input className="field__control" defaultValue={activeCandidate.balance_after ?? ""} inputMode="decimal" name="balance_after" /></label>
                  <label className="field"><span className="field__label">Merchant / counterparty</span><input className="field__control" defaultValue={activeCandidate.counterparty_text} name="counterparty_text" /></label>
                  <label className="field"><span className="field__label">Reference</span><input className="field__control" defaultValue={activeCandidate.reference} name="reference" /></label>
                  <label className="field field--wide"><span className="field__label">Ledger note</span><input className="field__control" defaultValue={normalizedNote(activeCandidate)} name="note" /><span className="field__hint">The full SMS is not copied into your transaction note.</span></label>
                  <label className="field field--wide review-remember"><input defaultChecked name="remember_mapping" type="checkbox" /><span><strong>Use these choices next time</strong><small>Update this sender’s account, payment method, category, and transaction type.</small></span></label>
                </div>

                <details className="raw-message"><summary>Original SMS and parser evidence</summary><p>{activeCandidate.raw_message.body}</p><p>{activeCandidate.parser_notes}</p>{activeCandidate.raw_message.status !== "redacted" ? <div className="raw-message-actions"><button className="button button--ghost" disabled={reprocessingCandidateId === activeCandidate.id || workingCandidateId === activeCandidate.id} onClick={() => void handleReprocess(activeCandidate)} type="button">{reprocessingCandidateId === activeCandidate.id ? <ButtonBusy label="Re-running parser" /> : <><ArrowClockwise aria-hidden="true" size={18} />Re-run parser</>}</button><button className="button button--ghost" disabled={reprocessingCandidateId === activeCandidate.id || workingCandidateId === activeCandidate.id} onClick={() => void handleRedact(activeCandidate)} type="button">Redact original SMS now</button></div> : <span className="status-badge status-badge--ok">Original SMS redacted</span>}</details>

                <div className="review-sticky-actions"><div><strong>{accountNameById.get(activeCandidate.account ?? "") ?? "Account not selected"}</strong><span>{candidateIssues(activeCandidate).length ? `${candidateIssues(activeCandidate).length} item(s) need attention` : "Ready to add to ledger"}</span></div><button className="button button--danger" disabled={workingCandidateId === activeCandidate.id} onClick={() => setRejectDraft({ candidate: activeCandidate, note: "", reason: "not_transaction", redact: true, scope: "message" })} type="button">Reject</button><button className="button button--primary" disabled={workingCandidateId === activeCandidate.id} type="submit">{workingCandidateId === activeCandidate.id ? <ButtonBusy label="Confirming" /> : "Confirm & add"}</button></div>
              </form>
            </article>
          ) : null}
        </section>
      )}

      {rejectDraft ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="reject-title" aria-modal="true" className="decision-modal" role="dialog"><button aria-label="Close rejection options" className="decision-modal__close" onClick={() => setRejectDraft(null)} type="button"><X size={20} /></button><h2 id="reject-title">Reject this message</h2><p>Choose whether this decision applies only to this message or to future captures as well.</p><form onSubmit={(event) => void handleReject(event)}><label className="field"><span className="field__label">Reason</span><select className="field__control" onChange={(event) => setRejectDraft({ ...rejectDraft, reason: event.target.value })} value={rejectDraft.reason}>{[["not_transaction", "Not a transaction"], ["otp_security", "OTP or security"], ["duplicate", "Duplicate"], ["wrong_provider_account", "Wrong provider or account"], ["personal", "Personal or non-financial"], ["unsupported_format", "Unsupported format"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Apply to</span><select className="field__control" onChange={(event) => setRejectDraft({ ...rejectDraft, scope: event.target.value as RejectDraft["scope"] })} value={rejectDraft.scope}><option value="message">Only this message</option><option value="sender">This message and disable {rejectDraft.candidate.raw_message.sender}</option><option value="provider">This message and exclude all {formatLabel(rejectDraft.candidate.provider)} messages</option></select></label><label className="field"><span className="field__label">Note (optional)</span><input className="field__control" onChange={(event) => setRejectDraft({ ...rejectDraft, note: event.target.value })} value={rejectDraft.note} /></label><label className="review-remember"><input checked={rejectDraft.redact} onChange={(event) => setRejectDraft({ ...rejectDraft, redact: event.target.checked })} type="checkbox" /><span><strong>Redact original SMS now</strong><small>Parsed metadata remains for audit and duplicate protection.</small></span></label><div className="decision-modal__actions"><button className="button button--ghost" onClick={() => setRejectDraft(null)} type="button">Cancel</button><button className="button button--danger" disabled={workingCandidateId === rejectDraft.candidate.id} type="submit">{workingCandidateId === rejectDraft.candidate.id ? <ButtonBusy label="Rejecting" /> : "Reject message"}</button></div></form></section></div> : null}
    </div>
  );
}
