import { z } from "zod";

const healthResponseSchema = z.object({
  status: z.literal("ok")
});

const tokenResponseSchema = z.object({
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

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string()
});

const categorySchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string()
});

const transactionSchema = z.object({
  account: z.string(),
  amount: z.string(),
  category: z.string().nullable(),
  date: z.string(),
  id: z.string(),
  note: z.string(),
  source: z.string(),
  transfer_account: z.string().nullable(),
  type: z.string()
});

const paginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    count: z.number(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema)
  });

const collectionSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.union([z.array(itemSchema), paginatedSchema(itemSchema)]).transform((payload) => {
    if (Array.isArray(payload)) {
      return payload;
    }
    return payload.results;
  });

export type HealthStatus = {
  apiBaseUrl: string;
  error?: string;
  label: string;
  state: "idle" | "ok" | "error";
};

export type AuthTokens = z.infer<typeof tokenResponseSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;

export type CreateTransactionInput = {
  account: string;
  amount: string;
  category?: string;
  date: string;
  note?: string;
  source?: "web";
  transfer_account?: string;
  type: string;
};

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const apiBaseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${apiBaseUrl}/api/health/`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return {
        apiBaseUrl,
        error: `HTTP ${response.status}`,
        label: "Error",
        state: "error"
      };
    }

    const payload = healthResponseSchema.parse(await response.json());

    return {
      apiBaseUrl,
      label: payload.status.toUpperCase(),
      state: "ok"
    };
  } catch (error) {
    return {
      apiBaseUrl,
      error: error instanceof Error ? error.message : "Unknown error",
      label: "Offline",
      state: "idle"
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

  return tokenResponseSchema.parse(await response.json());
}

export async function getCurrentUser(accessToken: string): Promise<CurrentUser> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/me/`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Could not load the current user.");
  }

  return currentUserSchema.parse(await response.json());
}

async function authenticatedFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
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
  return collectionSchema(accountSchema).parse(await response.json());
}

export async function listCategories(accessToken: string): Promise<Category[]> {
  const response = await authenticatedFetch("/api/categories/", accessToken);
  return collectionSchema(categorySchema).parse(await response.json());
}

export async function listTransactions(accessToken: string): Promise<Transaction[]> {
  const response = await authenticatedFetch("/api/transactions/", accessToken);
  return collectionSchema(transactionSchema).parse(await response.json());
}

export async function createTransaction(
  accessToken: string,
  input: CreateTransactionInput
): Promise<Transaction> {
  const response = await authenticatedFetch("/api/transactions/", accessToken, {
    body: JSON.stringify({
      ...input,
      source: input.source ?? "web"
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return transactionSchema.parse(await response.json());
}
