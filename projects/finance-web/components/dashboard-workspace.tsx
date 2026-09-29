"use client";

import {
  ArrowRight,
  ChatCenteredText,
  CheckCircle,
  CreditCard,
  DeviceMobile,
  FileText,
  Info,
  Plus,
  Receipt,
  ShieldCheck,
  Warning,
  XCircle
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import {
  type Account,
  type Category,
  type HealthStatus,
  type MonthlyReport,
  type ParsedMessageCandidate,
  type Transaction,
  getMonthlyReport,
  listAccounts,
  listCategories,
  listMessageCandidates,
  listTransactions
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type DashboardState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      accounts: Account[];
      candidates: ParsedMessageCandidate[];
      categories: Category[];
      report: MonthlyReport;
      status: "ready";
      transactions: Transaction[];
    };

type CashFlowPoint = {
  date: string;
  inflow: number;
  outflow: number;
};

const money = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  maximumFractionDigits: 0,
  style: "currency"
});

const compactNumber = new Intl.NumberFormat("en", {
  maximumFractionDigits: 0,
  notation: "compact"
});

const categoryColors = ["#55e6a5", "#5d9bff", "#9973f0", "#ff706a", "#ffbe4f", "#66758f"];

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function signedMoney(amount: number, direction: string) {
  const prefix = direction === "credit" ? "+" : "-";
  return `${prefix}${money.format(Math.abs(amount))}`;
}

function sourceLabel(source: string) {
  if (source === "sms") return "SMS";
  return titleCase(source);
}

function candidateReason(candidate: ParsedMessageCandidate) {
  const confidence = Number(candidate.confidence);
  if (candidate.possible_internal_transfer) return "Possible transfer";
  if (!candidate.account || !candidate.amount) return "Missing details";
  if (confidence >= 0.85) return "Ready to confirm";
  return "Category needed";
}

function candidateTone(candidate: ParsedMessageCandidate) {
  const confidence = Number(candidate.confidence);
  if (confidence >= 0.85) return "success";
  if (confidence >= 0.65) return "warning";
  return "danger";
}

function candidateIcon(provider: string) {
  if (provider.includes("bank") || provider === "card") return CreditCard;
  if (provider === "bkash" || provider === "nagad" || provider === "rocket") return DeviceMobile;
  return ChatCenteredText;
}

function latestMessageLabel(candidates: ParsedMessageCandidate[]) {
  const latestReceivedAt = candidates.reduce(
    (latest, candidate) => candidate.raw_message.received_at > latest ? candidate.raw_message.received_at : latest,
    ""
  );
  if (!latestReceivedAt) return "No messages synced yet";
  return `Last message ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  }).format(new Date(latestReceivedAt))}`;
}

