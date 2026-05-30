import Link from "next/link";

import { MessageReviewWorkspace } from "@/components/message-review-workspace";

export default function MessageReviewPage() {
  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Parsed SMS review inbox</span>
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
            <span className="nav__item nav__item--active">SMS review</span>
            <Link className="nav__item" href="/reports">
              Reports
            </Link>
            <Link className="nav__item" href="/debts">
              Debts
            </Link>
          </nav>
        </div>
      </header>

      <main className="main">
        <MessageReviewWorkspace />
      </main>
    </div>
  );
}
