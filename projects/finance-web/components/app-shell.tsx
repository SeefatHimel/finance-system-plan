"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  href: string;
  icon: IconName;
  label: string;
  match?: (pathname: string) => boolean;
  subtitle: string;
  title: string;
};

type IconName =
  | "accounts"
  | "audit"
  | "cards"
  | "dashboard"
  | "debts"
  | "menu"
  | "reconciliation"
  | "recurring"
  | "reports"
  | "review"
  | "settings"
  | "transactions";

const navItems: NavItem[] = [
  { href: "/", icon: "dashboard", label: "Dashboard", subtitle: "Your financial position at a glance", title: "Dashboard" },
  { href: "/transactions", icon: "transactions", label: "Transactions", subtitle: "Record, review, and export money movement", title: "Transactions" },
  { href: "/accounts", icon: "accounts", label: "Accounts", subtitle: "Manage accounts and transaction categories", title: "Accounts & categories" },
  { href: "/sms-settings", icon: "settings", label: "SMS settings", subtitle: "Configure payment methods and sender rules", title: "SMS settings" },
  { href: "/messages/review", icon: "review", label: "SMS review", subtitle: "Review parsed messages before they enter your ledger", title: "SMS review" },
  { href: "/reports", icon: "reports", label: "Reports", subtitle: "Understand monthly income, expenses, and net movement", title: "Monthly reports" },
  { href: "/debts", icon: "debts", label: "Debts", subtitle: "Track money borrowed, lent, and repaid", title: "Debts & lending" },
  { href: "/credit-cards", icon: "cards", label: "Credit cards", subtitle: "Manage statements, dues, and payments", title: "Credit cards" },
  { href: "/recurring-bills", icon: "recurring", label: "Recurring bills", subtitle: "Stay ahead of scheduled payments", title: "Recurring bills" },
  { href: "/reconciliation", icon: "reconciliation", label: "Reconciliation", subtitle: "Compare your ledger with real balances", title: "Balance reconciliation" },
  { href: "/audit-logs", icon: "audit", label: "Audit logs", subtitle: "Inspect the history behind ledger changes", title: "Audit logs" }
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    accounts: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/></>,
    audit: <><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h5M10 12h6M10 16h6"/></>,
    cards: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    debts: <><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    reconciliation: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
    recurring: <><path d="M20 7h-5V2M4 17h5v5"/><path d="M6.1 8A7 7 0 0 1 18 5l2 2M17.9 16A7 7 0 0 1 6 19l-2-2"/></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7"/></>,
    review: <><path d="M4 4h16v13H8l-4 4z"/><path d="M8 8h8M8 12h5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    transactions: <><path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/></>
  };

  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      {paths[name]}
    </svg>
  );
}

function isActive(item: NavItem, pathname: string) {
  if (item.match) return item.match(pathname);
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const environmentLabel = process.env.NEXT_PUBLIC_APP_ENV
    ?? (process.env.NODE_ENV === "production" ? "Production" : "Development");

  useEffect(() => setIsMobileNavOpen(false), [pathname]);

  if (pathname === "/login") return children;

  const activeItem = navItems.find((item) => isActive(item, pathname)) ?? navItems[0];

  return (
    <div className="app-frame">
      <aside className={`app-sidebar${isMobileNavOpen ? " app-sidebar--open" : ""}`}>
        <Link className="app-logo" href="/" aria-label="Finance dashboard">
          <span className="app-logo__mark">F</span>
          <span>Finance</span>
        </Link>
        <nav className="app-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link className={`app-nav__item${isActive(item, pathname) ? " app-nav__item--active" : ""}`} href={item.href} key={item.href}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="app-sidebar__footer">
          <span className="environment-dot" />
          <div><strong>Finance workspace</strong><span>{environmentLabel}</span></div>
        </div>
      </aside>

      {isMobileNavOpen ? <button aria-label="Close navigation" className="nav-scrim" onClick={() => setIsMobileNavOpen(false)} type="button" /> : null}

      <div className="app-content">
        <header className="app-topbar">
          <button aria-label="Open navigation" className="mobile-menu-button" onClick={() => setIsMobileNavOpen(true)} type="button">
            <Icon name="menu" />
          </button>
          <div className="page-heading">
            <h1>{activeItem.title}</h1>
            <p>{activeItem.subtitle}</p>
          </div>
          <div className="user-avatar" aria-label="Signed-in user">FS</div>
        </header>
        <div className="app-main">{children}</div>
      </div>
    </div>
  );
}
