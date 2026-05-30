import Link from "next/link";

import { CreditCardWorkspace } from "@/components/credit-card-workspace";

export default function CreditCardsPage() {
  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Credit card bill workflow</span>
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
            <span className="nav__item nav__item--active">Credit cards</span>
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
        <CreditCardWorkspace />
      </main>
    </div>
  );
}
