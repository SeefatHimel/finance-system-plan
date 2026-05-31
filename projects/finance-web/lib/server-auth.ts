import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const accessCookieName = "finance_access";
const refreshCookieName = "finance_refresh";
const accessCookieMaxAgeSeconds = 10 * 60;
const refreshCookieMaxAgeSeconds = 14 * 24 * 60 * 60;

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

function getServerApiBaseUrl() {
  return process.env.NEXT_SERVER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
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
    throw new Error(response.status === 401 ? "Invalid username or password." : "Login failed.");
  }

  return tokenPairSchema.parse(await response.json());
}

async function backendRefresh(refreshToken: string) {
  const response = await fetch(`${getServerApiBaseUrl()}/api/auth/refresh/`, {
    body: JSON.stringify({ refresh: refreshToken }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Stored session expired. Sign in again.");
  }

  return tokenPairSchema.parse(await response.json());
}

export async function backendCurrentUser(accessToken: string) {
  const response = await fetch(`${getServerApiBaseUrl()}/api/auth/me/`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "Session expired." : "Could not load user.");
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
      if (!refreshToken) {
        throw error;
      }
    }
  }

  if (!refreshToken) {
    throw new Error("Not signed in.");
  }

  const rotatedTokens = await backendRefresh(refreshToken);
  return {
    rotatedTokens,
    user: await backendCurrentUser(rotatedTokens.access)
  };
}

export async function refreshCookieBackedSession() {
  const refreshToken = cookies().get(refreshCookieName)?.value;
  if (!refreshToken) {
    throw new Error("Not signed in.");
  }

  const rotatedTokens = await backendRefresh(refreshToken);
  return {
    rotatedTokens,
    user: await backendCurrentUser(rotatedTokens.access)
  };
}
