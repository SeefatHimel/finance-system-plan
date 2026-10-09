"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { type MonthlyReport, getPeriodReport } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { LoadingState } from "@/components/loading-state";
import { DatePeriodControls } from "@/components/date-period-controls";
import { monthPeriod, periodLabel, type DatePeriod } from "@/lib/date-period";

type ReportState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { report: MonthlyReport; status: "ready" };

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

function formatMoney(value: string) {
  return moneyFormatter.format(Number(value));
}

export function ReportWorkspace() {
  // Use a timezone-independent first render, then select the browser's current month.
  const [period, setPeriod] = useState<DatePeriod>(() => monthPeriod(new Date().toISOString().slice(0, 7)));
  useEffect(() => { setPeriod(monthPeriod()); }, []);
  const [reportState, setReportState] = useState<ReportState>({ status: "loading" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    if (!token) { setReportState({ status: "error", message: "Sign in before viewing reports." }); return; }
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      void getPeriodReport(token, period.start, period.end, controller.signal).then(report => {
        if (!controller.signal.aborted) setReportState({ report, status: "ready" });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          const message = reason instanceof Error ? reason.message : "Could not load report.";
          setError(message);
          setReportState(old => old.status === "ready" ? old : { message, status: "error" });
        }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [period.start, period.end]);
  const controls = <DatePeriodControls label="Report dates" allowAll={false} value={period} onChange={setPeriod} />;

  if (reportState.status === "loading") {
    return <>{controls}<LoadingState detail="Aggregating income, expenses, and category totals" label="Generating report" /></>;
  }

  if (reportState.status === "error") {
    return (
      <div className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Financial report</h1>
          {controls}
          <p className="section-subtitle">{reportState.message}</p>
          <Link className="button button--primary" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const report = reportState.report;

  return (
    <div className="workspace-grid">
      <section className="panel">
        <div className="panel__body">
          <div className="report-header">
            <div>
              <h1 className="section-title">Financial report</h1>
              <p className="section-subtitle">
                Summary for {periodLabel({ mode: "custom", start: report.start_date, end: report.end_date })}, calculated by the Django API.
              </p>
            </div>
          </div>

          {controls}
          {loading ? <p role="status">Updating selected period… Previous totals remain visible until ready.</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="metric-row" aria-label="Selected period totals" aria-busy={loading}>
            <div className="metric">
              <span className="metric__label">Income</span>
              <span className="metric__value">{formatMoney(report.income_total)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Expense</span>
              <span className="metric__value">{formatMoney(report.expense_total)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Net</span>
              <span className="metric__value">{formatMoney(report.net_total)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Category totals</h2>
          {report.categories.length === 0 ? (
            <p className="muted-text">No category totals for this period.</p>
          ) : (
            <div className="list-stack">
              {report.categories.map((category) => (
                <div className="list-row" key={category.name}>
                  <strong>{category.name}</strong>
                  <span>{formatMoney(category.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__body">
          <h2 className="section-title">Account movement</h2>
          {report.accounts.length === 0 ? (
            <p className="muted-text">No account movement for this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Money in</th>
                    <th>Money out</th>
                  </tr>
                </thead>
                <tbody>
                  {report.accounts.map((account) => (
                    <tr key={account.name}>
                      <td>{account.name}</td>
                      <td>{formatMoney(account.money_in)}</td>
                      <td>{formatMoney(account.money_out)}</td>
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
