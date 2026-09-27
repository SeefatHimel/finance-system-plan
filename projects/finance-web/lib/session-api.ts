import type { CurrentUser } from "./api";

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

export async function getCookieSessionUser(): Promise<CurrentUser> {
  const response = await fetch("/api/auth/me", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Session expired."));
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
