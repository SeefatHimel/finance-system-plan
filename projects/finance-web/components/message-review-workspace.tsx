"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type Category,
  type ParsedMessageCandidate,
  confirmMessageCandidate,
  ignoreMessageCandidate,
  listAccounts,
  listCategories,
  listMessageCandidates,
  redactRawMessage
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type ReviewState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      accounts: Account[];
      candidates: ParsedMessageCandidate[];
      categories: Category[];
      status: "ready";
    };

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function fieldValue(value: string | null | undefined, fallback = "Not detected") {
  return value && value.length > 0 ? value : fallback;
}

function confidencePercent(value: string) {
  const score = Number(value);
  if (Number.isNaN(score)) {
    return "Unknown";
  }
  return `${Math.round(score * 100)}%`;
}

function confidenceLabel(value: string) {
  const score = Number(value);
  if (Number.isNaN(score)) {
    return "Unknown confidence";
  }
  if (score >= 0.85) {
    return "High confidence";
  }
  if (score >= 0.65) {
    return "Medium confidence";
  }
  return "Low confidence";
}

function reviewReason(candidate: ParsedMessageCandidate, related: ParsedMessageCandidate | null) {
  if (candidate.raw_message.duplicate_of) {
    return `Duplicate raw message of ${candidate.raw_message.duplicate_of}.`;
  }
  if (candidate.related_match_reason) {
    return candidate.related_match_reason;
  }
  if (related) {
    return `Possible related ${formatLabel(related.provider)} ${formatLabel(related.message_kind)} candidate.`;
  }
  if (candidate.possible_internal_transfer) {
    return "Possible internal transfer; verify both accounts before confirming.";
  }
  if (!candidate.account || !candidate.amount) {
    return "Missing account or amount; complete required fields before confirming.";
  }
  if (Number(candidate.confidence) < 0.65) {
    return "Low parser confidence; compare against the raw SMS before confirming.";
  }
  return "Parser matched known fields; verify the ledger details before confirming.";
}

