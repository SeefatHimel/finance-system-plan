"use client";

import type React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type Account,
  type AccountReconciliation,
  type BalanceSnapshot,
  createBalanceSnapshot,
  getAccountReconciliation,
  listAccounts,
  listBalanceSnapshots
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { ButtonBusy, LoadingState } from "@/components/loading-state";

type ReconciliationState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; snapshots: BalanceSnapshot[]; status: "ready" };

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

function formatMoney(value: string) {
  return moneyFormatter.format(Number(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function nowLocalInputValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function toApiDateTime(value: string) {
  return new Date(value).toISOString();
}

function statusBadgeClass(status: string) {
  if (status === "matched") {
    return "status-badge status-badge--ok";
  }
  if (status === "adjusted" || status === "ignored") {
    return "status-badge status-badge--idle";
  }
  return "status-badge status-badge--error";
}

function differenceReason(status: string, difference: string) {
  const amount = Number(difference);

  if (status === "matched" || amount === 0) {
    return "Ledger matches the real balance.";
  }
  if (amount < 0) {
    return "Actual balance is lower. Check for missing expenses, fees, or duplicate income.";
  }
  return "Actual balance is higher. Check for missing income, refunds, or duplicate expenses.";
}

export function ReconciliationWorkspace() {
  const [state, setState] = useState<ReconciliationState>({ status: "loading" });
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [accountCheck, setAccountCheck] = useState<AccountReconciliation | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const loadAccountCheck = useCallback(async (accessToken: string, accountId: string) => {
    if (!accountId) {
      setAccountCheck(null);
      return;
    }

    setIsChecking(true);
    try {
      setAccountCheck(await getAccountReconciliation(accessToken, accountId));
    } finally {
      setIsChecking(false);
    }
  }, []);

  const loadReconciliation = useCallback(async (preferredAccountId?: string, showLoading = true) => {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setState({ message: "Sign in before reconciling balances.", status: "error" });
      return;
    }

    if (showLoading) {
      setState({ status: "loading" });
    }

    try {
      const [accounts, snapshots] = await Promise.all([
        listAccounts(accessToken),
        listBalanceSnapshots(accessToken)
      ]);
      const nextAccountId = preferredAccountId || accounts[0]?.id || "";

      setState({ accounts, snapshots, status: "ready" });
      setSelectedAccountId(nextAccountId);
      await loadAccountCheck(accessToken, nextAccountId);
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : "Could not load reconciliation data.",
        status: "error"
      });
    }
  }, [loadAccountCheck]);

  useEffect(() => {
    void loadReconciliation();
  }, [loadReconciliation]);

  const accountNames = useMemo(() => {
    if (state.status !== "ready") {
      return new Map<string, string>();
    }
    return new Map(state.accounts.map((account) => [account.id, account.name]));
  }, [state]);

  const totals = useMemo(() => {
    if (state.status !== "ready") {
      return {
        checkedAccounts: 0,
        matched: 0,
        totalDifference: 0,
        warnings: 0
      };
    }

    const latestByAccount = new Map<string, BalanceSnapshot>();

    for (const snapshot of state.snapshots) {
      const current = latestByAccount.get(snapshot.account);
      if (!current || new Date(snapshot.checked_at) > new Date(current.checked_at)) {
        latestByAccount.set(snapshot.account, snapshot);
      }
    }

    return Array.from(latestByAccount.values()).reduce(
      (summary, snapshot) => {
        const difference = Number(snapshot.difference);
        summary.checkedAccounts += 1;
        summary.totalDifference += Math.abs(difference);
        if (snapshot.status === "matched") {
          summary.matched += 1;
        } else {
          summary.warnings += 1;
        }
        return summary;
      },
      {
        checkedAccounts: 0,
        matched: 0,
        totalDifference: 0,
        warnings: 0
      }
    );
  }, [state]);

  const latestSnapshot = accountCheck?.latest_snapshot ?? null;

  async function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before checking an account.");
      return;
    }

    setFormError(null);
    try {
      await loadAccountCheck(accessToken, accountId);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not check account balance.");
    }
  }

  async function handleCreateSnapshot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = getAccessToken();

    if (!accessToken) {
      setFormError("Sign in before saving a balance snapshot.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const account = String(formData.get("account") ?? "");
    const checkedAt = String(formData.get("checked_at") ?? "");

    if (!account || !checkedAt) {
      setFormError("Account and checked time are required.");
      return;
    }

    setFormError(null);
    setIsSaving(true);

    try {
      await createBalanceSnapshot(accessToken, {
        account,
        actual_balance: String(formData.get("actual_balance") ?? ""),
        checked_at: toApiDateTime(checkedAt),
        note: String(formData.get("note") ?? "")
      });
      form.reset();
      await loadReconciliation(account, false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save balance snapshot.");
    } finally {
      setIsSaving(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState detail="Comparing ledger totals with recorded balances" label="Preparing reconciliation" />;
  }

  if (state.status === "error") {
    return (
      <section className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Balance reconciliation</h1>
          <p className="section-subtitle">{state.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <h1 className="section-title">Balance reconciliation</h1>
          <p className="section-subtitle">
            Compare expected ledger balances with real account balances and flag missing or extra money.
          </p>

          <div className="metric-row">
            <div className="metric">
              <span className="metric__label">Checked accounts</span>
              <span className="metric__value">{totals.checkedAccounts}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Matched</span>
              <span className="metric__value">{totals.matched}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Warnings / difference</span>
              <span className="metric__value">
                {totals.warnings} / {moneyFormatter.format(totals.totalDifference)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {formError ? <p className="form-error">{formError}</p> : null}

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Check an account</h2>
          {state.accounts.length === 0 ? (
            <div className="empty-state">
              <p>Create an account before reconciling balances.</p>
            </div>
          ) : (
            <div className="transaction-form">
              <label className="field">
                <span className="field__label">Account</span>
                <select
                  className="field__control"
                  onChange={(event) => void handleAccountChange(event.target.value)}
                  value={selectedAccountId}
                >
                  {state.accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="metric">
                <span className="metric__label">Expected balance</span>
                <span className="metric__value">
                  {isChecking || !accountCheck ? "Checking..." : formatMoney(accountCheck.expected_balance)}
                </span>
              </div>
              <div className="metric">
                <span className="metric__label">Latest snapshot</span>
                <span className="metric__value">
                  {latestSnapshot
                    ? formatMoney(latestSnapshot.actual_balance)
                    : "No snapshot"}
                </span>
              </div>
              <div className="metric">
                <span className="metric__label">Difference</span>
                <span className="metric__value">
                  {latestSnapshot ? formatMoney(latestSnapshot.difference) : "-"}
                </span>
              </div>
              <div className="metric">
                <span className="metric__label">Status</span>
                <span className="metric__value">
                  {latestSnapshot ? (
                    <span className={statusBadgeClass(latestSnapshot.status)}>
                      {formatLabel(latestSnapshot.status)}
                    </span>
                  ) : "-"}
                </span>
              </div>
              <div className="metric field--wide">
                <span className="metric__label">Likely check</span>
                <span className="metric__value">
                  {latestSnapshot ? differenceReason(latestSnapshot.status, latestSnapshot.difference) : "-"}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Save balance snapshot</h2>
          <form className="transaction-form" onSubmit={handleCreateSnapshot}>
            <label className="field">
              <span className="field__label">Account</span>
              <select
                className="field__control"
                name="account"
                onChange={(event) => void handleAccountChange(event.target.value)}
                required
                value={selectedAccountId}
              >
                <option value="">Select account</option>
                {state.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Actual balance</span>
              <input className="field__control" min="0" name="actual_balance" required step="0.01" type="number" />
            </label>
            <label className="field">
              <span className="field__label">Checked time</span>
              <input
                className="field__control"
                defaultValue={nowLocalInputValue()}
                name="checked_at"
                required
                type="datetime-local"
              />
            </label>
            <label className="field">
              <span className="field__label">Note</span>
              <input className="field__control" name="note" />
            </label>
            <button className="button button--primary field--wide" disabled={isSaving} type="submit">
              {isSaving ? <ButtonBusy label="Saving" /> : "Save snapshot"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Snapshot history</h2>
          {state.snapshots.length === 0 ? (
            <div className="empty-state">
              <p>No balance snapshots yet.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Checked</th>
                    <th>Actual</th>
                    <th>Expected</th>
                    <th>Difference</th>
                    <th>Status</th>
                    <th>Likely check</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {state.snapshots.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td>{accountNames.get(snapshot.account) ?? snapshot.account}</td>
                      <td>{formatDateTime(snapshot.checked_at)}</td>
                      <td>{formatMoney(snapshot.actual_balance)}</td>
                      <td>{formatMoney(snapshot.expected_balance)}</td>
                      <td>{formatMoney(snapshot.difference)}</td>
                      <td>
                        <span className={statusBadgeClass(snapshot.status)}>{formatLabel(snapshot.status)}</span>
                      </td>
                      <td>{differenceReason(snapshot.status, snapshot.difference)}</td>
                      <td>{snapshot.note || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
