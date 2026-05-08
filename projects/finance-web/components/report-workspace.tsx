"use client";

import type React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { type MonthlyReport, getMonthlyReport } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type ReportState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { report: MonthlyReport; status: "ready" };

const moneyFormatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  style: "currency"
});

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatMoney(value: string) {
  return moneyFormatter.format(Number(value));
}

export function ReportWorkspace() {
  const [month, setMonth] = useState(currentMonth);
  const [reportState, setReportState] = useState<ReportState>({ status: "loading" });

  async function loadReport(selectedMonth: string) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      setReportState({ message: "Sign in before viewing reports.", status: "error" });
      return;
    }

    setReportState({ status: "loading" });

    try {
      const report = await getMonthlyReport(accessToken, selectedMonth);
      setReportState({ report, status: "ready" });
    } catch (error) {
      setReportState({
        message: error instanceof Error ? error.message : "Could not load monthly report.",
        status: "error"
      });
    }
  }

  useEffect(() => {
    void loadReport(currentMonth());
  }, []);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadReport(month);
  }

  if (reportState.status === "loading") {
    return (
      <div className="panel">
        <div className="panel__body">
          <span className="status-badge status-badge--idle">Loading report</span>
        </div>
      </div>
    );
  }

  if (reportState.status === "error") {
    return (
      <div className="panel">
        <div className="panel__body empty-state">
          <h1 className="section-title">Monthly report</h1>
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
              <h1 className="section-title">Monthly report</h1>
              <p className="section-subtitle">
                Summary for {report.month}, calculated by the Django API.
              </p>
            </div>

            <form className="month-form" onSubmit={handleSubmit}>
              <label className="field">
                <span className="field__label">Month</span>
                <input
                  className="field__control"
                  name="month"
                  onChange={(event) => setMonth(event.target.value)}
                  required
                  type="month"
                  value={month}
                />
              </label>
              <button className="button button--primary" type="submit">
                View
              </button>
            </form>
          </div>

          <div className="metric-row" aria-label="Monthly totals">
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
            <p className="muted-text">No category totals for this month.</p>
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
            <p className="muted-text">No account movement for this month.</p>
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
