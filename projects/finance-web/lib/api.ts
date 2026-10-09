import { z } from "zod";

import type {
  AccountCreateRequest,
  AccountPatchRequest,
  CategoryCreateRequest,
  CategoryPatchRequest,
  CreditCardBillCreateRequest,
  CreditCardBillStatus,
  CreditCardPaymentCreateRequest,
  DebtCreateRequest,
  DebtPaymentCreateRequest,
  PaymentMethodCreateRequest,
  PaymentMethodPatchRequest,
  ParsedMessageConfirmRequest,
  RecurringBillCreateRequest,
  RecurringBillPaymentCreateRequest,
  RecurringBillStatus,
  SenderRuleCreateRequest,
  SenderRulePatchRequest,
  TransactionDirection,
  TransactionSource,
  TransactionType,
  TransferMatch
} from "../../finance-contracts/generated/types";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isCookieSessionToken,
  saveTokens
} from "./auth-storage";
import { AuthRequestError, isAuthenticationFailure } from "./auth-errors";
import { notifySessionExpired } from "./auth-navigation";
import { fetchWithConnectionError, responseError } from "./api-errors";

export type {
  AccountType,
  CategoryKind,
  CreditCardBillStatus,
  DebtDirection,
  DebtStatus,
  PaymentProvider,
  RecurringBillFrequency,
  RecurringBillStatus,
  SenderRuleMatchType,
  SenderRuleProvider,
  TransactionDirection,
  TransactionSource,
  TransactionType
} from "../../finance-contracts/generated/types";

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
  created_at: z.string(),
  currency: z.string(),
  display_order: z.number(),
  id: z.string(),
  is_active: z.boolean(),
  latest_reported_balance: z.string().nullable(),
  latest_reported_balance_date: z.string().nullable(),
  ledger_balance: z.string(),
  name: z.string(),
  starting_balance: z.string(),
  type: z.string(),
  updated_at: z.string()
});

const categorySchema = z.object({
  is_active: z.boolean().default(true),
  id: z.string(),
  kind: z.string(),
  name: z.string()
});

const paymentMethodSchema = z.object({
  account: z.string(),
  id: z.string(),
  identifier: z.string(),
  is_active: z.boolean(),
  name: z.string(),
  provider: z.string()
});

const senderRuleSchema = z.object({
  account: z.string(),
  category: z.string().nullable(),
  default_transaction_type: z.string(),
  id: z.string(),
  is_active: z.boolean(),
  match_type: z.string(),
  name: z.string(),
  payment_method: z.string().nullable(),
  pattern: z.string(),
  priority: z.number(),
  provider: z.string(),
  sender: z.string()
});

const rawMessageSchema = z.object({
  body: z.string(),
  body_hash: z.string(),
  created_at: z.string(),
  device_message_id: z.string(),
  duplicate_of: z.string().nullable(),
  exclusion_reason: z.string(),
  id: z.string(),
  message_kind: z.string(),
  provider: z.string(),
  redacted_at: z.string().nullable(),
  received_at: z.string(),
  sender: z.string(),
  status: z.string()
});

const transactionSourceMessageSchema = z.object({
  id: z.string(),
  sender: z.string(),
  body: z.string().nullable(),
  received_at: z.string(),
  status: z.string(),
  redacted_at: z.string().nullable()
});

const parsedMessageCandidateSchema = z.object({
  account: z.string().nullable(),
  amount: z.string().nullable(),
  balance_after: z.string().nullable(),
  confidence: z.string(),
  category: z.string().nullable(),
  counterparty_text: z.string(),
  created_at: z.string(),
  destination_account: z.string().nullable(),
  destination_payment_method: z.string().nullable(),
  fee_amount: z.string().nullable(),
  id: z.string(),
  message_kind: z.string(),
  parser_name: z.string(),
  parser_notes: z.string(),
  suggested_transfer_direction: z.enum(["", "debit", "credit"]).default(""),
  transfer_suggestion_reason: z.string().default(""),
  payment_method: z.string().nullable(),
  possible_internal_transfer: z.boolean(),
  possible_related_candidate: z.string().nullable(),
  provider: z.string(),
  raw_message: rawMessageSchema,
  receiver_account_identifier: z.string(),
  receiver_card_identifier: z.string(),
  reference: z.string(),
  rejected_at: z.string().nullable(),
  rejection_note: z.string(),
  rejection_reason: z.string(),
  related_match_reason: z.string(),
  sender_rule: z.string().nullable(),
  sender_account_identifier: z.string(),
  sender_card_identifier: z.string(),
  status: z.string(),
  transaction: z.string().nullable(),
  transaction_type: z.string(),
  updated_at: z.string()
});

const smsCapturePreferenceSchema = z.object({
  created_at: z.string(),
  excluded_message_kinds: z.array(z.string()),
  excluded_providers: z.array(z.string()),
  raw_sms_retention_days: z.number().nullable(),
  updated_at: z.string()
});

const smsDeviceStatusSchema = z.object({
  app_version: z.string(),
  background_state: z.string(),
  created_at: z.string().nullable(),
  device_id: z.string(),
  failed_upload_count: z.number(),
  health_label: z.string(),
  health_state: z.enum(["not_connected", "permission_required", "background_disabled", "error", "syncing", "offline", "setup_required", "healthy"]),
  last_error: z.string(),
  last_scan_at: z.string().nullable(),
  last_seen_at: z.string().nullable(),
  last_successful_sync_at: z.string().nullable(),
  pending_upload_count: z.number(),
  platform: z.string(),
  sms_permission_state: z.string(),
  updated_at: z.string().nullable()
});