export function MessageReviewWorkspace() {
  const [reviewState, setReviewState] = useState<ReviewState>({ status: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [workingCandidateId, setWorkingCandidateId] = useState<string | null>(null);

  async function loadData() {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setReviewState({ message: "Sign in before reviewing SMS candidates.", status: "error" });
      return;
    }

    setReviewState({ status: "loading" });

    try {
      const [accounts, categories, candidates] = await Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        listMessageCandidates(accessToken)
      ]);
      setReviewState({ accounts, candidates, categories, status: "ready" });
    } catch (error) {
      setReviewState({
        message: error instanceof Error ? error.message : "Could not load SMS review inbox.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const accountNameById = useMemo(() => {
    if (reviewState.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(reviewState.accounts.map((account) => [account.id, account.name]));
  }, [reviewState]);

  const candidateById = useMemo(() => {
    if (reviewState.status !== "ready") {
      return new Map<string, ParsedMessageCandidate>();
    }
    return new Map(reviewState.candidates.map((candidate) => [candidate.id, candidate]));
  }, [reviewState]);

  async function handleConfirm(candidate: ParsedMessageCandidate, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setActionError("Sign in before confirming SMS candidates.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    setActionError(null);
    setWorkingCandidateId(candidate.id);

    try {
      await confirmMessageCandidate(accessToken, candidate.id, {
        account: String(formData.get("account") ?? "") || undefined,
        amount: String(formData.get("amount") ?? "") || undefined,
        category: String(formData.get("category") ?? "") || null,
        date: String(formData.get("date") ?? "") || undefined,
        direction: String(formData.get("direction") ?? "") || undefined,
        note: String(formData.get("note") ?? ""),
        transfer_account: String(formData.get("transfer_account") ?? "") || null,
        type: String(formData.get("type") ?? candidate.transaction_type)
      });
      await loadData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not confirm candidate.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleIgnore(candidateId: string) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setActionError("Sign in before ignoring SMS candidates.");
      return;
    }

    setActionError(null);
    setWorkingCandidateId(candidateId);

    try {
      await ignoreMessageCandidate(accessToken, candidateId);
      await loadData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not ignore candidate.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  async function handleRedactRawMessage(candidate: ParsedMessageCandidate) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setActionError("Sign in before redacting raw SMS messages.");
      return;
    }

    const confirmed = window.confirm(
      "Redact the raw SMS body? Parsed fields and transaction evidence stay, but the original SMS text will be replaced."
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setWorkingCandidateId(candidate.id);

    try {
      await redactRawMessage(accessToken, candidate.raw_message.id);
      await loadData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not redact raw SMS.");
    } finally {
      setWorkingCandidateId(null);
    }
  }

  if (reviewState.status === "loading") {
    return (
      <section className="panel">
        <div className="panel__body">
          <span className="status-badge status-badge--idle">Loading review inbox</span>
        </div>
      </section>
    );
  }

  if (reviewState.status === "error") {
    return (
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">SMS review inbox</h1>
          <p className="section-subtitle">{reviewState.message}</p>
        </div>
      </section>
    );
  }

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body review-hero">
          <div>
            <h1 className="section-title">SMS review inbox</h1>
            <p className="section-subtitle">
              Confirm parsed messages only after checking the account, type, and
              transfer hints. Related-message links are suggestions, not automatic merges.
            </p>
          </div>
          <span className="status-badge status-badge--idle">
            {reviewState.candidates.length} pending
          </span>
        </div>
      </section>

      {actionError ? <p className="form-error">{actionError}</p> : null}

      {reviewState.candidates.length === 0 ? (
        <section className="panel">
          <div className="panel__body empty-state">
            <h2 className="section-title">No SMS candidates waiting</h2>
            <p className="section-subtitle">
              Imported SMS messages that need review will appear here.
            </p>
          </div>
        </section>
      ) : (
        <div className="review-list">
          {reviewState.candidates.map((candidate) => {
            const related = candidate.possible_related_candidate
              ? candidateById.get(candidate.possible_related_candidate) ?? null
              : null;
            const isWorking = workingCandidateId === candidate.id;
            const defaultAccount = candidate.account ?? "";
            const defaultDate = candidate.raw_message.received_at.slice(0, 10);
            const reason = reviewReason(candidate, related);

            return (
              <article className="panel review-card" key={candidate.id}>
                <div className="panel__body">
                  <div className="review-card__header">
                    <div>
                      <span className="review-card__eyebrow">
                        {formatLabel(candidate.provider)} / {formatLabel(candidate.message_kind)}
                      </span>
                      <h2 className="review-card__amount">
                        {candidate.amount ? `BDT ${candidate.amount}` : "Amount missing"}
                      </h2>
                      <p className="review-card__confidence">
                        {confidenceLabel(candidate.confidence)} ({confidencePercent(candidate.confidence)})
                      </p>
                    </div>
                    <span className={`status-badge ${candidate.possible_internal_transfer ? "status-badge--idle" : "status-badge--ok"}`}>
                      {candidate.possible_internal_transfer ? "Transfer review" : formatLabel(candidate.transaction_type)}
                    </span>
                  </div>

                  <dl className="review-facts">
                    <div>
                      <dt>Sender</dt>
                      <dd>{candidate.raw_message.sender}</dd>
                    </div>
                    <div>
                      <dt>Received</dt>
                      <dd>{formatDateTime(candidate.raw_message.received_at)}</dd>
                    </div>
                    <div>
                      <dt>Account</dt>
                      <dd>{candidate.account ? accountNameById.get(candidate.account) ?? candidate.account : "Choose on confirm"}</dd>
                    </div>
                    <div>
                      <dt>Counterparty</dt>
                      <dd>{fieldValue(candidate.counterparty_text)}</dd>
                    </div>
                    <div>
                      <dt>Reference</dt>
                      <dd>{fieldValue(candidate.reference)}</dd>
                    </div>
                    <div>
                      <dt>Balance / fee</dt>
                      <dd>
                        {fieldValue(candidate.balance_after, "Balance missing")} / {fieldValue(candidate.fee_amount, "Fee missing")}
                      </dd>
                    </div>
                    <div>
                      <dt>Review reason</dt>
                      <dd>{reason}</dd>
                    </div>
                  </dl>

                  {candidate.possible_internal_transfer || candidate.raw_message.duplicate_of ? (
                    <div className="review-hint">
                      <strong>
                        {candidate.raw_message.duplicate_of ? "Duplicate check" : "Possible internal transfer"}
                      </strong>
                      <span>
                        {related
                          ? `May relate to ${formatLabel(related.provider)} ${related.message_kind} for BDT ${related.amount}.`
                          : reason}
                      </span>
                    </div>
                  ) : null}

                  <details className="raw-message">
                    <summary>Raw SMS and parser notes</summary>
                    <p>{candidate.raw_message.body}</p>
                    <p>{candidate.parser_notes}</p>
                    <p>Raw message status: {candidate.raw_message.status}</p>
                  </details>
                  {candidate.raw_message.status !== "redacted" ? (
                    <button
                      className="button button--ghost review-redact-button"
                      disabled={isWorking}
                      onClick={() => void handleRedactRawMessage(candidate)}
                      type="button"
                    >
                      Redact raw SMS
                    </button>
                  ) : null}

                  <form className="review-form" onSubmit={(event) => void handleConfirm(candidate, event)}>
                    <label className="field">
                      <span className="field__label">Account</span>
                      <select className="field__control" defaultValue={defaultAccount} name="account">
                        <option value="">Select account</option>
                        {reviewState.accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">Amount</span>
                      <input className="field__control" defaultValue={candidate.amount ?? ""} name="amount" />
                    </label>

                    <label className="field">
                      <span className="field__label">Type</span>
                      <select className="field__control" defaultValue={candidate.transaction_type} name="type">
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfer</option>
                        <option value="fee">Fee</option>
                        <option value="refund">Refund</option>
                        <option value="adjustment">Adjustment</option>
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">Debit / credit</span>
                      <select
                        className="field__control"
                        defaultValue={candidate.transaction_type === "income" || candidate.transaction_type === "refund" ? "credit" : "debit"}
                        name="direction"
                      >
                        <option value="debit">Debit</option>
                        <option value="credit">Credit</option>
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">Transfer destination</span>
                      <select className="field__control" defaultValue={candidate.destination_account ?? ""} name="transfer_account">
                        <option value="">No destination</option>
                        {reviewState.accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">Category</span>
                      <select className="field__control" defaultValue="" name="category">
                        <option value="">No category</option>
                        {reviewState.categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">Date</span>
                      <input className="field__control" defaultValue={defaultDate} name="date" type="date" />
                    </label>

                    <label className="field field--wide">
                      <span className="field__label">Note</span>
                      <textarea className="field__control" defaultValue={candidate.raw_message.body} name="note" rows={3} />
                    </label>

                    <div className="review-actions">
                      <button className="button button--primary" disabled={isWorking} type="submit">
                        {isWorking ? "Working..." : "Confirm"}
                      </button>
                      <button
                        className="button button--danger"
                        disabled={isWorking}
                        onClick={() => void handleIgnore(candidate.id)}
                        type="button"
                      >
                        Ignore
                      </button>
                    </div>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
