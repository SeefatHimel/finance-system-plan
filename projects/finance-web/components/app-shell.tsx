"use client";

import {
  CalendarBlank,
  CalendarDots,
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
  PlusCircle,
  SidebarSimple
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ElementType, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { getSmsDeviceStatus, listMessageCandidates } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { useAuth } from "@/components/auth-provider";
import { ButtonBusy } from "@/components/loading-state";

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
  { href: "/statements", icon: FileText, label: "Statements", subtitle: "Preview statement rows and verify balances", title: "Statement PDFs" },
  { href: "/sms-settings", icon: GearSix, label: "SMS settings", subtitle: "Configure payment methods and sender rules", title: "SMS settings" },
  { href: "/reports", icon: ChartBar, label: "Reports", subtitle: "Understand monthly income, expenses, and net movement", title: "Monthly reports" },
  { href: "/debts", icon: PlusCircle, label: "Debts", subtitle: "Track money borrowed, lent, and repaid", title: "Debts & lending" },
  { href: "/credit-cards", icon: CreditCard, label: "Credit cards", subtitle: "Manage statements, dues, and payments", title: "Credit cards" },
  { href: "/recurring-bills", icon: CalendarDots, label: "Recurring bills", subtitle: "Stay ahead of scheduled payments", title: "Recurring bills" },
  { href: "/reconciliation", icon: CheckCircle, label: "Reconciliation", subtitle: "Compare your ledger with real balances", title: "Balance reconciliation" },
  { href: "/audit-logs", icon: FileText, label: "Audit logs", subtitle: "Inspect the history behind ledger changes", title: "Audit logs" }
];

const sidebarPreferenceKey = "finance.sidebarCollapsed.v1";

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
  const { session, signOut, isSigningOut } = useAuth();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenu = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [syncLabel, setSyncLabel] = useState("Mobile sync ready");

  useEffect(() => {
    try {
      setIsSidebarCollapsed(window.localStorage.getItem(sidebarPreferenceKey) === "true");
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
    const mobileViewport = window.matchMedia("(max-width: 820px)");
    const closeMobileNavigation = () => {
      if (!mobileViewport.matches) setIsMobileNavOpen(false);
    };
    mobileViewport.addEventListener("change", closeMobileNavigation);
    return () => mobileViewport.removeEventListener("change", closeMobileNavigation);
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(false);
    setIsNavigating(false);
    setIsAccountMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const clickOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountMenu.current?.contains(event.target)) setIsAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
        accountButton.current?.focus();
      }
    };
    window.addEventListener("pointerdown", clickOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", clickOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileNavOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    if (!isNavigating) return;
    const timeout = window.setTimeout(() => setIsNavigating(false), 6000);
    return () => window.clearTimeout(timeout);
  }, [isNavigating]);

  useEffect(() => {
    if (pathname === "/login") return;
    const accessToken = getAccessToken();
    if (!accessToken) return;

    let isActiveRequest = true;
    void Promise.allSettled([
      listMessageCandidates(accessToken),
      getSmsDeviceStatus(accessToken)
    ])
      .then(([candidatesResult, deviceStatusResult]) => {
        if (!isActiveRequest) return;
        if (candidatesResult.status === "fulfilled") {
          setPendingCount(candidatesResult.value.length);
        } else {
          setPendingCount(null);
        }
        if (deviceStatusResult.status === "fulfilled") {
          setSyncLabel(deviceStatusResult.value.health_label);
        }
      });

    return () => {
      isActiveRequest = false;
    };
  }, [pathname]);

  if (pathname === "/login") return children;

  const activeItem = navItems.find((item) => isActive(item, pathname)) ?? navItems[0];
  const isDashboard = pathname === "/";
  const user = session.status === "signed-in" ? session.user : null;
  const names = user ? [user.first_name, user.last_name].filter(Boolean) : [];
  const displayName = names.length ? names.join(" ") : user?.username ?? "User";
  const userInitials = (names.length ? names : [user?.username ?? "U"])
    .map((name) => name.trim().charAt(0).toUpperCase()).join("").slice(0, 2);

  function toggleSidebar() {
    const collapsed = !isSidebarCollapsed;
    setIsSidebarCollapsed(collapsed);
    try {
      window.localStorage.setItem(sidebarPreferenceKey, String(collapsed));
    } catch {
      // The current session still supports collapsing and expanding.
    }
  }

  function handleNavigation(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      href === pathname ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    setIsNavigating(true);
  }

  return (
    <div className={`app-frame${isSidebarCollapsed ? " app-frame--sidebar-collapsed" : ""}`}>
      <aside className={`app-sidebar${isMobileNavOpen ? " app-sidebar--open" : ""}`} id="primary-navigation">
        <Link className="app-logo" href="/" aria-label="Finance dashboard" onClick={(event) => handleNavigation(event, "/")}>
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
                aria-label={`${item.label}${showCount ? `, ${pendingCount} pending` : ""}`}
                className={`app-nav__item${selected ? " app-nav__item--active" : ""}`}
                href={item.href}
                key={item.href}
                onClick={(event) => handleNavigation(event, item.href)}
                title={`${item.label}${showCount ? ` (${pendingCount} pending)` : ""}`}
              >
                <NavIcon aria-hidden="true" className="nav-icon" size={20} weight={selected ? "fill" : "regular"} />
                <span className="app-nav__label">{item.label}</span>
                {showCount ? <span className="app-nav__count" aria-hidden="true">{pendingCount !== null && pendingCount > 99 ? "99+" : pendingCount}</span> : null}
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
        <div aria-hidden="true" className={`navigation-progress${isNavigating ? " navigation-progress--active" : ""}`}>
          <span />
        </div>
        <header className={`app-topbar${isDashboard ? " app-topbar--dashboard" : ""}`}>
          <button
            aria-controls="primary-navigation"
            aria-expanded={!isSidebarCollapsed}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebar-toggle"
            onClick={toggleSidebar}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={21} weight={isSidebarCollapsed ? "regular" : "fill"} />
          </button>
          <button
            aria-controls="primary-navigation"
            aria-expanded={isMobileNavOpen}
            aria-label="Open navigation"
            className="mobile-menu-button"
            onClick={() => setIsMobileNavOpen(true)}
            type="button"
          >
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
              <time className="topbar-control topbar-date" dateTime={new Date().toISOString().slice(0, 10)}>
                <CalendarBlank aria-hidden="true" size={19} />
                <span suppressHydrationWarning>{currentDateLabel()}</span>
              </time>
              <form action="/transactions" className="topbar-search" method="get">
                <MagnifyingGlass aria-hidden="true" size={19} />
                <input aria-label="Search transactions" name="search" placeholder="Search transactions..." type="search" />
              </form>
            </div>
          ) : null}

          <div className="account-controls" ref={accountMenu}>
            <button className="user-avatar" aria-label="Account menu" aria-controls="account-menu"
              aria-expanded={isAccountMenuOpen} onClick={() => setIsAccountMenuOpen((open) => !open)}
              ref={accountButton} title="Account menu" type="button">
              {userInitials}<span aria-hidden="true" />
            </button>
            {isAccountMenuOpen ? <div className="account-menu" id="account-menu">
              <span className="session-card__label">Signed in as</span><strong>{displayName}</strong>
              <button className="button button--ghost" disabled={isSigningOut} onClick={() => void signOut()} type="button">
                {isSigningOut ? <ButtonBusy label="Signing out" /> : "Sign out"}
              </button>
            </div> : null}
          </div>
        </header>
        <div aria-busy={isNavigating} className={`app-main${isNavigating ? " app-main--navigating" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