function buildCashFlowData(transactions: Transaction[]): CashFlowPoint[] {
  const byDate = new Map<string, { inflow: number; outflow: number }>();

  for (const transaction of [...transactions].reverse()) {
    const entry = byDate.get(transaction.date) ?? { inflow: 0, outflow: 0 };
    const amount = Number(transaction.amount);
    if (transaction.direction === "credit") entry.inflow += amount;
    else entry.outflow += amount;
    byDate.set(transaction.date, entry);
  }

  let inflow = 0;
  let outflow = 0;
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => {
      inflow += value.inflow;
      outflow += value.outflow;
      return {
        date: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00`)),
        inflow,
        outflow
      };
    });
}

function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  return (
    <div className="cash-flow-chart" aria-label="Thirty day cash flow chart">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={{ bottom: 0, left: -12, right: 8, top: 14 }}>
          <CartesianGrid stroke="#24364d" strokeDasharray="0" vertical={false} />
          <XAxis axisLine={false} dataKey="date" minTickGap={32} tick={{ fill: "#92a1ba", fontSize: 11 }} tickLine={false} />
          <YAxis axisLine={false} tick={{ fill: "#92a1ba", fontSize: 11 }} tickFormatter={(value) => compactNumber.format(value)} tickLine={false} width={58} />
          <Tooltip
            contentStyle={{ background: "#111f31", border: "1px solid #2c4059", borderRadius: 8, color: "#f7f9fc" }}
            formatter={(value) => money.format(Number(value))}
          />
          <Area dataKey="outflow" fill="#6f7e99" fillOpacity={0.06} isAnimationActive={false} name="Outflow" stroke="#6f7e99" strokeWidth={2} type="monotone" />
          <Area dataKey="inflow" fill="#55e6a5" fillOpacity={0.12} isAnimationActive={false} name="Inflow" stroke="#55e6a5" strokeWidth={2.5} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SpendingChart({ categories, expenseCategoryNames }: { categories: MonthlyReport["categories"]; expenseCategoryNames: Set<string> }) {
  const data = categories
    .map((category) => ({ amount: Number(category.amount), name: category.name }))
    .filter((category) => category.amount > 0 && expenseCategoryNames.has(category.name))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);
  const total = data.reduce((sum, category) => sum + category.amount, 0);

  if (data.length === 0) {
    return <div className="chart-empty">Spending categories will appear as transactions are recorded.</div>;
  }

  return (
    <div className="spending-chart-layout">
      <div className="spending-donut" aria-label="Spending by category chart">
        <ResponsiveContainer height="100%" width="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" innerRadius="63%" isAnimationActive={false} nameKey="name" outerRadius="92%" paddingAngle={1} stroke="#102033" strokeWidth={2}>
              {data.map((category, index) => <Cell fill={categoryColors[index]} key={category.name} />)}
            </Pie>
            <Tooltip
              contentStyle={{ background: "#111f31", border: "1px solid #2c4059", borderRadius: 8, color: "#f7f9fc" }}
              formatter={(value) => money.format(Number(value))}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="spending-donut__label"><span>BDT</span><strong>{compactNumber.format(total)}</strong><span>spent</span></div>
      </div>
      <div className="spending-legend">
        {data.map((category, index) => (
          <div className="spending-legend__row" key={category.name}>
            <span className="spending-legend__dot" style={{ backgroundColor: categoryColors[index] }} />
            <span className="spending-legend__name">{category.name}</span>
            <strong>{Math.round((category.amount / total) * 100)}%</strong>
            <span>{money.format(category.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
      listCategories(accessToken),
      listMessageCandidates(accessToken),
      getMonthlyReport(accessToken, currentMonth()),
      listTransactions(accessToken)
    ])
      .then(([accounts, categories, candidates, report, transactions]) => {
        setState({ accounts, candidates, categories, report, status: "ready", transactions });
      })
      .catch((error) => {
        setState({ message: error instanceof Error ? error.message : "Could not load dashboard.", status: "error" });
      });
  }, []);

  const dashboardData = useMemo(() => {
    if (state.status !== "ready") return null;

    const accountById = new Map(state.accounts.map((account) => [account.id, account.name]));
    const categoryById = new Map(state.categories.map((category) => [category.id, category.name]));
    const automatedTransactions = state.transactions.filter((transaction) => transaction.source === "sms" || transaction.source === "mobile");
    const transactionMovement = state.transactions.reduce((total, transaction) => {
      const amount = Number(transaction.amount);
      return total + (transaction.direction === "credit" ? amount : -amount);
    }, 0);
    const startingBalance = state.accounts.reduce((total, account) => total + Number(account.starting_balance), 0);

    return {
      accountById,
      automatedTransactions,
      captureCount: automatedTransactions.length + state.candidates.length,
      cashFlow: buildCashFlowData(state.transactions),
      categoryById,
      expenseCategoryNames: new Set(state.categories.filter((category) => category.kind === "expense").map((category) => category.name)),
      lastSyncLabel: latestMessageLabel(state.candidates),
      netPosition: startingBalance + transactionMovement,
      recentTransactions: state.transactions.slice(0, 4)
    };
  }, [state]);

  if (state.status === "loading") {
    return <div className="dashboard-skeleton dashboard-skeleton--dark" aria-label="Loading dashboard"><span /><span /><span /></div>;
  }

  if (state.status === "error" || dashboardData === null) {
    const message = state.status === "error" ? state.message : "Could not load dashboard.";
    return (
      <section className="dashboard-panel dashboard-error-state">
        <ShieldCheck aria-hidden="true" size={32} />
        <h2>Welcome to Finance</h2>
        <p>{message}</p>
        <Link className="dashboard-button dashboard-button--primary" href="/login">Sign in</Link>
        <span className={`health-state health-state--${health.state}`}>Finance API: {health.label}</span>
      </section>
    );
  }

  const pendingCount = state.candidates.length;
  const autoPostedCount = dashboardData.automatedTransactions.length;
  const netMovement = Number(state.report.net_total);

  return (
    <div className="automation-dashboard">
      <section className="dashboard-hero-grid">
        <article className="dashboard-panel net-position-panel">
          <div className="net-position-panel__summary">
            <div>
              <div className="panel-label">Net position <Info aria-hidden="true" size={15} /></div>
              <strong className="net-position-value"><span>BDT</span> {new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(dashboardData.netPosition)}</strong>
              <p className={`net-position-change${netMovement < 0 ? " net-position-change--negative" : ""}`}>
                {netMovement >= 0 ? "+" : "-"}{money.format(Math.abs(netMovement))} <span>this month</span>
              </p>
            </div>
            <div className="chart-heading">
              <span>30-day cash flow</span>
              <div><span><i className="legend-dot legend-dot--inflow" />Inflow</span><span><i className="legend-dot legend-dot--outflow" />Outflow</span></div>
            </div>
          </div>
          <CashFlowChart data={dashboardData.cashFlow} />
        </article>

        <article className="dashboard-panel automation-status-panel">
          <h2>Automation status</h2>
          <div className="mobile-sync-status"><span><CheckCircle aria-hidden="true" size={18} weight="fill" />Mobile sync healthy</span><small>{dashboardData.lastSyncLabel}</small></div>
          <div className="automation-stats">
            <div><FileText aria-hidden="true" className="automation-stat-icon automation-stat-icon--info" size={27} /><strong>{dashboardData.captureCount}</strong><span>Captured</span></div>
            <div><CheckCircle aria-hidden="true" className="automation-stat-icon automation-stat-icon--success" size={27} /><strong>{autoPostedCount}</strong><span>Auto-posted</span></div>
            <div><Warning aria-hidden="true" className="automation-stat-icon automation-stat-icon--warning" size={27} /><strong>{pendingCount}</strong><span>Need review</span></div>
            <div><XCircle aria-hidden="true" className="automation-stat-icon automation-stat-icon--danger" size={27} /><strong>0</strong><span>Failed</span></div>
          </div>
          <div className="automation-actions">
            <Link className="dashboard-button dashboard-button--review" href="/messages/review">Review {pendingCount} transactions <ArrowRight aria-hidden="true" size={17} /></Link>
            <Link className="dashboard-text-link" href="/audit-logs">Sync activity <ArrowRight aria-hidden="true" size={16} /></Link>
          </div>
        </article>
      </section>

      <section className="dashboard-middle-grid">
        <article className="dashboard-panel spending-panel">
          <h2>Spending by category</h2>
          <SpendingChart categories={state.report.categories} expenseCategoryNames={dashboardData.expenseCategoryNames} />
        </article>

        <article className="dashboard-panel attention-panel">
          <div className="dashboard-panel__heading"><h2>Needs attention ({pendingCount})</h2><Link href="/messages/review">View all <ArrowRight aria-hidden="true" size={15} /></Link></div>
          {state.candidates.length === 0 ? (
            <div className="attention-empty"><CheckCircle aria-hidden="true" size={24} weight="fill" /><span>No imported messages need review.</span></div>
          ) : (
            <div className="attention-list">
              {state.candidates.slice(0, 3).map((candidate) => {
                const CandidateIcon = candidateIcon(candidate.provider);
                const tone = candidateTone(candidate);
                const confidence = Math.round(Number(candidate.confidence) * 100);
                return (
                  <Link className="attention-row" href="/messages/review" key={candidate.id}>
                    <span className={`attention-row__icon attention-row__icon--${tone}`}><CandidateIcon aria-hidden="true" size={22} weight="fill" /></span>
                    <span className="attention-row__subject"><strong>{titleCase(candidate.provider)} {titleCase(candidate.message_kind)}</strong><small>{formatDate(candidate.raw_message.received_at.slice(0, 10))} · SMS</small></span>
                    <span className={`attention-row__confidence attention-row__confidence--${tone}`}><strong>{confidence}%</strong><small>confidence</small></span>
                    <span className={`attention-row__reason attention-row__reason--${tone}`}><strong>{candidateReason(candidate)}</strong><small>{confidence >= 85 ? "Looks good" : "Needs your review"}</small></span>
                    <ArrowRight aria-hidden="true" className="attention-row__arrow" size={16} />
                  </Link>
                );
              })}
            </div>
          )}
        </article>
      </section>

      <section className="dashboard-panel recent-transactions-panel">
        <div className="dashboard-panel__heading recent-transactions-heading">
          <h2>Recent transactions</h2>
          <div><Link className="dashboard-button dashboard-button--secondary" href="/transactions"><Plus aria-hidden="true" size={15} />Add transaction</Link><Link href="/transactions">View all <ArrowRight aria-hidden="true" size={15} /></Link></div>
        </div>
        {dashboardData.recentTransactions.length === 0 ? (
          <div className="dashboard-empty"><Receipt aria-hidden="true" size={28} /><strong>No transactions yet</strong><span>Synced and manually recorded activity will appear here.</span></div>
        ) : (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th>Source</th><th>Import</th><th>Status</th><th>Amount (BDT)</th></tr></thead>
              <tbody>
                {dashboardData.recentTransactions.map((transaction) => {
                  const isAutomated = transaction.source === "sms" || transaction.source === "mobile";
                  return (
                    <tr key={transaction.id}>
                      <td>{formatDate(transaction.date)}</td>
                      <td><span className="transaction-description-icon"><Receipt aria-hidden="true" size={17} /></span><strong>{transaction.counterparty_text || transaction.reference || titleCase(transaction.type)}</strong><small>{transaction.reference || titleCase(transaction.type)}</small></td>
                      <td>{dashboardData.accountById.get(transaction.account) ?? "Unknown account"}</td>
                      <td>{transaction.category ? dashboardData.categoryById.get(transaction.category) ?? "Uncategorized" : "Uncategorized"}</td>
                      <td><span className="table-source-icon">{transaction.source === "sms" ? <ChatCenteredText aria-hidden="true" size={16} /> : transaction.source === "mobile" ? <DeviceMobile aria-hidden="true" size={16} /> : <FileText aria-hidden="true" size={16} />}{sourceLabel(transaction.source)}</span></td>
                      <td className="import-cell">{isAutomated ? "Verified" : "Manual"}</td>
                      <td><span className={`transaction-status${isAutomated ? " transaction-status--posted" : ""}`}><CheckCircle aria-hidden="true" size={14} weight="fill" />Posted</span></td>
                      <td className={`dashboard-amount${transaction.direction === "credit" ? " dashboard-amount--credit" : ""}`}>{signedMoney(Number(transaction.amount), transaction.direction)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
