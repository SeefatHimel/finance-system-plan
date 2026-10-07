export const accessCookieName = "finance_access";
export const refreshCookieName = "finance_refresh";
export const sessionExpiredEvent = "finance:session-expired";
export const sessionChannelName = "finance.session.v1";
export type LoginReason = "required" | "expired" | "signed-out";

const protectedPaths = new Set([
  "/", "/transactions", "/accounts", "/messages/review", "/sms-settings",
  "/reports", "/debts", "/credit-cards", "/recurring-bills", "/reconciliation", "/audit-logs"
]);

export function isProtectedPath(pathname: string) {
  return protectedPaths.has(pathname.replace(/\/$/, "") || "/");
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const url = new URL(value, "https://finance.invalid");
    if (url.origin !== "https://finance.invalid" || !isProtectedPath(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function loginHref(returnPath: string, reason: LoginReason = "required") {
  const params = new URLSearchParams({ next: safeReturnPath(returnPath) });
  if (reason !== "required") params.set("reason", reason);
  return `/login?${params.toString()}`;
}

export function notifySessionExpired() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(sessionExpiredEvent));
}
