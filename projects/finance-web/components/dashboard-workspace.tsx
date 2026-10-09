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
  type SmsDeviceStatus,
  type Transaction,
  getPeriodReport,
  getSmsDeviceStatus,
  listAccounts,
  listCategories,
  listMessageCandidates,
  listTransactions
} from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { LoadingState } from "@/components/loading-state";
import { DatePeriodControls } from "@/components/date-period-controls";
import { monthPeriod, type DatePeriod } from "@/lib/date-period";

type DashboardState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      accounts: Account[];
      candidates: ParsedMessageCandidate[];
      categories: Category[];
      deviceStatus: SmsDeviceStatus;
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

function buildCashFlowData(daily: MonthlyReport["daily"]): CashFlowPoint[] {
  return daily.map(day => ({
    date: formatDate(day.date), inflow: Number(day.income_total), outflow: Number(day.expense_total)
  }));
}

function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="cash-flow-empty">
        <Receipt aria-hidden="true" size={28} />
        <strong>No confirmed activity yet</strong>
        <span>Review captured messages or add a transaction to start your cash-flow history.</span>
        <Link href="/messages/review">Review messages <ArrowRight aria-hidden="true" size={15} /></Link>
      </div>
    );
  }
  return (
    <div className="cash-flow-chart" aria-label="Daily income and spending for the selected period">
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

function SpendingChart({ categories }: { categories: MonthlyReport["categories"] }) {
  const data = categories
    .map((category) => ({ amount: Number(category.amount), name: category.name }))
    .filter((category) => category.amount > 0)
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
  const [range, setRange] = useState<DatePeriod>(monthPeriod);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [periodError, setPeriodError] = useState("");

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      setState({ message: "Sign in to load your financial overview.", status: "error" });
      return;
    }

    let active = true;
    const controller = new AbortController();
    setPeriodLoading(true);
    setPeriodError("");
    const timer = window.setTimeout(() => {
      Promise.all([
        listAccounts(accessToken),
        listCategories(accessToken),
        listMessageCandidates(accessToken),
        getSmsDeviceStatus(accessToken),
        getPeriodReport(accessToken, range.start, range.end, controller.signal),
        listTransactions(accessToken, { start_date: range.start, end_date: range.end }, controller.signal)
      ])
        .then(([accounts, categories, candidates, deviceStatus, report, transactions]) => {
          if (active) setState({ accounts, candidates, categories, deviceStatus, report, status: "ready", transactions });
        })
        .catch((error) => {
          if (!active) return;
          const message = error instanceof Error ? error.message : "Could not load dashboard.";
          setPeriodError(message);
          setState(previous => previous.status === "ready" ? previous : { message, status: "error" });
        })
        .finally(() => { if (active) setPeriodLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [range.start, range.end]);

  const dashboardData = useMemo(() => {
    if (state.status !== "ready") return null;

    const accountById = new Map(state.accounts.map((account) => [account.id, account.name]));
    const categoryById = new Map(state.categories.map((category) => [category.id, category.name]));
    const automatedTransactions = state.transactions.filter((transaction) => transaction.source === "sms" || transaction.source === "mobile");
    const ledgerBalance = state.accounts
      .filter((account) => account.currency === "BDT")
      .reduce((total, account) => total + Number(account.ledger_balance), 0);

    return {
      accountById,
      automatedTransactions,
      captureCount: automatedTransactions.length + state.candidates.length,
      cashFlow: buildCashFlowData(state.report.daily),
      categoryById,
      lastSyncLabel: state.deviceStatus.last_successful_sync_at
        ? `Last successful sync ${new Intl.DateTimeFormat("en-US", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }).format(new Date(state.deviceStatus.last_successful_sync_at))}`
        : state.deviceStatus.health_label,
      netPosition: ledgerBalance,
      recentTransactions: state.transactions.slice(0, 4)
    };
  }, [state]);

  if (state.status === "loading") {
    return <LoadingState detail="Reconciling balances, activity, and mobile imports" label="Building your financial picture" variant="dashboard" />;
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

  const periodLabel = state.report.start_date === state.report.end_date ? formatDate(state.report.start_date) : `${formatDate(state.report.start_date)} – ${formatDate(state.report.end_date)}`;
  const pendingCount = state.candidates.length;
  const autoPostedCount = dashboardData.automatedTransactions.length;
  const netMovement = Number(state.report.net_total);
  const syncHealthy = state.deviceStatus.health_state === "healthy";
  const syncNeedsAttention = ["background_disabled", "error", "offline", "permission_required"].includes(state.deviceStatus.health_state);

  return (
    <div className="automation-dashboard">
      <section className="dashboard-panel dashboard-date-controls" aria-label="Dashboard date controls">
        <DatePeriodControls label="Dashboard dates" allowAll={false} value={range} onChange={setRange} />
        <p role="status">{periodLoading ? "Updating selected period…" : `Showing ${periodLabel}`}. Current balances and review queue stay live.</p>
        {periodError ? <p className="form-error" role="alert">{periodError}</p> : null}
      </section>
      <section className="dashboard-period-totals" aria-label="Selected period totals" aria-busy={periodLoading}>
        <article className="dashboard-panel"><span>Income</span><strong>{money.format(Number(state.report.income_total))}</strong></article>
        <article className="dashboard-panel"><span>Spending</span><strong>{money.format(Number(state.report.expense_total))}</strong></article>
        <article className="dashboard-panel"><span>Net movement</span><strong>{money.format(netMovement)}</strong></article>
      </section>
      <section className="dashboard-hero-grid">
        <article className="dashboard-panel net-position-panel">
          <div className="net-position-panel__summary">
            <div>
              <div className="panel-label">Net position <Info aria-hidden="true" size={15} /></div>
              <strong className="net-position-value"><span>BDT</span> {new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 }).format(dashboardData.netPosition)}</strong>
              <p className={`net-position-change${netMovement < 0 ? " net-position-change--negative" : ""}`}>
                {netMovement >= 0 ? "+" : "-"}{money.format(Math.abs(netMovement))} <span>for {periodLabel}</span>
              </p>
            </div>
            <div className="chart-heading">
              <span>Daily cash flow</span>
              <div><span><i className="legend-dot legend-dot--inflow" />Inflow</span><span><i className="legend-dot legend-dot--outflow" />Outflow</span></div>
            </div>
          </div>
          <CashFlowChart data={dashboardData.cashFlow} />
        </article>

        <article className="dashboard-panel automation-status-panel">
          <h2>Automation status</h2>
          <div className={`mobile-sync-status${syncNeedsAttention ? " mobile-sync-status--error" : syncHealthy ? " mobile-sync-status--healthy" : " mobile-sync-status--pending"}`}>
            <span>{syncNeedsAttention ? <Warning aria-hidden="true" size={18} weight="fill" /> : <CheckCircle aria-hidden="true" size={18} weight="fill" />}{state.deviceStatus.health_label}</span>
            <small>{dashboardData.lastSyncLabel}</small>
          </div>
          <div className="automation-stats">
            <div><FileText aria-hidden="true" className="automation-stat-icon automation-stat-icon--info" size={27} /><strong>{dashboardData.captureCount}</strong><span>Captured</span></div>
            <div><CheckCircle aria-hidden="true" className="automation-stat-icon automation-stat-icon--success" size={27} /><strong>{autoPostedCount}</strong><span>Auto-posted</span></div>
            <div><Warning aria-hidden="true" className="automation-stat-icon automation-stat-icon--warning" size={27} /><strong>{pendingCount}</strong><span>Need review</span></div>
            <div><XCircle aria-hidden="true" className="automation-stat-icon automation-stat-icon--danger" size={27} /><strong>{state.deviceStatus.failed_upload_count}</strong><span>Failed</span></div>
          </div>
          <div className="automation-actions">
            <Link className="dashboard-button dashboard-button--review" href="/messages/review">Review {pendingCount} messages <ArrowRight aria-hidden="true" size={17} /></Link>
            <Link className="dashboard-text-link" href="/audit-logs">Sync activity <ArrowRight aria-hidden="true" size={16} /></Link>
          </div>
        </article>
      </section>

      <section className="dashboard-middle-grid">
        <article className="dashboard-panel spending-panel">
          <h2>Spending by category</h2>
          <SpendingChart categories={state.report.spending_categories} />
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
                  <Link className="attention-row" href={`/messages/review?candidate=${candidate.id}`} key={candidate.id}>
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
          <h2>Recent transactions in selected period</h2>
          <div><Link className="dashboard-button dashboard-button--secondary" href="/transactions"><Plus aria-hidden="true" size={15} />Add transaction</Link><Link href="/transactions">View all <ArrowRight aria-hidden="true" size={15} /></Link></div>
        </div>
        {dashboardData.recentTransactions.length === 0 ? (
          <div className="dashboard-empty"><Receipt aria-hidden="true" size={28} /><strong>No transactions in this period</strong><span>Synced and manually recorded activity will appear here.</span></div>
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
