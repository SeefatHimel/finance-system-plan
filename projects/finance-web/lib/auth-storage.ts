import type { AuthTokens } from "./api";

const accessTokenKey = "finance.accessToken";
const refreshTokenKey = "finance.refreshToken";

export function saveTokens(tokens: AuthTokens) {
  window.localStorage.setItem(accessTokenKey, tokens.access);
  window.localStorage.setItem(refreshTokenKey, tokens.refresh);
}

export function getAccessToken() {
  return window.localStorage.getItem(accessTokenKey);
}

export function clearTokens() {
  window.localStorage.removeItem(accessTokenKey);
  window.localStorage.removeItem(refreshTokenKey);
}

