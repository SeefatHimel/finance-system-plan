import type { CurrentUser } from "./api";
import { AuthRequestError } from "./auth-errors";

type LoginResult = {
  user: CurrentUser;
};

async function parseError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

export async function loginWithCookieSession(username: string, password: string): Promise<LoginResult> {
  const response = await fetch("/api/auth/login", {
    body: JSON.stringify({ password, username }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Login failed."));
  }

  return (await response.json()) as LoginResult;
}

let sessionCheck: Promise<CurrentUser> | null = null;

export function getCookieSessionUser(): Promise<CurrentUser> {
  if (sessionCheck) return sessionCheck;
  const promise = verifyCookieSession().finally(() => {
    if (sessionCheck === promise) sessionCheck = null;
  });
  sessionCheck = promise;
  return promise;
}

async function verifyCookieSession(): Promise<CurrentUser> {
  let response = await fetch("/api/auth/me", { cache: "no-store" });
  if (response.status === 401) {
    // Let an overlapping rotation response reach the shared cookie jar first.
    await new Promise(resolve => setTimeout(resolve, 250));
    response = await fetch("/api/auth/me", { cache: "no-store" });
  }
  if (!response.ok) {
    throw new AuthRequestError(await parseError(response, "Could not verify session."), response.status);
  }
  return (await response.json()) as CurrentUser;
}

export async function logoutCookieSession() {
  const response = await fetch("/api/auth/logout", {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Could not sign out."));
  }
}
