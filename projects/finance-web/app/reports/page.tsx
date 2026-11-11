import Link from "next/link";
import { redirect } from "next/navigation";

import { ReportWorkspace } from "@/components/report-workspace";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.saved_report) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    redirect(`/custom-reports?${query}`);
  }
  return (
    <div className="page-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="brand">
            <span className="brand__name">Finance System</span>
            <span className="brand__meta">Monthly reports</span>
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
            <span className="nav__item nav__item--active">Reports</span>
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
        <ReportWorkspace />
      </main>
    </div>
  );
}
