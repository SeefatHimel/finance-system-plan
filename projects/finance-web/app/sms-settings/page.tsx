import Link from "next/link";

import { SmsSettingsWorkspace } from "@/components/sms-settings-workspace";

export default function SmsSettingsPage() {
  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Payment methods and SMS sender rules</span>
          </div>
          <nav className="nav" aria-label="Primary navigation">
            <Link className="nav__item" href="/">
              Dashboard
            </Link>
            <Link className="nav__item" href="/transactions">
              Transactions
            </Link>
            <Link className="nav__item" href="/accounts">
              Accounts
            </Link>
            <span className="nav__item nav__item--active">SMS settings</span>
            <Link className="nav__item" href="/messages/review">
              SMS review
            </Link>
            <Link className="nav__item" href="/reports">
              Reports
            </Link>
            <Link className="nav__item" href="/debts">
              Debts
            </Link>
            <Link className="nav__item" href="/credit-cards">
              Credit cards
            </Link>
            <Link className="nav__item" href="/recurring-bills">
              Recurring bills
            </Link>
            <Link className="nav__item" href="/reconciliation">
              Reconciliation
            </Link>
            <Link className="nav__item" href="/audit-logs">
              Audit logs
            </Link>
          </nav>
        </div>
      </header>

      <main className="main">
        <SmsSettingsWorkspace />
      </main>
    </div>
  );
}
