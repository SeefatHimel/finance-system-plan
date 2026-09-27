"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  type Account,
  type HealthStatus,
  type MonthlyReport,
  type Transaction,
  getMonthlyReport,
  listAccounts,
  listTransactions
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { SessionPanel } from "@/components/session-panel";

type DashboardState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { accounts: Account[]; report: MonthlyReport; status: "ready"; transactions: Transaction[] };

const money = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  maximumFractionDigits: 0,
  style: "currency"
});

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function DashboardWorkspace({ health }: { health: HealthStatus }) {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setState({ message: "Sign in to load your financial overview.", status: "error" });
      return;
    }

    Promise.all([
      listAccounts(accessToken),
      getMonthlyReport(accessToken, currentMonth()),
      listTransactions(accessToken)
    ])
      .then(([accounts, report, transactions]) => setState({ accounts, report, status: "ready", transactions }))
      .catch((error) => setState({ message: error instanceof Error ? error.message : "Could not load dashboard.", status: "error" }));
  }, []);

  const recentTransactions = useMemo(
    () => state.status === "ready" ? state.transactions.slice(0, 5) : [],
    [state]
  );

  if (state.status === "loading") {
    return <div className="dashboard-skeleton" aria-label="Loading dashboard"><span /><span /><span /></div>;
  }

  if (state.status === "error") {
    return (
      <div className="dashboard-grid">
        <section className="panel"><div className="panel__body empty-state"><h2 className="section-title">Welcome to Finance</h2><p className="section-subtitle">{state.message}</p><Link className="button button--primary" href="/login">Sign in</Link></div></section>
        <aside className="panel"><div className="panel__body"><h2 className="section-title">System status</h2><div className="status-list"><div className="status-row"><span className="status-row__label">Finance API</span><span className={`status-badge status-badge--${health.state}`}>{health.label}</span></div></div></div></aside>
      </div>
    );
  }

  return (
    <div className="workspace-grid">
      <section className="metric-strip" aria-label="Monthly summary">
        <div className="metric metric--primary"><span className="metric__label">Income this month</span><strong className="metric__value">{money.format(Number(state.report.income_total))}</strong></div>
        <div className="metric"><span className="metric__label">Expenses this month</span><strong className="metric__value">{money.format(Number(state.report.expense_total))}</strong></div>
        <div className="metric"><span className="metric__label">Net movement</span><strong className="metric__value">{money.format(Number(state.report.net_total))}</strong></div>
        <div className="metric"><span className="metric__label">Active accounts</span><strong className="metric__value">{state.accounts.filter((account) => account.is_active).length}</strong></div>
      </section>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel__body">
            <div className="section-header"><div><h2 className="section-title">Recent transactions</h2><p className="section-subtitle">Your latest recorded money movement.</p></div><Link className="button button--ghost" href="/transactions">View all</Link></div>
            {recentTransactions.length === 0 ? (
              <div className="empty-state empty-state--centered"><strong>No transactions yet</strong><span>Add your first transaction to begin building your ledger.</span><Link className="button button--primary" href="/transactions">Add transaction</Link></div>
            ) : (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="align-right">Amount</th></tr></thead><tbody>{recentTransactions.map((transaction) => <tr key={transaction.id}><td>{transaction.date}</td><td><span className="type-label">{transaction.type.replaceAll("_", " ")}</span></td><td>{transaction.counterparty_text || transaction.reference || "—"}</td><td className="align-right amount-cell">{money.format(Number(transaction.amount))}</td></tr>)}</tbody></table></div>
            )}
          </div>
        </section>

        <aside className="workspace-rail">
          <section className="panel"><div className="panel__body"><h2 className="section-title">Quick actions</h2><div className="quick-actions"><Link href="/transactions">Add transaction<span>→</span></Link><Link href="/accounts">Manage accounts<span>→</span></Link><Link href="/messages/review">Review SMS imports<span>→</span></Link></div></div></section>
          <section className="panel"><div className="panel__body"><h2 className="section-title">Session & system</h2><div className="section-block"><SessionPanel /></div><div className="status-row"><span className="status-row__label">Finance API</span><span className={`status-badge status-badge--${health.state}`}>{health.label}</span></div></div></section>
        </aside>
      </div>
    </div>
  );
}
