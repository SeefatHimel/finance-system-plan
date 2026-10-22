"use client";
import { PRODUCT_NAME } from "../../finance-contracts/presentation";

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
  ListDashes,
  MagnifyingGlass,
  PlusCircle,
  SidebarSimple,
  UserCircle,
  X
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ElementType, MouseEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { getSmsDeviceStatus, listMessageCandidatePage } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-storage";
import { QuickAddProvider, QuickAddButton } from "./quick-add";
import { TransactionOverlayHost } from "./transaction-recovery";
import { useAuth } from "@/components/auth-provider";
import { ButtonBusy } from "@/components/loading-state";

import { lockBodyScroll } from "@/lib/body-scroll-lock";
import { ReviewNavigation, isReviewPath } from "./review-navigation";
import { REVIEW_QUEUE_CHANGED, validReviewCount } from "@/lib/review-status";

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
  { href: "/timeline", icon: ListDashes, label: "Account Lanes", subtitle: "Follow movements and reported balances across accounts", title: "Account Lanes" },
  { href: "/quick-add", icon: PlusCircle, label: "Quick Add presets", subtitle: "Configure your manual-entry shortcuts", title: "Quick Add presets" },
  { href: "/accounts", icon: CreditCard, label: "Accounts", subtitle: "Manage accounts and transaction categories", title: "Accounts & categories" },
  { href: "/profile", icon: UserCircle, label: "Profile", subtitle: "Your account details and appearance", title: "Your profile" },
  { href: "/review", icon: CheckCircle, label: "Review inbox", subtitle: "Review SMS, statements and matched sources", title: "Review inbox" },
  { href: "/checks", icon: MagnifyingGlass, label: "Evidence checks", subtitle: "Find disagreements between saved sources and ledger entries", title: "Evidence checks" },
  { href: "/messages/review", icon: ChatCenteredText, label: "SMS review", subtitle: "Review parsed messages before they enter your ledger", title: "SMS review" },
  { href: "/statements", icon: FileText, label: "Statements", subtitle: "Review statement imports, matches, and ledger evidence", title: "Statement PDFs" },
  { href: "/statement-counterparties", icon: CreditCard, label: "Statement codes", subtitle: "Name recurring counterparty codes from statements", title: "Statement counterparty codes" },
  { href: "/sms-settings", icon: GearSix, label: "SMS settings", subtitle: "Configure payment methods and sender rules", title: "SMS settings" },
  { href: "/reports", icon: ChartBar, label: "Reports", subtitle: "Understand income, expenses, and net movement for any period", title: "Financial reports" },
  { href: "/debts", icon: PlusCircle, label: "Debts", subtitle: "Track money borrowed, lent, and repaid", title: "Debts & lending" },
  { href: "/credit-cards", icon: CreditCard, label: "Credit cards", subtitle: "Manage statements, dues, and payments", title: "Credit cards" },
  { href: "/recurring-bills", icon: CalendarDots, label: "Recurring bills", subtitle: "Stay ahead of scheduled payments", title: "Recurring bills" },
  { href: "/reconciliation", icon: CheckCircle, label: "Reconciliation", subtitle: "Compare your ledger with real balances", title: "Balance reconciliation" },
  { href: "/audit-logs", icon: FileText, label: "Audit logs", subtitle: "Inspect the history behind ledger changes", title: "Audit logs" }
];

const planningPaths = ["/debts", "/credit-cards", "/recurring-bills", "/reconciliation"];
const settingsPaths = ["/profile", "/quick-add", "/statement-counterparties", "/sms-settings", "/audit-logs"];
const navigationGroups = [
  { label: "Overview", paths: ["/", "/transactions", "/timeline", "/review", "/checks", "/accounts", "/reports"] },
  { label: "Planning", paths: planningPaths },
  { label: "Settings", paths: settingsPaths }
];

const sidebarPreferenceKey = "finance.sidebarCollapsed.v1";

