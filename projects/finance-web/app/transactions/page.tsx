import Link from "next/link";

import { TransactionWorkspace } from "@/components/transaction-workspace";

export default function TransactionsPage() {
  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Manual transaction workflow</span>
          </div>
          <nav className="nav" aria-label="Primary navigation">
            <Link className="nav__item" href="/">
              Dashboard
            </Link>
            <span className="nav__item nav__item--active">Transactions</span>
            <span className="nav__item">Accounts</span>
            <span className="nav__item">Review</span>
          </nav>
        </div>
      </header>

      <main className="main">
        <TransactionWorkspace />
      </main>
    </div>
  );
}

