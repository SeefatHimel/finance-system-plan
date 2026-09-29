"use client";

import {
  CalendarBlank,
  CalendarDots,
  CaretDown,
  ChartBar,
  ChatCenteredText,
  CheckCircle,
  Circle,
  CreditCard,
  DiamondsFour,
  FileText,
  GearSix,
  House,
  List,
  ListBullets,
  MagnifyingGlass,
  PlusCircle
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ElementType } from "react";
import { useEffect, useState } from "react";

import { listMessageCandidates } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";

type NavItem = {
  href: string;
  icon: ElementType;
  label: string;
  subtitle: string;
  title: string;
};

const navItems: NavItem[] = [
  { href: "/", icon: House, label: "Dashboard", subtitle: "Your financial position at a glance", title: "Dashboard" },
  { href: "/transactions", icon: ListBullets, label: "Transactions", subtitle: "Record, review, and export money movement", title: "Transactions" },
  { href: "/accounts", icon: CreditCard, label: "Accounts", subtitle: "Manage accounts and transaction categories", title: "Accounts & categories" },
  { href: "/messages/review", icon: ChatCenteredText, label: "SMS review", subtitle: "Review parsed messages before they enter your ledger", title: "SMS review" },
  { href: "/sms-settings", icon: GearSix, label: "SMS settings", subtitle: "Configure payment methods and sender rules", title: "SMS settings" },
  { href: "/reports", icon: ChartBar, label: "Reports", subtitle: "Understand monthly income, expenses, and net movement", title: "Monthly reports" },
  { href: "/debts", icon: PlusCircle, label: "Debts", subtitle: "Track money borrowed, lent, and repaid", title: "Debts & lending" },
  { href: "/credit-cards", icon: CreditCard, label: "Credit cards", subtitle: "Manage statements, dues, and payments", title: "Credit cards" },
  { href: "/recurring-bills", icon: CalendarDots, label: "Recurring bills", subtitle: "Stay ahead of scheduled payments", title: "Recurring bills" },
  { href: "/reconciliation", icon: CheckCircle, label: "Reconciliation", subtitle: "Compare your ledger with real balances", title: "Balance reconciliation" },
  { href: "/audit-logs", icon: FileText, label: "Audit logs", subtitle: "Inspect the history behind ledger changes", title: "Audit logs" }
];

function isActive(item: NavItem, pathname: string) {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

function currentDateLabel() {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    weekday: "short",
    year: "numeric"
  }).format(new Date());
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [syncLabel, setSyncLabel] = useState("Mobile sync ready");

  useEffect(() => setIsMobileNavOpen(false), [pathname]);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!accessToken) return;

    let isActiveRequest = true;
    void listMessageCandidates(accessToken)
      .then((candidates) => {
        if (!isActiveRequest) return;
        setPendingCount(candidates.length);
        const latestMessage = candidates
          .map((candidate) => candidate.raw_message.received_at)
          .sort((a, b) => b.localeCompare(a))[0];
        if (latestMessage) {
          setSyncLabel(`Last message ${new Intl.DateTimeFormat("en-US", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }).format(new Date(latestMessage))}`);
        }
      })
      .catch(() => {
        if (isActiveRequest) setPendingCount(null);
      });

    return () => {
      isActiveRequest = false;
    };
  }, [pathname]);

  if (pathname === "/login") return children;

  const activeItem = navItems.find((item) => isActive(item, pathname)) ?? navItems[0];
  const isDashboard = pathname === "/";

  return (
    <div className="app-frame">
      <aside className={`app-sidebar${isMobileNavOpen ? " app-sidebar--open" : ""}`}>
        <Link className="app-logo" href="/" aria-label="Finance dashboard">
          <DiamondsFour aria-hidden="true" className="app-logo__mark" size={31} weight="fill" />
          <span>Finance</span>
        </Link>

        <nav className="app-nav" aria-label="Primary navigation">
          {navItems.map((item) => {
            const selected = isActive(item, pathname);
            const NavIcon = item.icon;
            const showCount = item.href === "/messages/review" && pendingCount !== null && pendingCount > 0;

            return (
              <Link
                aria-current={selected ? "page" : undefined}
                className={`app-nav__item${selected ? " app-nav__item--active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <NavIcon aria-hidden="true" className="nav-icon" size={20} weight={selected ? "fill" : "regular"} />
                <span>{item.label}</span>
                {showCount ? <span className="app-nav__count" aria-label={`${pendingCount} pending`}>{pendingCount}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar__footer">
          <strong>Finance</strong>
          <span>Simple money.<br />A clearer tomorrow.</span>
        </div>
      </aside>

      {isMobileNavOpen ? (
        <button aria-label="Close navigation" className="nav-scrim" onClick={() => setIsMobileNavOpen(false)} type="button" />
      ) : null}

      <div className="app-content">
        <header className={`app-topbar${isDashboard ? " app-topbar--dashboard" : ""}`}>
          <button aria-label="Open navigation" className="mobile-menu-button" onClick={() => setIsMobileNavOpen(true)} type="button">
            <List aria-hidden="true" size={21} />
          </button>

          <div className="page-heading">
            <h1>{isDashboard ? "Your money, already organized" : activeItem.title}</h1>
            {isDashboard ? (
              <p className="sync-heading"><Circle aria-hidden="true" size={10} weight="fill" />{syncLabel}</p>
            ) : (
              <p>{activeItem.subtitle}</p>
            )}
          </div>

          {isDashboard ? (
            <div className="dashboard-topbar-actions">
              <button className="topbar-control topbar-date" type="button">
                <CalendarBlank aria-hidden="true" size={19} />
                <span suppressHydrationWarning>{currentDateLabel()}</span>
                <CaretDown aria-hidden="true" size={14} />
              </button>
              <form action="/transactions" className="topbar-search" method="get">
                <MagnifyingGlass aria-hidden="true" size={19} />
                <input aria-label="Search transactions" name="search" placeholder="Search transactions..." type="search" />
              </form>
            </div>
          ) : null}

          <div className="user-avatar" aria-label="Signed-in user">
            FS
            <span aria-hidden="true" />
          </div>
        </header>
        <div className="app-main">{children}</div>
      </div>
    </div>
  );
}