const transferEvidenceSchema = z.object({
  id: z.string(), account: z.string(), raw_message: z.string().nullable(), is_primary: z.boolean().default(false),
  direction: z.string(), date: z.string(), time: z.string().nullable(),
  balance_after: z.string().nullable(), fee_amount: z.string().nullable(),
  reference: z.string(), provider: z.string(), source: z.string(), note: z.string()
});
const transferMatchSchema = z.object({
  id: z.string(), kind: z.enum(["transaction", "candidate"]),
  account: z.string(), account_name: z.string(), transfer_account: z.string(), transfer_account_name: z.string(),
  amount: z.string(), date: z.string(), time: z.string().nullable(), reference: z.string(), reason: z.string()
});
export type { TransferMatch } from "../../finance-contracts/generated/types";

const transactionSchema = z.object({
  created_at: z.string(),
  updated_at: z.string(),
  account_direction: z.string(),
  transfer_evidence: z.array(transferEvidenceSchema),
  statement_evidence_count: z.number().default(0),
  account: z.string(),
  amount: z.string(),
  balance_after: z.string().nullable(),
  category: z.string().nullable(),
  counterparty_text: z.string(),
  date: z.string(),
  direction: z.string(),
  external_key: z.string(),
  id: z.string(),
  note: z.string(),
  payment_method: z.string().nullable(),
  raw_message: z.string().nullable(),
  needs_review: z.boolean(),
  receiver_account_identifier: z.string(),
  receiver_card_identifier: z.string(),
  reference: z.string(),
  sender_account_identifier: z.string(),
  sender_card_identifier: z.string(),
  source: z.string(),
  time: z.string().nullable(),
  transfer_account: z.string().nullable(),
  type: z.string()
});

const monthlyReportSchema = z.object({
  accounts: z.array(
    z.object({
      money_in: z.string(),
      money_out: z.string(),
      name: z.string()
    })
  ),
  categories: z.array(
    z.object({
      amount: z.string(),
      name: z.string()
    })
  ),
  currency: z.string(),
  expense_total: z.string(),
  income_total: z.string(),
  month: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  daily: z.array(z.object({ date: z.string(), income_total: z.string(), expense_total: z.string() })),
  spending_categories: z.array(z.object({ name: z.string(), amount: z.string() })),
  net_total: z.string()
});

const debtSchema = z.object({
  counterparty_name: z.string(),
  created_at: z.string(),
  current_balance: z.string(),
  direction: z.string(),
  due_date: z.string().nullable(),
  id: z.string(),
  note: z.string(),
  opened_at: z.string(),
  opened_transaction: z.string().nullable(),
  principal_amount: z.string(),
  status: z.string(),
  updated_at: z.string()
});

const debtPaymentSchema = z.object({
  amount: z.string(),
  created_at: z.string(),
  debt: z.string(),
  id: z.string(),
  note: z.string(),
  paid_at: z.string(),
  transaction: z.string().nullable(),
  updated_at: z.string()
});

const creditCardBillSchema = z.object({
  account: z.string(),
  created_at: z.string(),
  due_date: z.string(),
  id: z.string(),
  minimum_due: z.string(),
  note: z.string(),
  paid_amount: z.string(),
  reference: z.string(),
  remaining_balance: z.string(),
  statement_balance: z.string(),
  statement_date: z.string(),
  statement_transaction: z.string().nullable(),
  status: z.string(),
  updated_at: z.string()
});

const creditCardPaymentSchema = z.object({
  amount: z.string(),
  bill: z.string(),
  created_at: z.string(),
  id: z.string(),
  note: z.string(),
  paid_at: z.string(),
  transaction: z.string().nullable(),
  updated_at: z.string()
});

const recurringBillSchema = z.object({
  account: z.string(),
  amount: z.string(),
  auto_create_transaction: z.boolean(),
  category: z.string().nullable(),
  created_at: z.string(),
  frequency: z.string(),
  id: z.string(),
  name: z.string(),
  next_due_date: z.string(),
  note: z.string(),
  reminder_days_before: z.number(),
  status: z.string(),
  updated_at: z.string()
});

const recurringBillPaymentSchema = z.object({
  amount: z.string(),
  bill: z.string(),
  created_at: z.string(),
  due_date: z.string(),
  id: z.string(),
  note: z.string(),
  paid_at: z.string(),
  transaction: z.string().nullable(),
  updated_at: z.string()
});

const balanceSnapshotSchema = z.object({
  account: z.string(),
  actual_balance: z.string(),
  adjustment_transaction: z.string().nullable(),
  checked_at: z.string(),
  created_at: z.string(),
  difference: z.string(),
  expected_balance: z.string(),
  id: z.string(),
  note: z.string(),
  status: z.string(),
  updated_at: z.string()
});

const accountReconciliationSchema = z.object({
  account: z.string(),
  account_name: z.string(),
  expected_balance: z.string(),
  latest_snapshot: balanceSnapshotSchema.nullable()
});

const auditSnapshotSchema = z.record(z.unknown()).nullable();

