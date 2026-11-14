import type { AuthTokens } from "./api";
import { clearReportCache } from "./report-cache";

const accessTokenKey = "finance.accessToken";
const refreshTokenKey = "finance.refreshToken";
const cookieSessionToken = "__finance_cookie_session__";

export function canUseLocalTokenStorage() {
  return process.env.NODE_ENV !== "production";
}

function assertLocalTokenStorageEnabled() {
  if (!canUseLocalTokenStorage()) {
    throw new Error(
      "Browser token storage is disabled for production. Use the cookie-based production auth flow before deploying."
    );
  }
}

export function saveTokens(tokens: AuthTokens) {
  assertLocalTokenStorageEnabled();
  window.localStorage.setItem(accessTokenKey, tokens.access);
  window.localStorage.setItem(refreshTokenKey, tokens.refresh);
}

export function getAccessToken() {
  if (!canUseLocalTokenStorage()) {
    return cookieSessionToken;
  }
  return window.localStorage.getItem(accessTokenKey);
}

export function isCookieSessionToken(accessToken: string) {
  return accessToken === cookieSessionToken;
}

export function getRefreshToken() {
  if (!canUseLocalTokenStorage()) {
    return null;
  }
  return window.localStorage.getItem(refreshTokenKey);
}

export function clearTokens() {
  clearReportCache();
  try {
    window.sessionStorage.removeItem("finance.reports.filters.v1");
    window.sessionStorage.removeItem("finance.customReports.filters.v1");
    window.sessionStorage.removeItem("finance.customReports.list.v1");
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith("finance.customReports.filters.v1.")) window.sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable. */ }
  if (!canUseLocalTokenStorage()) {
    return;
  }
  window.localStorage.removeItem(accessTokenKey);
  window.localStorage.removeItem(refreshTokenKey);
}
