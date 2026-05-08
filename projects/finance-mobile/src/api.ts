export type HealthResponse = {
  status: "ok";
};

export type AuthTokens = {
  access: string;
  refresh: string;
};

export type CurrentUser = {
  email: string;
  first_name: string;
  id: number;
  last_name: string;
  username: string;
};

export type HealthResult = {
  error?: string;
  ok: boolean;
  status?: string;
};

export function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8000";
}

export async function checkHealth(): Promise<HealthResult> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/health/`);
    if (!response.ok) {
      return {
        error: `HTTP ${response.status}`,
        ok: false
      };
    }

    const payload = (await response.json()) as HealthResponse;
    return {
      ok: payload.status === "ok",
      status: payload.status
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown network error",
      ok: false
    };
  }
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/login/`, {
    body: JSON.stringify({ password, username }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "Invalid username or password." : "Login failed.");
  }

  const payload = (await response.json()) as AuthTokens;
  if (!payload.access || !payload.refresh) {
    throw new Error("Token response is invalid.");
  }

  return payload;
}

export async function getCurrentUser(accessToken: string): Promise<CurrentUser> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/me/`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "Token is invalid or expired." : "Could not load user.");
  }

  return (await response.json()) as CurrentUser;
}
