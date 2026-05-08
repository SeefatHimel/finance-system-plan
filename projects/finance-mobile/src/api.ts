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

export type Account = {
  id: string;
  name: string;
  type: string;
};

export type Category = {
  id: string;
  kind: string;
  name: string;
};

export type CreateTransactionInput = {
  account: string;
  amount: string;
  category?: string;
  date: string;
  note?: string;
  type: string;
};

export type Transaction = {
  account: string;
  amount: string;
  category: string | null;
  created_at: string;
  date: string;
  id: string;
  needs_review: boolean;
  note: string;
  source: string;
  transfer_account: string | null;
  type: string;
  updated_at: string;
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

async function authenticatedFetch(path: string, accessToken: string): Promise<Response> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401) {
    throw new Error("Your session expired. Sign in again.");
  }

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}.`);
  }

  return response;
}

export async function listAccounts(accessToken: string): Promise<Account[]> {
  const response = await authenticatedFetch("/api/accounts/", accessToken);
  return (await response.json()) as Account[];
}

export async function listCategories(accessToken: string): Promise<Category[]> {
  const response = await authenticatedFetch("/api/categories/", accessToken);
  return (await response.json()) as Category[];
}

export async function createTransaction(
  accessToken: string,
  input: CreateTransactionInput
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/transactions/`, {
    body: JSON.stringify({
      account: input.account,
      amount: input.amount,
      category: input.category || null,
      date: input.date,
      note: input.note || "",
      source: "mobile",
      type: input.type
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (response.status === 401) {
    throw new Error("Your session expired. Sign in again.");
  }

  if (!response.ok) {
    throw new Error(`Transaction create failed with HTTP ${response.status}.`);
  }
}

export async function listTransactions(accessToken: string): Promise<Transaction[]> {
  const response = await authenticatedFetch("/api/transactions/", accessToken);
  return (await response.json()) as Transaction[];
}