const auditLogEntrySchema = z.object({
  action: z.string(),
  after: auditSnapshotSchema,
  before: auditSnapshotSchema,
  created_at: z.string(),
  entity_id: z.string(),
  entity_type: z.string(),
  id: z.string(),
  metadata: z.record(z.unknown())
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
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type SenderRule = z.infer<typeof senderRuleSchema>;
export type ParsedMessageCandidate = z.infer<typeof parsedMessageCandidateSchema>;
export type RawMessage = z.infer<typeof rawMessageSchema>;
export type TransactionSourceMessage = z.infer<typeof transactionSourceMessageSchema>;
export type SmsCapturePreference = z.infer<typeof smsCapturePreferenceSchema>;
export type SmsDeviceStatus = z.infer<typeof smsDeviceStatusSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
export type Debt = z.infer<typeof debtSchema>;
export type DebtPayment = z.infer<typeof debtPaymentSchema>;
export type CreditCardBill = z.infer<typeof creditCardBillSchema>;
export type CreditCardPayment = z.infer<typeof creditCardPaymentSchema>;
export type RecurringBill = z.infer<typeof recurringBillSchema>;
export type RecurringBillPayment = z.infer<typeof recurringBillPaymentSchema>;
export type BalanceSnapshot = z.infer<typeof balanceSnapshotSchema>;
export type AccountReconciliation = z.infer<typeof accountReconciliationSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export type CreateTransactionInput = {
  account: string;
  amount: string;
  balance_after?: string | null;
  category?: string;
  counterparty_text?: string;
  date: string;
  direction?: TransactionDirection;
  external_key?: string;
  note?: string;
  payment_method?: string | null;
  raw_message?: string | null;
  receiver_account_identifier?: string;
  receiver_card_identifier?: string;
  reference?: string;
  sender_account_identifier?: string;
  sender_card_identifier?: string;
  source?: TransactionSource;
  time?: string | null;
  transfer_account?: string;
  type: TransactionType;
};

export type TransactionFilters = {
  start_date?: string;
  end_date?: string;
  account?: string;
  category?: string;
  direction?: TransactionDirection | "";
  month?: string;
  ordering?: "-date" | "-created_at" | "-updated_at";
  search?: string;
  source?: TransactionSource | "";
  type?: TransactionType | "";
};

export type CreateAccountInput = AccountCreateRequest;
export type CreateCategoryInput = CategoryCreateRequest;
export type UpdateAccountInput = AccountPatchRequest;
export type UpdateCategoryInput = CategoryPatchRequest;
export type CreatePaymentMethodInput = PaymentMethodCreateRequest;
export type UpdatePaymentMethodInput = PaymentMethodPatchRequest;
export type CreateSenderRuleInput = SenderRuleCreateRequest;
export type UpdateSenderRuleInput = SenderRulePatchRequest;
export type ConfirmMessageCandidateInput = ParsedMessageConfirmRequest;

export type UpdateTransactionInput = {
  allow_linked_correction?: boolean;
  account?: string;
  amount?: string;
  balance_after?: string | null;
  category?: string | null;
  counterparty_text?: string;
  date?: string;
  direction?: TransactionDirection;
  external_key?: string;
  note?: string;
  source?: TransactionSource;
  needs_review?: boolean;
  payment_method?: string | null;
  raw_message?: string | null;
  receiver_account_identifier?: string;
  receiver_card_identifier?: string;
  reference?: string;
  sender_account_identifier?: string;
  sender_card_identifier?: string;
  time?: string | null;
  transfer_account?: string | null;
  type?: TransactionType;
};

function financialNumber(value: string | number, label: string): number {
  const normalized = String(value).trim().replaceAll(",", "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Enter a valid ${label} with no more than two decimal places.`);
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Enter a valid ${label}.`);
  }
  return parsed;
}

function optionalFinancialNumber(
  value: string | number | null | undefined,
  label: string
): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return financialNumber(value, label);
}

export type CreateDebtInput = DebtCreateRequest;
export type CreateDebtPaymentInput = DebtPaymentCreateRequest;

export type CreditCardBillFilters = {
  account?: string;
  status?: CreditCardBillStatus | "";
};

export type CreateCreditCardBillInput = CreditCardBillCreateRequest;
export type CreateCreditCardPaymentInput = CreditCardPaymentCreateRequest;

export type RecurringBillFilters = {
  account?: string;
  due?: string;
  status?: RecurringBillStatus | "";
};

export type CreateRecurringBillInput = RecurringBillCreateRequest;
export type CreateRecurringBillPaymentInput = RecurringBillPaymentCreateRequest;

export type BalanceSnapshotFilters = {
  account?: string;
};

export type AuditLogFilters = {
  action?: string;
  entity_id?: string;
  entity_type?: string;
};

export type CreateBalanceSnapshotInput = {
  account: string;
  actual_balance: string;
  checked_at?: string;
  note?: string;
};

export function getApiBaseUrl() {
  let apiBaseUrl: string;
  if (typeof window === "undefined") {
    apiBaseUrl = process.env.NEXT_SERVER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  } else {
    apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  }
  return apiBaseUrl.replace(/\/+$/, "");
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
    throw new Error(response.status === 401 ? "Invalid username or password."
      : response.status === 429 ? "Too many sign-in attempts. Please try again later." : "Login unavailable. Please try again.");
  }

  return tokenResponseSchema.parse(await response.json());
}

export async function refreshAuthTokens(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/refresh/`, {
    body: JSON.stringify({ refresh: refreshToken }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new AuthRequestError(response.status === 401 ? "Stored session expired. Sign in again." : "Could not refresh session.", response.status);
  }

  return tokenResponseSchema.parse(await response.json());
}

export async function revokeAuthSession(refreshToken: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/logout/`, {
    body: JSON.stringify({ refresh: refreshToken }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok && response.status !== 400) {
    throw new Error("Could not revoke the saved session.");
  }
}

export async function getCurrentUser(accessToken: string): Promise<CurrentUser> {
  const response = await authenticatedFetch("/api/auth/me/", accessToken);
  return currentUserSchema.parse(await response.json());
}

export async function getLocalSessionUser(): Promise<CurrentUser | null> {
  const accessToken = getAccessToken() || await refreshStoredLocalSession();
  return accessToken ? getCurrentUser(accessToken) : null;
}

async function refreshStoredLocalSession() {
  if (localSessionRefreshPromise) {
    return localSessionRefreshPromise;
  }

  localSessionRefreshPromise = performStoredLocalSessionRefresh().finally(() => {
    localSessionRefreshPromise = null;
  });
  return localSessionRefreshPromise;
}

let localSessionRefreshPromise: Promise<string | null> | null = null;

async function performStoredLocalSessionRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    const tokens = await refreshAuthTokens(refreshToken);
    if (getRefreshToken() !== refreshToken) {
      throw new Error("Your session changed. Please try again.");
    }
    saveTokens(tokens);
    return tokens.access;
  } catch (error) {
    if (getRefreshToken() !== refreshToken) throw new Error("Your session changed. Please try again.");
    if (isAuthenticationFailure(error) && getRefreshToken() === refreshToken) clearTokens();
    throw error;
  }
}

async function authenticatedFetch(path: string, accessToken: string, init?: RequestInit) {
  if (isCookieSessionToken(accessToken)) {
    const proxyResponse = await fetchWithConnectionError(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.headers ?? {})
      }
    });

    if (proxyResponse.status === 401) {
      notifySessionExpired();
      throw new AuthRequestError("Your session expired. Sign in again.", 401);
    }

    if (!proxyResponse.ok) {
      throw await responseError(proxyResponse);
    }

    return proxyResponse;
  }

  const response = await fetchWithConnectionError(`${getApiBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401) {
    let refreshedAccessToken: string | null;
    try {
      const currentAccessToken = getAccessToken();
      if (currentAccessToken && currentAccessToken !== accessToken && !["GET", "HEAD"].includes(init?.method ?? "GET")) {
        throw new Error("Your session changed. Please retry this action.");
      }
      refreshedAccessToken = currentAccessToken && currentAccessToken !== accessToken
        ? currentAccessToken : await refreshStoredLocalSession();
    } catch (error) {
      if (isAuthenticationFailure(error)) notifySessionExpired();
      throw error;
    }
    if (refreshedAccessToken) {
      const retryResponse = await fetchWithConnectionError(`${getApiBaseUrl()}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${refreshedAccessToken}`
        }
      });

      if (retryResponse.ok) {
        return retryResponse;
      }
      if (retryResponse.status !== 401) {
        throw await responseError(retryResponse);
      }
    }

    clearTokens();
    notifySessionExpired();
    throw new AuthRequestError("Your session expired. Sign in again.", 401);
  }

  if (!response.ok) {
    throw await responseError(response);
  }

  return response;
}

export async function listAccounts(accessToken: string, signal?: AbortSignal): Promise<Account[]> {
  const response = await authenticatedFetch("/api/accounts/", accessToken, { signal });
  return collectionSchema(accountSchema).parse(await response.json());
}

export async function createAccount(
  accessToken: string,
  input: CreateAccountInput
): Promise<Account> {
  const response = await authenticatedFetch("/api/accounts/", accessToken, {
    body: JSON.stringify({
      currency: input.currency ?? "BDT",
      name: input.name,
      starting_balance: financialNumber(input.starting_balance || "0.00", "starting balance"),
      type: input.type
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return accountSchema.parse(await response.json());
}

export async function deleteAccount(accessToken: string, id: string): Promise<void> {
  await authenticatedFetch(`/api/accounts/${id}/`, accessToken, {
    method: "DELETE"
  });
}

export async function updateAccount(
  accessToken: string,
  id: string,
  input: UpdateAccountInput
): Promise<Account> {
  const response = await authenticatedFetch(`/api/accounts/${id}/`, accessToken, {
    body: JSON.stringify({
      ...input,
      ...(input.starting_balance !== undefined
        ? { starting_balance: financialNumber(input.starting_balance, "starting balance") }
        : {})
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  return accountSchema.parse(await response.json());
}

export async function listCategories(accessToken: string, signal?: AbortSignal): Promise<Category[]> {
  const response = await authenticatedFetch("/api/categories/", accessToken, { signal });
  return collectionSchema(categorySchema).parse(await response.json());
}

export async function createCategory(
  accessToken: string,
  input: CreateCategoryInput
): Promise<Category> {
  const response = await authenticatedFetch("/api/categories/", accessToken, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return categorySchema.parse(await response.json());
}

export async function deleteCategory(accessToken: string, id: string): Promise<void> {
  await authenticatedFetch(`/api/categories/${id}/`, accessToken, {
    method: "DELETE"
  });
}

export async function updateCategory(
  accessToken: string,
  id: string,
  input: UpdateCategoryInput
): Promise<Category> {
  const response = await authenticatedFetch(`/api/categories/${id}/`, accessToken, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  return categorySchema.parse(await response.json());
}

export async function listPaymentMethods(accessToken: string, signal?: AbortSignal): Promise<PaymentMethod[]> {
  const response = await authenticatedFetch("/api/payment-methods/", accessToken, { signal });
  return collectionSchema(paymentMethodSchema).parse(await response.json());
}

export async function createPaymentMethod(
  accessToken: string,
  input: CreatePaymentMethodInput
): Promise<PaymentMethod> {
  const response = await authenticatedFetch("/api/payment-methods/", accessToken, {
    body: JSON.stringify({
      ...input,
      identifier: input.identifier ?? ""
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return paymentMethodSchema.parse(await response.json());
}

export async function deletePaymentMethod(accessToken: string, id: string): Promise<void> {
  await authenticatedFetch(`/api/payment-methods/${id}/`, accessToken, {
    method: "DELETE"
  });
}

export async function updatePaymentMethod(
  accessToken: string,
  id: string,
  input: UpdatePaymentMethodInput
): Promise<PaymentMethod> {
  const response = await authenticatedFetch(`/api/payment-methods/${id}/`, accessToken, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  return paymentMethodSchema.parse(await response.json());
}

export async function listSenderRules(accessToken: string): Promise<SenderRule[]> {
  const response = await authenticatedFetch("/api/messages/sender-rules/", accessToken);
  return collectionSchema(senderRuleSchema).parse(await response.json());
}

export async function getSmsCapturePreference(accessToken: string): Promise<SmsCapturePreference> {
  const response = await authenticatedFetch("/api/messages/capture-preferences/", accessToken);
  return smsCapturePreferenceSchema.parse(await response.json());
}

export async function updateSmsCapturePreference(
  accessToken: string,
  input: Partial<Pick<SmsCapturePreference, "excluded_message_kinds" | "excluded_providers" | "raw_sms_retention_days">>
): Promise<SmsCapturePreference> {
  const response = await authenticatedFetch("/api/messages/capture-preferences/", accessToken, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "PATCH"
  });
  return smsCapturePreferenceSchema.parse(await response.json());
}

export async function getSmsDeviceStatus(accessToken: string): Promise<SmsDeviceStatus> {
  const response = await authenticatedFetch("/api/messages/device-status/", accessToken);
  return smsDeviceStatusSchema.parse(await response.json());
}

export async function createSenderRule(
  accessToken: string,
  input: CreateSenderRuleInput
): Promise<SenderRule> {
  const response = await authenticatedFetch("/api/messages/sender-rules/", accessToken, {
    body: JSON.stringify({
      ...input,
      match_type: input.match_type ?? "exact",
      payment_method: input.payment_method || null,
      pattern: input.pattern ?? "",
      priority: input.priority ?? 100
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return senderRuleSchema.parse(await response.json());
}

export async function deleteSenderRule(accessToken: string, id: string): Promise<void> {
  await authenticatedFetch(`/api/messages/sender-rules/${id}/`, accessToken, {
    method: "DELETE"
  });
}

export async function updateSenderRule(
  accessToken: string,
  id: string,
  input: UpdateSenderRuleInput
): Promise<SenderRule> {
  const response = await authenticatedFetch(`/api/messages/sender-rules/${id}/`, accessToken, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  return senderRuleSchema.parse(await response.json());
}

export async function listMessageCandidates(accessToken: string): Promise<ParsedMessageCandidate[]> {
  const response = await authenticatedFetch("/api/messages/review/", accessToken);
  return collectionSchema(parsedMessageCandidateSchema).parse(await response.json());
}

export async function reprocessMessageCandidate(
  accessToken: string,
  id: string
): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/reprocess/`, accessToken, {
    method: "POST"
  });
  return parsedMessageCandidateSchema.parse(await response.json());
}

export async function reprocessPendingMessageCandidates(
  accessToken: string
): Promise<{ remaining_for_review: number; reprocessed: number; requested: number }> {
  const response = await authenticatedFetch("/api/messages/review/reprocess/", accessToken, {
    method: "POST"
  });
  return z.object({
    remaining_for_review: z.number(),
    reprocessed: z.number(),
    requested: z.number()
  }).parse(await response.json());
}

export async function confirmMessageCandidate(
  accessToken: string,
  id: string,
  input: ConfirmMessageCandidateInput
): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/confirm/`, accessToken, {
    body: JSON.stringify({
      ...input,
      ...(input.amount !== undefined ? { amount: financialNumber(input.amount, "amount") } : {}),
      ...(input.balance_after !== undefined
        ? { balance_after: optionalFinancialNumber(input.balance_after, "balance after") }
        : {})
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return parsedMessageCandidateSchema.parse(await response.json());
}

export async function ignoreMessageCandidate(
  accessToken: string,
  id: string
): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/ignore/`, accessToken, {
    method: "POST"
  });
  return parsedMessageCandidateSchema.parse(await response.json());
}

export type RejectMessageCandidateInput = {
  exclude_message_kind?: boolean;
  exclude_provider?: boolean;
  exclude_sender?: boolean;
  note?: string;
  reason: string;
  redact_raw_sms?: boolean;
};

export async function rejectMessageCandidate(
  accessToken: string,
  id: string,
  input: RejectMessageCandidateInput
): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/reject/`, accessToken, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  return parsedMessageCandidateSchema.parse(await response.json());
}

export async function redactRawMessage(
  accessToken: string,
  id: string
): Promise<{ candidate: ParsedMessageCandidate | null; message: RawMessage }> {
  const response = await authenticatedFetch(`/api/messages/raw/${id}/redact/`, accessToken, {
    method: "POST"
  });
  return z.object({
    candidate: parsedMessageCandidateSchema.nullable(),
    message: rawMessageSchema
  }).parse(await response.json());
}

export async function listTransactionSourceMessages(accessToken: string, id: string): Promise<TransactionSourceMessage[]> {
  const response = await authenticatedFetch(`/api/transactions/${id}/source-messages/`, accessToken);
  return z.array(transactionSourceMessageSchema).parse(await response.json());
}

export async function listTransactions(
  accessToken: string,
  filters: TransactionFilters = {},
  signal?: AbortSignal
): Promise<Transaction[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const path = query ? `/api/transactions/?${query}` : "/api/transactions/";
  const response = await authenticatedFetch(path, accessToken, { signal });
  return collectionSchema(transactionSchema).parse(await response.json());
}

export async function exportTransactionsCsv(
  accessToken: string,
  filters: TransactionFilters = {}
): Promise<Blob> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value && key !== "ordering") {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const path = query ? `/api/transactions/export/?${query}` : "/api/transactions/export/";
  const response = await authenticatedFetch(path, accessToken);
  return response.blob();
}

export async function createTransaction(
  accessToken: string,
  input: CreateTransactionInput
): Promise<Transaction> {
  const response = await authenticatedFetch("/api/transactions/", accessToken, {
    body: JSON.stringify({
      ...input,
      amount: financialNumber(input.amount, "amount"),
      balance_after: optionalFinancialNumber(input.balance_after, "balance after"),
      source: input.source ?? "web"
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  return transactionSchema.parse(await response.json());
}

export async function deleteTransaction(accessToken: string, id: string): Promise<void> {
  await authenticatedFetch(`/api/transactions/${id}/`, accessToken, {
    method: "DELETE"
  });
}

export async function updateTransaction(
  accessToken: string,
  id: string,
  input: UpdateTransactionInput
): Promise<Transaction> {
  const response = await authenticatedFetch(`/api/transactions/${id}/`, accessToken, {
    body: JSON.stringify({
      ...input,
      ...(input.amount !== undefined ? { amount: financialNumber(input.amount, "amount") } : {}),
      ...(input.balance_after !== undefined
        ? { balance_after: optionalFinancialNumber(input.balance_after, "balance after") }
        : {})
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  return transactionSchema.parse(await response.json());
}

export async function getMonthlyReport(
  accessToken: string,
  month: string
): Promise<MonthlyReport> {
  const params = new URLSearchParams({ month });
  const response = await authenticatedFetch(`/api/reports/monthly/?${params}`, accessToken);
  return monthlyReportSchema.parse(await response.json());
}

export async function getPeriodReport(accessToken: string, start_date: string, end_date: string, signal?: AbortSignal): Promise<MonthlyReport> {
  const params = new URLSearchParams({ start_date, end_date });
  const response = await authenticatedFetch(`/api/reports/monthly/?${params}`, accessToken, { signal });
  return monthlyReportSchema.parse(await response.json());
}

export async function listDebts(accessToken: string): Promise<Debt[]> {
  const response = await authenticatedFetch("/api/debts/", accessToken);
  return collectionSchema(debtSchema).parse(await response.json());
}

export async function createDebt(accessToken: string, input: CreateDebtInput): Promise<Debt> {
  const response = await authenticatedFetch("/api/debts/", accessToken, {
    body: JSON.stringify({
      counterparty_name: input.counterparty_name,
      direction: input.direction,
      due_date: input.due_date || null,
      note: input.note || "",
      opened_at: input.opened_at,
      opened_transaction: input.opened_transaction || null,
      principal_amount: input.principal_amount
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return debtSchema.parse(await response.json());
}

export async function createDebtPayment(
  accessToken: string,
  debtId: string,
  input: CreateDebtPaymentInput
): Promise<DebtPayment> {
  const response = await authenticatedFetch(`/api/debts/${debtId}/payments/`, accessToken, {
    body: JSON.stringify({
      amount: input.amount,
      note: input.note || "",
      paid_at: input.paid_at,
      transaction: input.transaction || null
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return debtPaymentSchema.parse(await response.json());
}

export async function listCreditCardBills(
  accessToken: string,
  filters: CreditCardBillFilters = {}
): Promise<CreditCardBill[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const path = query ? `/api/credit-card-bills/?${query}` : "/api/credit-card-bills/";
  const response = await authenticatedFetch(path, accessToken);
  return collectionSchema(creditCardBillSchema).parse(await response.json());
}

export async function createCreditCardBill(
  accessToken: string,
  input: CreateCreditCardBillInput
): Promise<CreditCardBill> {
  const response = await authenticatedFetch("/api/credit-card-bills/", accessToken, {
    body: JSON.stringify({
      account: input.account,
      due_date: input.due_date,
      minimum_due: input.minimum_due || "0.00",
      note: input.note || "",
      reference: input.reference || "",
      statement_balance: input.statement_balance,
      statement_date: input.statement_date,
      statement_transaction: input.statement_transaction || null
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return creditCardBillSchema.parse(await response.json());
}

export async function createCreditCardPayment(
  accessToken: string,
  billId: string,
  input: CreateCreditCardPaymentInput
): Promise<CreditCardPayment> {
  const response = await authenticatedFetch(`/api/credit-card-bills/${billId}/payments/`, accessToken, {
    body: JSON.stringify({
      amount: input.amount,
      note: input.note || "",
      paid_at: input.paid_at,
      transaction: input.transaction || null
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return creditCardPaymentSchema.parse(await response.json());
}

export async function listRecurringBills(
  accessToken: string,
  filters: RecurringBillFilters = {}
): Promise<RecurringBill[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const path = query ? `/api/recurring-bills/?${query}` : "/api/recurring-bills/";
  const response = await authenticatedFetch(path, accessToken);
  return collectionSchema(recurringBillSchema).parse(await response.json());
}

export async function createRecurringBill(
  accessToken: string,
  input: CreateRecurringBillInput
): Promise<RecurringBill> {
  const response = await authenticatedFetch("/api/recurring-bills/", accessToken, {
    body: JSON.stringify({
      account: input.account,
      amount: input.amount,
      auto_create_transaction: input.auto_create_transaction ?? false,
      category: input.category || null,
      frequency: input.frequency,
      name: input.name,
      next_due_date: input.next_due_date,
      note: input.note || "",
      reminder_days_before: input.reminder_days_before ?? 3,
      status: input.status ?? "active"
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return recurringBillSchema.parse(await response.json());
}

export async function createRecurringBillPayment(
  accessToken: string,
  billId: string,
  input: CreateRecurringBillPaymentInput
): Promise<RecurringBillPayment> {
  const response = await authenticatedFetch(`/api/recurring-bills/${billId}/payments/`, accessToken, {
    body: JSON.stringify({
      amount: input.amount,
      note: input.note || "",
      paid_at: input.paid_at,
      transaction: input.transaction || null
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return recurringBillPaymentSchema.parse(await response.json());
}

export async function listBalanceSnapshots(
  accessToken: string,
  filters: BalanceSnapshotFilters = {}
): Promise<BalanceSnapshot[]> {
  const params = new URLSearchParams();

  if (filters.account) {
    params.set("account", filters.account);
  }

  const query = params.toString();
  const path = query ? `/api/reconciliation/snapshots/?${query}` : "/api/reconciliation/snapshots/";
  const response = await authenticatedFetch(path, accessToken);
  return collectionSchema(balanceSnapshotSchema).parse(await response.json());
}

export async function createBalanceSnapshot(
  accessToken: string,
  input: CreateBalanceSnapshotInput
): Promise<BalanceSnapshot> {
  const response = await authenticatedFetch("/api/reconciliation/snapshots/", accessToken, {
    body: JSON.stringify({
      account: input.account,
      actual_balance: financialNumber(input.actual_balance, "actual balance"),
      checked_at: input.checked_at,
      note: input.note || ""
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return balanceSnapshotSchema.parse(await response.json());
}

export async function getAccountReconciliation(
  accessToken: string,
  accountId: string
): Promise<AccountReconciliation> {
  const response = await authenticatedFetch(`/api/reconciliation/accounts/${accountId}/`, accessToken);
  return accountReconciliationSchema.parse(await response.json());
}

export async function listAuditLogs(
  accessToken: string,
  filters: AuditLogFilters = {}
): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const path = query ? `/api/audit-logs/?${query}` : "/api/audit-logs/";
  const response = await authenticatedFetch(path, accessToken);
  return collectionSchema(auditLogEntrySchema).parse(await response.json());
}


export type TransferMatchInput = {
  candidate?: string;
  draft?: CreateTransactionInput | ConfirmMessageCandidateInput;
  exclude_transaction?: string;
};
function transferMatchBody(input: TransferMatchInput) {
  const draft = input.draft;
  return {
    ...input,
    ...(draft ? { draft: {
      ...draft,
      ...(draft.amount !== undefined ? { amount: financialNumber(draft.amount, "amount") } : {}),
      ...(draft.balance_after !== undefined ? { balance_after: optionalFinancialNumber(draft.balance_after, "balance after") } : {})
    } } : {})
  };
}
export async function findTransferMatches(accessToken: string, input: TransferMatchInput): Promise<TransferMatch[]> {
  const response = await authenticatedFetch("/api/transactions/transfer-matches/", accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(transferMatchBody(input))
  });
  return z.array(transferMatchSchema).parse(await response.json());
}
export async function linkTransfer(accessToken: string, input: TransferMatchInput, match: TransferMatch): Promise<Transaction> {
  const response = await authenticatedFetch("/api/transactions/link-transfer/", accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...transferMatchBody(input), [match.kind === "transaction" ? "match_transaction" : "match_candidate"]: match.id })
  });
  return transactionSchema.parse(await response.json());
}
export async function mergeTransfers(accessToken: string, retainedId: string, duplicateId: string): Promise<Transaction> {
  const response = await authenticatedFetch(`/api/transactions/${retainedId}/merge-transfer/`, accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: duplicateId })
  });
  return transactionSchema.parse(await response.json());
}

const statementRowSchema = z.object({
  id: z.string(), page: z.number(), row: z.number(), date: z.string().nullable(),
  time: z.string().nullable(), posting_date: z.string().nullable(), value_date: z.string().nullable(),
  description: z.string(), provider_type: z.string(), reference: z.string(),
  direction: z.enum(["debit", "credit"]), amount: z.string().nullable(), signed_fee: z.string(),
  balance_after: z.string().nullable(), issues: z.array(z.string()), bounds: z.array(z.number())
});
const statementPreviewSchema = z.object({
  account: z.string(), account_hint: z.string(), account_identity: z.enum(["matched_suffix", "verify"]),
  profile: z.string(), parser_version: z.string(), currency: z.string(), page_count: z.number(),
  period_start: z.string().nullable(), period_end: z.string().nullable(),
  opening_balance: z.string().nullable(), closing_balance: z.string().nullable(),
  balance_transitions_checked: z.number(), needs_review_count: z.number(), can_post: z.literal(false),
  rows: z.array(statementRowSchema),
  checks: z.array(z.object({ label: z.string(), expected: z.string().nullable(), observed: z.string().nullable(), passed: z.boolean().nullable() })),
  warnings: z.array(z.string())
});
export type StatementPreview = z.infer<typeof statementPreviewSchema>;

export async function previewStatement(accessToken: string, account: string, file: File, password: string, signal?: AbortSignal): Promise<StatementPreview> {
  const body = new FormData();
  body.set("account", account);
  body.set("file", file);
  if (password) body.set("password", password);
  const response = await authenticatedFetch("/api/statements/preview/", accessToken, { method: "POST", body, signal });
  return statementPreviewSchema.parse(await response.json());
}

const savedStatementSchema = z.object({
  id: z.string(), account: z.string(), account_name: z.string(), profile: z.string(), parser_version: z.string(), currency: z.string(),
  account_hint: z.string(), account_identity: z.string(), period_start: z.string().nullable(), period_end: z.string().nullable(), page_count: z.number(),
  opening_balance: z.string().nullable(), closing_balance: z.string().nullable(), checks: statementPreviewSchema.shape.checks, warnings: z.array(z.string()),
  counts: z.object({ total: z.number(), pending: z.number(), posted: z.number(), linked: z.number(), skipped: z.number() }), created_at: z.string(), updated_at: z.string()
});
const statementMatchSchema = z.object({
  strength: z.enum(["strong", "possible"]).default("possible"), merchant_similarity: z.number().default(0), time_difference_minutes: z.number().nullable().default(null),
  id: z.string(), date: z.string(), time: z.string().nullable(), type: z.string(), source: z.string(), amount: z.string(), account_name: z.string(),
  transfer_account_name: z.string().nullable(), category_name: z.string().nullable(), reference: z.string(), note: z.string(), balance_after: z.string().nullable(),
  conflict: z.boolean(), can_link: z.boolean(), reasons: z.array(z.string())
});
const savedStatementRowSchema = z.object({
  id: z.string(), batch: z.string(), position: z.number(), component: z.enum(["principal", "fee"]), extracted: statementRowSchema,
  date: z.string().nullable(), time: z.string().nullable(), value_date: z.string().nullable(), direction: z.enum(["debit", "credit"]), amount: z.string().nullable(), balance_after: z.string().nullable(),
  type: z.enum(["expense", "income", "transfer", "adjustment", "fee", "refund", "lend", "borrow", "repayment_received", "repayment_paid"]),
  other_account: z.string().nullable(), category: z.string().nullable(), reference: z.string(), counterparty_text: z.string(), note: z.string(), classification_confirmed: z.boolean(),
  state: z.enum(["pending", "posted", "linked", "skipped"]), transaction: z.string().nullable(), version: z.number(), created_at: z.string(), updated_at: z.string(),
  review: z.object({ draft_issues: z.array(z.string()).default([]), suggestion: z.object({ type: z.enum(["expense", "income", "transfer", "adjustment", "fee", "refund", "lend", "borrow", "repayment_received", "repayment_paid"]), category: z.string().nullable(), other_account: z.string().nullable(), reason: z.string() }).nullable().default(null), issues: z.array(z.string()), review_state: z.string(), matches: z.array(statementMatchSchema), matching_truncated: z.boolean(), requires_acknowledgement: z.boolean() })
});
const statementRowPageSchema = z.object({ count: z.number(), offset: z.number(), limit: z.number(), results: z.array(savedStatementRowSchema) });
const statementHistorySchema = z.object({ count: z.number(), next: z.string().nullable(), previous: z.string().nullable(), results: z.array(savedStatementSchema) });
export type SavedStatement = z.infer<typeof savedStatementSchema>;
export type SavedStatementRow = z.infer<typeof savedStatementRowSchema>;
export type StatementMatch = z.infer<typeof statementMatchSchema>;
export type StatementRowPage = z.infer<typeof statementRowPageSchema>;
export type StatementHistory = z.infer<typeof statementHistorySchema>;
export type StatementRowEdit = Pick<SavedStatementRow, "version" | "date" | "time" | "value_date" | "direction" | "amount" | "balance_after" | "type" | "other_account" | "category" | "reference" | "counterparty_text" | "note" | "classification_confirmed">;
export type StatementDecision = { action: "create" | "link" | "skip" | "unlink" | "reopen"; version: number; transaction?: string; remember_choices?: boolean; allow_separate?: boolean; acknowledge_issues?: boolean; acknowledge_conflict?: boolean };

export async function createStatementImport(token: string, account: string, file: File, password: string, signal?: AbortSignal): Promise<SavedStatement> {
  const body = new FormData(); body.set("account", account); body.set("file", file); if (password) body.set("password", password);
  return savedStatementSchema.parse(await (await authenticatedFetch("/api/statements/imports/", token, { method: "POST", body, signal })).json());
}
export async function listStatementImports(token: string, offset = 0, signal?: AbortSignal): Promise<StatementHistory> {
  return statementHistorySchema.parse(await (await authenticatedFetch(`/api/statements/imports/?limit=20&offset=${offset}`, token, { signal })).json());
}
export async function getStatementImport(token: string, id: string, signal?: AbortSignal): Promise<SavedStatement> {
  return savedStatementSchema.parse(await (await authenticatedFetch(`/api/statements/imports/${id}/`, token, { signal })).json());
}
export async function listStatementRows(token: string, id: string, filters: Record<string, string>, offset = 0, signal?: AbortSignal): Promise<StatementRowPage> {
  const query = new URLSearchParams({ limit: "50", offset: String(offset) }); Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return statementRowPageSchema.parse(await (await authenticatedFetch(`/api/statements/imports/${id}/rows/?${query}`, token, { signal })).json());
}
export async function getStatementRow(token: string, id: string, signal?: AbortSignal): Promise<SavedStatementRow> {
  return savedStatementRowSchema.parse(await (await authenticatedFetch(`/api/statements/rows/${id}/`, token, { signal })).json());
}
export async function updateStatementRow(token: string, id: string, input: StatementRowEdit): Promise<SavedStatementRow> {
  return savedStatementRowSchema.parse(await (await authenticatedFetch(`/api/statements/rows/${id}/`, token, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json());
}
export async function decideStatementRow(token: string, id: string, input: StatementDecision): Promise<SavedStatementRow> {
  return savedStatementRowSchema.parse(await (await authenticatedFetch(`/api/statements/rows/${id}/decide/`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json());
}
export async function approveNewStatementRows(token: string, id: string, rows: { id: string; version: number }[]) {
  const response = await authenticatedFetch(`/api/statements/imports/${id}/approve_new/`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
  return z.object({ added: z.number(), unchanged: z.number(), unresolved: z.array(z.object({ id: z.string(), reason: z.string() })) }).parse(await response.json());
}
export async function listTransactionStatementEvidence(token: string, id: string, signal?: AbortSignal): Promise<SavedStatementRow[]> {
  return z.array(savedStatementRowSchema).parse(await (await authenticatedFetch(`/api/transactions/${id}/statement-evidence/`, token, { signal })).json());
}

const statementSummarySchema = z.object({
  totals: z.record(z.object({ debit: z.string(), credit: z.string() })),
  dispositions: z.record(z.object({ count: z.number(), debit: z.string(), credit: z.string() })),
  source_net: z.string().nullable(), draft_net: z.string().nullable(), opening_is_derived: z.boolean(),
  checks: statementPreviewSchema.shape.checks, discrepancy_count: z.number(), incomplete_count: z.number(), remaining_count: z.number()
});
export type StatementSummary = z.infer<typeof statementSummarySchema>;
export async function getStatementSummary(token: string, id: string, signal?: AbortSignal): Promise<StatementSummary> {
  return statementSummarySchema.parse(await (await authenticatedFetch(`/api/statements/imports/${id}/summary/`, token, { signal })).json());
}
export async function reviewSelectedStatementRows(token: string, id: string, rows: { id: string; version: number }[], action: "create" | "skip") {
  return z.object({ added: z.number(), skipped: z.number(), unchanged: z.number(), unresolved: z.array(z.object({ id: z.string(), reason: z.string() })) }).parse(await (await authenticatedFetch(`/api/statements/imports/${id}/review_selected/`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, action }) })).json());
}

const statementComparisonSchema = z.object({
  counts: z.record(z.number()), period_start: z.string().nullable(), period_end: z.string().nullable(),
  ledger_only_available: z.boolean(), complete: z.boolean(), warnings: z.array(z.string()), count: z.number(), offset: z.number(), limit: z.number(),
  results: z.array(z.object({ id: z.string(), date: z.string(), time: z.string().nullable(), direction: z.string(),
    amount: z.string(), balance_after: z.string().nullable(), description: z.string(), source: z.string() }))
});
export type StatementComparison = z.infer<typeof statementComparisonSchema>;
export async function getStatementComparison(token: string, id: string, offset = 0, signal?: AbortSignal): Promise<StatementComparison> {
  return statementComparisonSchema.parse(await (await authenticatedFetch(`/api/statements/imports/${id}/comparison/?limit=50&offset=${offset}`, token, { signal })).json());
}
