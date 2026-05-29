import Link from "next/link";

import { SetupWorkspace } from "@/components/setup-workspace";

export default function AccountsPage() {
  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Accounts and categories</span>
          </div>
          <nav className="nav" aria-label="Primary navigation">
            <Link className="nav__item" href="/">
              Dashboard
            </Link>
            <Link className="nav__item" href="/transactions">
              Transactions
            </Link>
            <span className="nav__item nav__item--active">Accounts</span>
            <Link className="nav__item" href="/sms-settings">
              SMS settings
            </Link>
            <Link className="nav__item" href="/messages/review">
              SMS review
            </Link>
            <Link className="nav__item" href="/reports">
              Reports
            </Link>
          </nav>
        </div>
      </header>

      <main className="main">
        <SetupWorkspace />
      </main>
    </div>
  );
}