function isActive(item: NavItem, pathname: string) {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

function currentDateLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
    year: "numeric"
  }).format(new Date());
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, signOut, isSigningOut } = useAuth();
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenu = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const countVersion = useRef(0);
  const owner = session.status === "signed-in" ? session.user.id : null;
  const [queueCount, setQueueCount] = useState<{ owner: number; count: number } | null>(null);
  const pendingCount = queueCount?.owner === owner ? queueCount.count : null;
  const [syncLabel, setSyncLabel] = useState("Mobile sync ready");

  useEffect(() => {
    try {
      setIsSidebarCollapsed(window.localStorage.getItem(sidebarPreferenceKey) === "true");
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
    const mobileViewport = window.matchMedia("(max-width: 820px)");
    const closeMobileNavigation = () => {
      setIsMobileViewport(mobileViewport.matches);
      if (!mobileViewport.matches) setIsMobileNavOpen(false);
    };
    closeMobileNavigation();
    mobileViewport.addEventListener("change", closeMobileNavigation);
    return () => mobileViewport.removeEventListener("change", closeMobileNavigation);
  }, []);

  useEffect(() => {
    const group = planningPaths.includes(pathname) ? "Planning" : settingsPaths.includes(pathname) ? "Settings" : null;
    if (group) setOpenGroups(current => current.includes(group) ? current : [...current, group]);
  }, [pathname]);

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
    if (sidebar.current) sidebar.current.inert = isMobileViewport && !isMobileNavOpen;
  }, [isMobileViewport, isMobileNavOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) return;
    setIsAccountMenuOpen(false);

    const drawer = sidebar.current;
    const background = content.current;
    if (!drawer || !background) return;
    const trigger = navTrigger.current;
    const previousInert = background.inert;
    background.inert = true;
    const releaseScroll = lockBodyScroll();
    const controls = () => Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setIsMobileNavOpen(false); }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      background.inert = previousInert;
      releaseScroll();
      window.removeEventListener("keydown", handleKey);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    if (!isNavigating) return;
    const timeout = window.setTimeout(() => setIsNavigating(false), 6000);
    return () => window.clearTimeout(timeout);
  }, [isNavigating]);

  useEffect(() => {
    setQueueCount(null);
    setSyncLabel("Mobile sync ready");
    if (pathname === "/login" || owner === null) return;
    let active = true;
    const generation = countVersion;
    const refresh = async () => {
      const token = getAccessToken();
      if (!token) return;
      const version = ++countVersion.current;
      const [candidates, device] = await Promise.allSettled([listMessageCandidatePage(token, 0, 1), getSmsDeviceStatus(token)]);
      if (!active || version !== countVersion.current) return;
      setQueueCount(candidates.status === "fulfilled" ? { owner, count: candidates.value.count } : null);
      if (device.status === "fulfilled") setSyncLabel(device.value.health_label);
    };
    const queueChanged = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (!validReviewCount(detail, owner)) return;
      countVersion.current++; // A freshly loaded queue supersedes earlier count requests.
      setQueueCount(detail);
    };
    window.addEventListener(REVIEW_QUEUE_CHANGED, queueChanged);
    window.addEventListener("finance:transactions-changed", refresh);
    window.addEventListener("focus", refresh);
    void refresh();
    return () => {
      active = false; generation.current++;
      window.removeEventListener(REVIEW_QUEUE_CHANGED, queueChanged);
      window.removeEventListener("finance:transactions-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname, owner]);

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
    <QuickAddProvider><div className={`app-frame${isSidebarCollapsed ? " app-frame--sidebar-collapsed" : ""}`}>
      <aside aria-hidden={isMobileViewport && !isMobileNavOpen ? true : undefined} ref={sidebar} role={isMobileNavOpen ? "dialog" : undefined} aria-modal={isMobileNavOpen ? true : undefined} aria-label={isMobileNavOpen ? "Navigation" : undefined} className={`app-sidebar${isMobileNavOpen ? " app-sidebar--open" : ""}`} id="primary-navigation">
        <button className="mobile-nav-close icon-button" aria-label="Close navigation" onClick={() => setIsMobileNavOpen(false)} type="button"><X aria-hidden="true" size={22} /></button>
        <Link className="app-logo" href="/" aria-label={`${PRODUCT_NAME} dashboard`} onClick={(event) => handleNavigation(event, "/")}>
          <DiamondsFour aria-hidden="true" className="app-logo__mark" size={31} weight="fill" />
          <span>{PRODUCT_NAME}</span>
        </Link>

        <nav className="app-nav" aria-label="Primary navigation">
          {navigationGroups.map(group => {
            const links = group.paths.map(path => navItems.find(item => item.href === path)!).map(item => {
              const selected = item.href === "/review" ? isReviewPath(pathname) : isActive(item, pathname);
              const NavIcon = item.icon;
              const showCount = item.href === "/review" && pendingCount !== null && pendingCount > 0;
              const label = `${item.label}${showCount ? `, ${pendingCount} pending SMS` : ""}`;
              return <Link aria-current={selected ? "page" : undefined} aria-label={label}
                className={`app-nav__item${selected ? " app-nav__item--active" : ""}`} href={item.href}
                key={item.href} onClick={event => handleNavigation(event, item.href)} title={label}>
                <NavIcon aria-hidden="true" className="nav-icon" size={20} weight={selected ? "fill" : "regular"} />
                <span className="app-nav__label">{item.label}</span>
                {showCount ? <span className="app-nav__count" aria-hidden="true">{pendingCount! > 99 ? "99+" : pendingCount}</span> : null}
              </Link>;
            });
            return group.label === "Overview" ? <div className="app-nav__group" key={group.label}>{links}</div>
              : <details className="app-nav__group" key={group.label} open={openGroups.includes(group.label)} onToggle={event => {
                const open = event.currentTarget.open;
                setOpenGroups(current => open ? current.includes(group.label) ? current : [...current, group.label] : current.filter(value => value !== group.label));
              }}><summary aria-label={`${group.label} navigation`} title={group.label}>{group.label === "Settings" ? <GearSix aria-hidden="true" size={19} /> : <CalendarDots aria-hidden="true" size={19} />}<span className="app-nav__label">{group.label}</span></summary>{links}</details>;
          })}
        </nav>

        <div className="app-sidebar__footer">
          <strong>{PRODUCT_NAME}</strong>
          <span>Simple money.<br />A clearer tomorrow.</span>
        </div>
      </aside>

      {isMobileNavOpen ? (
        <button aria-label="Close navigation backdrop" tabIndex={-1} className="nav-scrim" onClick={() => setIsMobileNavOpen(false)} type="button" />
      ) : null}

      <div className="app-content" ref={content}>
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
            ref={navTrigger}
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

          <QuickAddButton />
          <div className="account-controls" ref={accountMenu}>
            <button className="user-avatar" aria-label="Account menu" aria-controls="account-menu"
              aria-expanded={isAccountMenuOpen} onClick={() => setIsAccountMenuOpen((open) => !open)}
              ref={accountButton} title="Account menu" type="button">
              {userInitials}<span aria-hidden="true" />
            </button>
            {isAccountMenuOpen ? <div className="account-menu" id="account-menu">
              <span className="session-card__label">Signed in as</span><strong>{displayName}</strong>
              <Link className="account-menu__profile" href="/profile" onClick={() => setIsAccountMenuOpen(false)}><UserCircle aria-hidden="true" size={19} />View profile</Link>
              <button className="button button--ghost" disabled={isSigningOut} onClick={() => void signOut()} type="button">
                {isSigningOut ? <ButtonBusy label="Signing out" /> : "Sign out"}
              </button>
            </div> : null}
          </div>
        </header>
        <div aria-busy={isNavigating} className={`app-main${isNavigating ? " app-main--navigating" : ""}`}>{isReviewPath(pathname) ? <ReviewNavigation pendingSms={pendingCount} /> : null}{children}</div>
      </div>
    </div><TransactionOverlayHost /></QuickAddProvider>
  );
}
