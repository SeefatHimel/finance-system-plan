import Link from "next/link";

import { getHealthStatus } from "@/lib/api";
import { SessionPanel } from "@/components/session-panel";

const formatter = new Intl.NumberFormat("en-BD", {
  currency: "BDT",
  maximumFractionDigits: 0,
  style: "currency"
});

export default async function HomePage() {
  const health = await getHealthStatus();

  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Local dashboard foundation</span>
          </div>
          <nav className="nav" aria-label="Primary navigation">
            <span className="nav__item nav__item--active">Dashboard</span>
            <Link className="nav__item" href="/transactions">
              Transactions
            </Link>
            <Link className="nav__item" href="/accounts">
              Accounts
            </Link>
            <Link className="nav__item" href="/sms-settings">
              SMS settings
            </Link>
            <Link className="nav__item" href="/messages/review">
              SMS review
            </Link>
            <Link className="nav__item" href="/reports">
              Reports
            </Link>
            <Link className="nav__item" href="/debts">
              Debts
            </Link>
            <Link className="nav__item" href="/reconciliation">
              Reconciliation
            </Link>
          </nav>
        </div>
      </header>

      <main className="main">
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel__body">
              <h1 className="section-title">Manual finance loop</h1>
              <p className="section-subtitle">
                The web app shell is ready to connect accounts, categories,
                transactions, monthly summaries, and SMS review workflows.
              </p>

              <div className="section-block">
                <SessionPanel />
              </div>

              <div className="metric-row" aria-label="Placeholder finance metrics">
                <div className="metric">
                  <span className="metric__label">Month income</span>
                  <span className="metric__value">{formatter.format(0)}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Month expense</span>
                  <span className="metric__value">{formatter.format(0)}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Net</span>
                  <span className="metric__value">{formatter.format(0)}</span>
                </div>
              </div>
            </div>
          </section>

          <aside className="panel">
            <div className="panel__body">
              <h2 className="section-title">System status</h2>
              <p className="section-subtitle">
                Backend connectivity is checked from the server-rendered app.
              </p>

              <div className="status-list">
                <div className="status-row">
                  <span className="status-row__label">API base URL</span>
                  <strong>{health.apiBaseUrl}</strong>
                </div>
                <div className="status-row">
                  <span className="status-row__label">Health endpoint</span>
                  <span className={`status-badge status-badge--${health.state}`}>
                    {health.label}
                  </span>
                </div>
                {health.error ? (
                  <div className="status-row">
                    <span className="status-row__label">Last error</span>
                    <strong>{health.error}</strong>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
