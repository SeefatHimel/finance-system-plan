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
  TransactionType
} from "../../finance-contracts/generated/types";
import {
  clearTokens,
  getRefreshToken,
  isCookieSessionToken,
  saveTokens
} from "./auth-storage";

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
  payment_method: z.string().nullable(),
  possible_internal_transfer: z.boolean(),
  possible_related_candidate: z.string().nullable(),
  provider: z.string(),
  raw_message: rawMessageSchema,
  reference: z.string(),
  rejected_at: z.string().nullable(),
  rejection_note: z.string(),
  rejection_reason: z.string(),
  related_match_reason: z.string(),
  sender_rule: z.string().nullable(),
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

const transactionSchema = z.object({
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
  reference: z.string(),
  source: z.string(),
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
  month: z.string(),
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
  reference?: string;
  source?: TransactionSource;
  transfer_account?: string;
  type: TransactionType;
};

export type TransactionFilters = {
  account?: string;
  category?: string;
  direction?: TransactionDirection | "";
  month?: string;
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
  account?: string;
  amount?: string;
  balance_after?: string | null;
  category?: string | null;
  counterparty_text?: string;
  date?: string;
  direction?: TransactionDirection;
  external_key?: string;
  note?: string;
  payment_method?: string | null;
  raw_message?: string | null;
  reference?: string;
  transfer_account?: string | null;
  type?: TransactionType;
};

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
    throw new Error(response.status === 401 ? "Invalid username or password." : "Login failed.");
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
    throw new Error(response.status === 401 ? "Stored session expired. Sign in again." : "Could not refresh session.");
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
    saveTokens(tokens);
    return tokens.access;
  } catch {
    clearTokens();
    return null;
  }
}

async function authenticatedFetch(path: string, accessToken: string, init?: RequestInit) {
  if (isCookieSessionToken(accessToken)) {
    const proxyResponse = await fetch(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.headers ?? {})
      }
    });

    if (proxyResponse.status === 401) {
      throw new Error("Your session expired. Sign in again.");
    }

    if (!proxyResponse.ok) {
      throw new Error(`Request failed with HTTP ${proxyResponse.status}.`);
    }

    return proxyResponse;
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401) {
    const refreshedAccessToken = await refreshStoredLocalSession();
    if (refreshedAccessToken) {
      const retryResponse = await fetch(`${getApiBaseUrl()}${path}`, {
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
        throw new Error(`Request failed with HTTP ${retryResponse.status}.`);
      }
    }

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

export async function createAccount(
  accessToken: string,
  input: CreateAccountInput
): Promise<Account> {
  const response = await authenticatedFetch("/api/accounts/", accessToken, {
    body: JSON.stringify({
      currency: input.currency ?? "BDT",
      name: input.name,
      starting_balance: input.starting_balance || "0.00",
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
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json"
    },
    method: "PATCH"
  });
  return accountSchema.parse(await response.json());
}

export async function listCategories(accessToken: string): Promise<Category[]> {
  const response = await authenticatedFetch("/api/categories/", accessToken);
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

export async function listPaymentMethods(accessToken: string): Promise<PaymentMethod[]> {
  const response = await authenticatedFetch("/api/payment-methods/", accessToken);
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

export async function confirmMessageCandidate(
  accessToken: string,
  id: string,
  input: ConfirmMessageCandidateInput
): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/confirm/`, accessToken, {
    body: JSON.stringify(input),
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

export async function listTransactions(
  accessToken: string,
  filters: TransactionFilters = {}
): Promise<Transaction[]> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  const path = query ? `/api/transactions/?${query}` : "/api/transactions/";
  const response = await authenticatedFetch(path, accessToken);
  return collectionSchema(transactionSchema).parse(await response.json());
}

export async function exportTransactionsCsv(
  accessToken: string,
  filters: TransactionFilters = {}
): Promise<Blob> {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value) {
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
    body: JSON.stringify(input),
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
      actual_balance: input.actual_balance,
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
