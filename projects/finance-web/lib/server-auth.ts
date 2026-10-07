import { createHash } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthRequestError, isAuthenticationFailure } from "./auth-errors";
import { accessCookieName, refreshCookieName } from "./auth-navigation";
const accessCookieMaxAgeSeconds = 15 * 60;
const refreshCookieMaxAgeSeconds = 30 * 24 * 60 * 60;
const refreshResultReuseMilliseconds = 5_000;

const tokenPairSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1)
});

const currentUserSchema = z.object({
  email: z.string(),
  first_name: z.string(),
  id: z.number(),
  last_name: z.string(),
  username: z.string()
});

type TokenPair = z.infer<typeof tokenPairSchema>;
type RefreshOperation = {
  expiresAt: number;
  promise: Promise<TokenPair>;
};

const refreshOperations = new Map<string, RefreshOperation>();

export function getServerApiBaseUrl() {
  const apiBaseUrl =
    process.env.NEXT_SERVER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  return apiBaseUrl.replace(/\/+$/, "");
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return !isProduction();
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestUrl = new URL(request.url);
  const expectedOrigin = forwardedHost
    ? `${forwardedProtocol || requestUrl.protocol.replace(":", "")}://${forwardedHost}`
    : requestUrl.origin;
  return origin === expectedOrigin;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "strict" as const,
    secure: isProduction()
  };
}

export function setAuthCookies(response: NextResponse, tokens: TokenPair) {
  response.cookies.set(accessCookieName, tokens.access, cookieOptions(accessCookieMaxAgeSeconds));
  response.cookies.set(refreshCookieName, tokens.refresh, cookieOptions(refreshCookieMaxAgeSeconds));
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.set(accessCookieName, "", {
    ...cookieOptions(0),
    expires: new Date(0)
  });
  response.cookies.set(refreshCookieName, "", {
    ...cookieOptions(0),
    expires: new Date(0)
  });
}

export async function backendLogin(username: string, password: string) {
  const response = await fetch(`${getServerApiBaseUrl()}/api/auth/login/`, {
    body: JSON.stringify({ password, username }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new AuthRequestError(response.status === 401 ? "Invalid username or password."
      : response.status === 429 ? "Too many sign-in attempts. Please try again later." : "Login unavailable. Try again.", response.status);
  }

  return tokenPairSchema.parse(await response.json());
}

async function requestBackendRefresh(refreshToken: string) {
  const response = await fetch(`${getServerApiBaseUrl()}/api/auth/refresh/`, {
    body: JSON.stringify({ refresh: refreshToken }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new AuthRequestError(response.status === 401 ? "Stored session expired. Sign in again." : "Could not refresh session. Try again.", response.status);
  }

  return tokenPairSchema.parse(await response.json());
}

async function backendRefresh(refreshToken: string) {
  const refreshKey = createHash("sha256").update(refreshToken).digest("hex");
  const now = Date.now();
  const existingOperation = refreshOperations.get(refreshKey);
  if (existingOperation && existingOperation.expiresAt > now) {
    return existingOperation.promise;
  }

  for (const [key, operation] of refreshOperations) {
    if (operation.expiresAt <= now) {
      refreshOperations.delete(key);
    }
  }

  const promise = requestBackendRefresh(refreshToken).catch((error) => {
    refreshOperations.delete(refreshKey);
    throw error;
  });
  refreshOperations.set(refreshKey, {
    expiresAt: now + refreshResultReuseMilliseconds,
    promise,
  });
  return promise;
}

export async function revokeCookieBackedSession() {
  const refreshToken = cookies().get(refreshCookieName)?.value;
  if (!refreshToken) {
    return;
  }

  await fetch(`${getServerApiBaseUrl()}/api/auth/logout/`, {
    body: JSON.stringify({ refresh: refreshToken }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function getCookieBackedAccessToken() {
  const accessToken = cookies().get(accessCookieName)?.value;
  if (accessToken) {
    return {
      accessToken,
      rotatedTokens: null
    };
  }

  return refreshCookieBackedAccessToken();
}

export async function refreshCookieBackedAccessToken() {
  const refreshToken = cookies().get(refreshCookieName)?.value;
  if (!refreshToken) {
    throw new AuthRequestError("Not signed in.", 401);
  }

  const rotatedTokens = await backendRefresh(refreshToken);
  return {
    accessToken: rotatedTokens.access,
    rotatedTokens
  };
}

export async function backendCurrentUser(accessToken: string) {
  const response = await fetch(`${getServerApiBaseUrl()}/api/auth/me/`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new AuthRequestError(response.status === 401 ? "Session expired." : "Could not load user.", response.status);
  }

  return currentUserSchema.parse(await response.json());
}

export async function getCookieBackedCurrentUser() {
  const cookieStore = cookies();
  const accessToken = cookieStore.get(accessCookieName)?.value;
  const refreshToken = cookieStore.get(refreshCookieName)?.value;

  if (accessToken) {
    try {
      return {
        rotatedTokens: null,
        user: await backendCurrentUser(accessToken)
      };
    } catch (error) {
      if (!refreshToken || !isAuthenticationFailure(error)) {
        throw error;
      }
    }
  }

  if (!refreshToken) {
    throw new AuthRequestError("Not signed in.", 401);
  }

  const rotatedTokens = await backendRefresh(refreshToken);
  return {
    rotatedTokens,
    user: await backendCurrentUser(rotatedTokens.access)
  };
}

export async function refreshCookieBackedSession() {
  const { rotatedTokens } = await refreshCookieBackedAccessToken();
  return {
    rotatedTokens,
    user: await backendCurrentUser(rotatedTokens.access)
  };
}
