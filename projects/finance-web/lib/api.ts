import type { QuickPreset, PresetInput, QuickEntryInput } from "../../finance-contracts/quick-add";
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
import { fetchWithConnectionError, RequestError, responseError } from "./api-errors";

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
  identity: z.object({
    id: z.string(), provider: z.string(), identifier: z.string(),
    identifier_kind: z.enum(["any", "account", "card"]),
    additional_identifiers: z.array(z.object({ kind: z.enum(["account", "card"]), value: z.string(), label: z.string() })),
    aliases: z.array(z.string()), is_active: z.boolean()
  }).nullable().default(null),
  created_at: z.string(),
  currency: z.string(),
  display_order: z.number(),
  id: z.string(),
  is_active: z.boolean(),
  latest_reported_balance: z.string().nullable(),
  latest_reported_balance_date: z.string().nullable(),
  ledger_balance_at_latest_report: z.string().nullable().default(null),
  latest_reported_balance_difference: z.string().nullable().default(null),
  reported_balance_comparison: z.enum(["unavailable", "matched", "mismatch", "credit_card_reference", "timing_unknown", "report_precedes_movement"]).default("unavailable"),
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

const categoryUsageSchema = z.object({
  category: z.string(),
  transaction_count: z.number().int().nonnegative()
});

const paymentMethodSchema = z.object({
  identifier_kind: z.enum(["any", "account", "card"]).default("any"),
  additional_identifiers: z.array(z.object({ kind: z.enum(["account", "card"]), value: z.string(), label: z.string().default("") })).default([]),
  aliases: z.array(z.string()).default([]),
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
  parsed: z.object({ candidate_id: z.string().optional(), can_remember_cash_route: z.boolean().optional(), amount: z.string().nullable(), balance_after: z.string().nullable(), reference: z.string(), type: z.string() }).nullable().optional(),
  id: z.string(),
  sender: z.string(),
  body: z.string().nullable(),
  received_at: z.string(),
  status: z.string(),
  redacted_at: z.string().nullable()
});

const transactionIssuePageSchema = z.object({
  scanned: z.number(), total: z.number(), next_offset: z.number().nullable(),
  results: z.array(z.object({
    transaction: z.string(), date: z.string(), account: z.string(), amount: z.string(),
    issues: z.array(z.object({ code: z.string(), level: z.enum(["check", "suggestion"]), text: z.string() }))
  }))
});

const evidenceDirectionRefreshPageSchema = z.object({
  sms_scanned: z.number(), sms_total: z.number(), sms_updated: z.number(),
  sms_known: z.number(), sms_unknown: z.number(),
  statement_scanned: z.number(), statement_total: z.number(),
  statement_known: z.number(), statement_unknown: z.number(),
  next_offset: z.number().nullable(),
});
export type EvidenceDirectionRefreshPage = z.infer<typeof evidenceDirectionRefreshPageSchema>;

const transactionActionSchema = z.object({
  id: z.string(), kind: z.string(), label: z.string(), transaction: z.string().nullable(),
  created_at: z.string(), expires_at: z.string(), can_undo: z.boolean(), undone: z.boolean()
});
export type TransactionAction = z.infer<typeof transactionActionSchema>;

const parsedMessageCandidateSchema = z.object({
  undo_action: transactionActionSchema.nullable().optional(),
  identity_suggestions: z.array(z.object({
    role: z.enum(["sender", "receiver"]), reason: z.string(), observed_identifiers: z.array(z.string()),
    choices: z.array(z.object({ account: z.string(), name: z.string(), payment_method: z.string(), method_name: z.string(), provider: z.string() }))
  })).default([]),
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
  source_direction: z.enum(["", "debit", "credit"]).default(""),
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
  reported_balances: z.array(z.object({ account: z.string(), balance_after: z.string().nullable() })),
  id: z.string(), kind: z.enum(["transaction", "candidate"]),
  account: z.string(), account_name: z.string(), transfer_account: z.string(), transfer_account_name: z.string(),
  amount: z.string(), date: z.string(), time: z.string().nullable(), reference: z.string(), reason: z.string()
});
export type { TransferMatch } from "../../finance-contracts/generated/types";

const transactionSchema = z.object({
  undo_action: transactionActionSchema.nullable().optional(),
  balance_reporting_account: z.string().nullable().optional(),
  reported_balances: z.array(z.object({ account: z.string(), balance_after: z.string().nullable() })).optional(),
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
export type TransactionIssuePage = z.infer<typeof transactionIssuePageSchema>;
export type SmsCapturePreference = z.infer<typeof smsCapturePreferenceSchema>;
export type SmsDeviceStatus = z.infer<typeof smsDeviceStatusSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionActivityPage = { count: number; next_offset: number | null; results: Transaction[] };
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
  needs_review?: boolean;
  reported_balances?: { account: string; balance_after: string | null }[];
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
  date_field?: "date" | "created_at" | "updated_at";
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
  reported_balances?: { account: string; balance_after: string | null }[];
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
  const field = label === "reported balance" ? "reported_balances" : label.replaceAll(" ", "_");
  const normalized = String(value).trim().replaceAll(",", "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new RequestError(`Enter a valid ${label} with no more than two decimal places.`, { [field]: "Use a number with no more than two decimal places." });
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new RequestError(`Enter a valid ${label}.`, { [field]: "Enter a valid number." });
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

export async function updateCurrentUser(
  accessToken: string,
  profile: Pick<CurrentUser, "first_name" | "last_name" | "email">
): Promise<CurrentUser> {
  const response = await authenticatedFetch("/api/auth/me/", accessToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  });
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
      throw new AuthRequestError("Could not verify your session. Please retry this request.", 401);
    }

    if (!proxyResponse.ok) {
      throw Object.assign(await responseError(proxyResponse), { status: proxyResponse.status });
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
        throw Object.assign(await responseError(retryResponse), { status: retryResponse.status });
      }
    }

    clearTokens();
    notifySessionExpired();
    throw new AuthRequestError("Your session expired. Sign in again.", 401);
  }

  if (!response.ok) {
    throw Object.assign(await responseError(response), { status: response.status });
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
      identity: input.identity,
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

export async function listCategoryUsage(accessToken: string, signal?: AbortSignal): Promise<Record<string, number>> {
  const response = await authenticatedFetch("/api/categories/usage/", accessToken, { signal });
  const rows = z.array(categoryUsageSchema).parse(await response.json());
  return Object.fromEntries(rows.map((row) => [row.category, row.transaction_count]));
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

export async function revealPaymentMethodIdentifiers(accessToken: string, id: string): Promise<{
  identifier: string;
  additional_identifiers: { kind: "account" | "card"; value: string; label: string }[];
}> {
  const response = await authenticatedFetch(`/api/payment-methods/${id}/original-identifiers/`, accessToken, { cache: "no-store" });
  return z.object({
    identifier: z.string(),
    additional_identifiers: z.array(z.object({ kind: z.enum(["account", "card"]), value: z.string(), label: z.string() }))
  }).parse(await response.json());
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

export async function listMessageCandidatePage(accessToken: string, offset = 0, limit = 100): Promise<{ count: number; results: ParsedMessageCandidate[] }> {
  const response = await authenticatedFetch(`/api/messages/review/?limit=${limit}&offset=${offset}`, accessToken);
  return z.object({ count: z.number().int().nonnegative(), results: z.array(parsedMessageCandidateSchema) }).parse(await response.json());
}

export async function getPendingMessageCandidate(accessToken: string, id: string): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${encodeURIComponent(id)}/`, accessToken);
  return parsedMessageCandidateSchema.parse(await response.json());
}

export async function getDashboardSummary(accessToken: string, startDate: string, endDate: string, signal?: AbortSignal): Promise<{
  automated_count: number;
  pending_count: number;
  recent_candidates: ParsedMessageCandidate[];
  recent_transactions: Transaction[];
}> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const response = await authenticatedFetch(`/api/reports/dashboard-summary/?${params}`, accessToken, { signal });
  return z.object({
    automated_count: z.number().int().nonnegative(),
    pending_count: z.number().int().nonnegative(),
    recent_candidates: z.array(parsedMessageCandidateSchema),
    recent_transactions: z.array(transactionSchema)
  }).parse(await response.json());
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

export async function rememberConfirmedMessageChoice(
  accessToken: string,
  id: string,
  replaceExisting = false
): Promise<{ saved: true; scope: string; account: string; destination?: string }> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/remember/`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replace_existing: replaceExisting })
  });
  return await response.json();
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

const transactionRevalidationSchema = z.object({
  transaction: z.string().uuid(), currency: z.string(), policy: z.string(), fingerprint: z.string(), token: z.string(), expires_in: z.number(),
  suggestions: z.array(z.object({ key: z.string(), label: z.string(), current: z.string().nullable(), proposed: z.string(), reason: z.string(), value: z.string().optional() })),
  ledger: z.object({ date: z.string(), type: z.string(), amount: z.string(), accounts: z.array(z.object({ id: z.string().uuid(), name: z.string(), currency: z.string(), direction: z.string(), balance_after: z.string().nullable() })) }),
  sources: z.array(z.object({ kind: z.string(), id: z.string().uuid(), account: z.string().uuid().nullable(), account_name: z.string(), currency: z.string().nullable(), direction: z.string().nullable(), date: z.string().nullable(), time: z.string().nullable(), raw_message: z.string().uuid().nullable(), amount: z.string().nullable(), balance_after: z.string().nullable(), usable: z.boolean(), has_fee: z.boolean(), issues: z.array(z.string()) })),
  warnings: z.array(z.string()),
});
export type TransactionRevalidation = z.infer<typeof transactionRevalidationSchema>;

export async function previewTransactionRevalidation(token: string, id: string, signal?: AbortSignal): Promise<TransactionRevalidation> {
  return transactionRevalidationSchema.parse(await (await authenticatedFetch(`/api/transactions/${id}/revalidate/`, token, { signal })).json());
}

export async function applyTransactionRevalidation(token: string, id: string, previewToken: string, selected: string[]): Promise<Transaction> {
  return transactionSchema.parse(await (await authenticatedFetch(`/api/transactions/${id}/apply-revalidation/`, token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: previewToken, selected }),
  })).json());
}

export async function correctTransactionSmsEvidence(
  token: string, id: string, previewToken: string, candidate: string,
  action: "move" | "unlink", account?: string,
): Promise<Transaction> {
  return transactionSchema.parse(await (await authenticatedFetch(`/api/transactions/${id}/correct-sms-evidence/`, token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: previewToken, candidate, action, ...(account ? { account } : {}) }),
  })).json());
}

const bulkRevalidationEntrySchema = z.object({
  date: z.string(), account_name: z.string(), amount: z.string(), description: z.string(), preview: transactionRevalidationSchema,
});
const bulkRevalidationPageSchema = z.object({
  scanned: z.number(), total: z.number(), started_at: z.string(), next_cursor: z.string().nullable(), results: z.array(bulkRevalidationEntrySchema),
});
export type BulkRevalidationEntry = z.infer<typeof bulkRevalidationEntrySchema>;
export type BulkRevalidationPage = z.infer<typeof bulkRevalidationPageSchema>;

export async function scanTransactionRevalidation(token: string, cursor: string, signal?: AbortSignal): Promise<BulkRevalidationPage> {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return bulkRevalidationPageSchema.parse(await (await authenticatedFetch(`/api/transactions/revalidation/?${query}`, token, { signal })).json());
}

export async function applyBulkRevalidation(token: string, items: { transaction: string; token: string; selected: string[] }[]) {
  return z.object({ applied: z.array(z.string().uuid()), batch: z.string().uuid(), undo_action: transactionActionSchema.nullable() }).parse(
    await (await authenticatedFetch("/api/transactions/apply-revalidation/", token, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
    })).json()
  );
}

export async function refreshEvidenceDirections(accessToken: string, offset = 0, signal?: AbortSignal): Promise<EvidenceDirectionRefreshPage> {
  const response = await authenticatedFetch("/api/transactions/refresh-evidence-directions/", accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 100, offset }), signal,
  });
  return evidenceDirectionRefreshPageSchema.parse(await response.json());
}

export async function scanTransactionIssues(accessToken: string, offset = 0, signal?: AbortSignal): Promise<TransactionIssuePage> {
  const response = await authenticatedFetch(`/api/transactions/issues/?limit=50&offset=${offset}`, accessToken, { signal });
  return transactionIssuePageSchema.parse(await response.json());
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

/** Fetch one bounded page for date-windowed views. Transfers appear once in this feed. */
export async function listTransactionActivityPage(
  accessToken: string,
  startDate: string,
  endDate: string,
  offset = 0,
  signal?: AbortSignal
): Promise<TransactionActivityPage> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate, limit: "100", offset: String(offset) });
  const response = await authenticatedFetch(`/api/transactions/activity/?${params}`, accessToken, { signal });
  return z.object({ count: z.number(), next_offset: z.number().nullable(), results: z.array(transactionSchema) }).parse(await response.json());
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
      ...(input.reported_balances ? { reported_balances: input.reported_balances.map(item => ({ ...item, balance_after: optionalFinancialNumber(item.balance_after, "reported balance") })) } : {}),
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
      ...(input.reported_balances ? { reported_balances: input.reported_balances.map(item => ({ ...item, balance_after: optionalFinancialNumber(item.balance_after, "reported balance") })) } : {}),
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
      ...("reported_balances" in draft && draft.reported_balances ? { reported_balances: draft.reported_balances.map(item => ({ ...item, balance_after: optionalFinancialNumber(item.balance_after, "reported balance") })) } : {}),
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
export type TransferBalanceChoice = { account: string; keep: "existing" | "incoming"; existing_balance_after: string; incoming_balance_after: string };
export async function linkTransfer(accessToken: string, input: TransferMatchInput, match: TransferMatch, balanceChoices: TransferBalanceChoice[] = []): Promise<Transaction> {
  const response = await authenticatedFetch("/api/transactions/link-transfer/", accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...transferMatchBody(input), balance_choices: balanceChoices, [match.kind === "transaction" ? "match_transaction" : "match_candidate"]: match.id })
  });
  return transactionSchema.parse(await response.json());
}
export async function mergeTransfers(accessToken: string, retainedId: string, duplicateId: string, balanceChoices: TransferBalanceChoice[] = []): Promise<Transaction> {
  const response = await authenticatedFetch(`/api/transactions/${retainedId}/merge-transfer/`, accessToken, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: duplicateId, balance_choices: balanceChoices })
  });
  return transactionSchema.parse(await response.json());
}

const statementRowSchema = z.object({
  id: z.string(), page: z.number(), row: z.number(), date: z.string().nullable(),
  time: z.string().nullable(), posting_date: z.string().nullable(), value_date: z.string().nullable(),
  description: z.string(), citytouch_printed_code: z.string().nullable().optional(), provider_type: z.string(), reference: z.string(),
  statement_date: z.string().nullable().optional(), source_currency: z.string().optional(), source_amount: z.string().optional(),
  settlement_currency: z.string().optional(), printed_direction_marker: z.enum(["D", "C"]).optional(),
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
  account_suggestion: z.object({ account: z.string().nullable(), name: z.string(), reason: z.string(), ambiguous: z.boolean(), requires_review: z.boolean().default(false), choices: z.array(z.object({ account: z.string(), name: z.string() })).default([]) }).nullable().optional(),
  account_hint: z.string(), account_identity: z.string(), period_start: z.string().nullable(), period_end: z.string().nullable(), page_count: z.number(),
  opening_balance: z.string().nullable(), closing_balance: z.string().nullable(), has_original_file: z.boolean(), checks: statementPreviewSchema.shape.checks, warnings: z.array(z.string()),
  counts: z.object({ total: z.number(), pending: z.number(), posted: z.number(), linked: z.number(), skipped: z.number() }), created_at: z.string(), updated_at: z.string()
});
const statementDetailFieldSchema = z.enum(["counterparty_text", "reference", "note", "sender_account_identifier", "sender_card_identifier", "receiver_account_identifier", "receiver_card_identifier"]);
const statementDetailSuggestionSchema = z.object({ field: statementDetailFieldSchema, label: z.string(), existing_value: z.string(), suggested_value: z.string() });
const statementMatchSchema = z.object({
  strength: z.enum(["strong", "possible"]).default("possible"), merchant_similarity: z.number().default(0), time_difference_minutes: z.number().nullable().default(null),
  id: z.string(), date: z.string(), time: z.string().nullable(), type: z.string(), source: z.string(), amount: z.string(), account_name: z.string(),
  transfer_account_name: z.string().nullable(), category_id: z.string().nullable(), category_name: z.string().nullable(), reference: z.string(), note: z.string(), balance_after: z.string().nullable(),
  ledger_date: z.string(), ledger_time: z.string().nullable(), ledger_source: z.string(), ledger_reference: z.string(), ledger_note: z.string(),
  ledger_counterparty_text: z.string(), ledger_source_balance_after: z.string().nullable(), reporting_observation_is_fallback: z.boolean(),
  effective_balance_after: z.string().nullable(), can_fill_missing_balance: z.boolean().default(false), detail_suggestions: z.array(statementDetailSuggestionSchema),
  conflict: z.boolean(), late_posting: z.boolean().default(false), can_link: z.boolean(), reasons: z.array(z.string()),
  rounding_correction: z.object({ existing_amount: z.string(), statement_amount: z.string(), difference: z.string(), transaction_updated_at: z.string(), can_correct: z.boolean(), blocked_reason: z.string() }).nullable().default(null)
});
const pendingStatementSmsMatchSchema = z.object({
  id: z.string(), date: z.string(), time: z.string(), sender: z.string(), sms_text: z.string().nullable(),
  amount: z.string(), type: z.string(), counterparty_text: z.string(),
  balance_after: z.string().nullable(), late_posting: z.boolean().default(false), reference: z.string(), confidence: z.string(),
  detail_suggestions: z.array(statementDetailSuggestionSchema),
});
const savedStatementRowSchema = z.object({
  id: z.string(), batch: z.string(), position: z.number(), component: z.enum(["principal", "fee"]), extracted: statementRowSchema,
  reviewed_source_direction: z.string().default(""),
  citytouch_printed_code: z.string().nullable(),
  date: z.string().nullable(), time: z.string().nullable(), value_date: z.string().nullable(), direction: z.enum(["debit", "credit"]), amount: z.string().nullable(), balance_after: z.string().nullable(),
  type: z.enum(["expense", "income", "transfer", "adjustment", "fee", "refund", "lend", "borrow", "repayment_received", "repayment_paid"]),
  other_account: z.string().nullable(), category: z.string().nullable(), reference: z.string(), counterparty_text: z.string(), note: z.string(), classification_confirmed: z.boolean(),
  state: z.enum(["pending", "posted", "linked", "skipped"]), transaction: z.string().nullable(), version: z.number(), created_at: z.string(), updated_at: z.string(),
  review: z.object({ draft_issues: z.array(z.string()).default([]), suggestion: z.object({ type: z.enum(["expense", "income", "transfer", "adjustment", "fee", "refund", "lend", "borrow", "repayment_received", "repayment_paid"]), category: z.string().nullable(), other_account: z.string().nullable(), account_candidates: z.array(z.object({ account: z.string(), name: z.string() })).default([]), counterparty_text: z.string().optional(), note: z.string().optional(), reason: z.string() }).nullable().default(null), issues: z.array(z.string()), review_state: z.string(), matches: z.array(statementMatchSchema), pending_sms_match_count: z.number().int().nonnegative().nullable().default(0), unified_pending_sms_pair_id: z.string().nullable().default(null), unified_pending_sms_status: z.enum(["none", "unique", "ambiguous", "unavailable"]).default("none"), pending_sms_matches: z.array(pendingStatementSmsMatchSchema).default([]), matching_truncated: z.boolean(), requires_acknowledgement: z.boolean() })
});
const statementRowPageSchema = z.object({ count: z.number(), offset: z.number(), limit: z.number(), results: z.array(savedStatementRowSchema) });
const statementHistorySchema = z.object({ count: z.number(), next: z.string().nullable(), previous: z.string().nullable(), results: z.array(savedStatementSchema) });
export type SavedStatement = z.infer<typeof savedStatementSchema>;
export type SavedStatementRow = z.infer<typeof savedStatementRowSchema>;
export type StatementMatch = z.infer<typeof statementMatchSchema>;
export type StatementDetailSuggestion = z.infer<typeof statementDetailSuggestionSchema>;
export type StatementDetailChoice = { field: StatementDetailSuggestion["field"]; existing_value: string; value: string };
export type StatementRowPage = z.infer<typeof statementRowPageSchema>;
export type StatementHistory = z.infer<typeof statementHistorySchema>;
export type StatementRowEdit = Pick<SavedStatementRow, "version" | "date" | "time" | "value_date" | "direction" | "amount" | "balance_after" | "type" | "other_account" | "category" | "reference" | "counterparty_text" | "note" | "classification_confirmed">;
export type StatementCategoryChoice = { keep: "existing" | "statement" | "custom"; existing_category: string | null; statement_category: string | null; category?: string | null };
export type StatementDecision = { action: "create" | "link" | "combine_sms" | "skip" | "unlink" | "reopen"; version: number; transaction?: string; candidate?: string; dismissed_ledger_matches?: string[]; acknowledge_distinct_ledger_matches?: boolean; remember_choices?: boolean; allow_separate?: boolean; acknowledge_issues?: boolean; acknowledge_conflict?: boolean; amount_correction?: { existing_amount: string; statement_amount: string; transaction_updated_at: string }; balance_choice?: { keep: "existing" | "statement"; existing_balance_after: string | null; statement_balance_after: string | null }; category_choice?: StatementCategoryChoice; detail_choices?: StatementDetailChoice[] };

export async function createStatementImport(token: string, account: string, file: File, password: string, signal?: AbortSignal): Promise<SavedStatement> {
  const body = new FormData(); body.set("account", account); body.set("file", file); if (password) body.set("password", password);
  return savedStatementSchema.parse(await (await authenticatedFetch("/api/statements/imports/", token, { method: "POST", body, signal })).json());
}
export async function downloadStatementOriginal(token: string, id: string, signal?: AbortSignal): Promise<Blob> {
  return (await authenticatedFetch(`/api/statements/imports/${id}/original/`, token, { signal })).blob();
}

export async function refreshStatementIdentifiers(token: string, id: string, password = ""): Promise<number> {
  const response = await authenticatedFetch(`/api/statements/imports/${id}/refresh-identifiers/`, token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
  });
  return z.object({ updated_rows: z.number().int().nonnegative() }).parse(await response.json()).updated_rows;
}
const statementDirectionIssueSchema = z.object({
  row_id: z.string(), version: z.number().int(), page: z.number().nullable(), source_row: z.number().nullable(),
  date: z.string().nullable(), time: z.string().nullable(), amount: z.string().nullable(),
  balance_after: z.string().nullable(), original_direction: z.string().nullable(), reviewed_direction: z.string().nullable(),
  fresh_direction: z.string().nullable(), draft_direction: z.string(), ledger_direction: z.string().nullable(),
  transaction_id: z.string().nullable(), state: z.string(), reasons: z.array(z.string()),
});
const statementDirectionRecheckSchema = z.object({
  parser_version: z.string(), checked_rows: z.number().int().nonnegative(),
  issues: z.array(statementDirectionIssueSchema),
});
export type StatementDirectionRecheck = z.infer<typeof statementDirectionRecheckSchema>;
export async function recheckStatementDirections(token: string, id: string, password = ""): Promise<StatementDirectionRecheck> {
  const response = await authenticatedFetch(`/api/statements/imports/${id}/recheck-directions/`, token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
  });
  return statementDirectionRecheckSchema.parse(await response.json());
}
export async function reviewStatementSourceDirection(token: string, id: string, version: number, direction: "debit" | "credit", alignDraft: boolean): Promise<{ version: number; reviewed_direction: string; draft_direction: string }> {
  const response = await authenticatedFetch(`/api/statements/rows/${id}/review-source-direction/`, token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, direction, confirmed_pdf: true, align_draft: alignDraft }),
  });
  return z.object({ version: z.number().int(), reviewed_direction: z.string(), draft_direction: z.string() }).parse(await response.json());
}
const statementIdentificationSchema = z.object({
  profile: z.string(), account_hint: z.string(),
  account_suggestion: z.object({ account: z.string().nullable(), name: z.string(), reason: z.string(), ambiguous: z.boolean(), requires_review: z.boolean().default(false), choices: z.array(z.object({ account: z.string(), name: z.string() })).default([]) }).nullable()
});
export type StatementIdentification = z.infer<typeof statementIdentificationSchema>;
export async function identifyStatementAccount(token: string, file: File, password: string, signal?: AbortSignal): Promise<StatementIdentification> {
  const body = new FormData(); body.set("file", file); if (password) body.set("password", password);
  return statementIdentificationSchema.parse(await (await authenticatedFetch("/api/statements/identify/", token, { method: "POST", body, signal })).json());
}
export async function listStatementImports(token: string, offset = 0, signal?: AbortSignal, filters: { start_date?: string; end_date?: string; date_field?: "updated_at" | "created_at" } = {}): Promise<StatementHistory> {
  const query = new URLSearchParams({ limit: "20", offset: String(offset) });
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return statementHistorySchema.parse(await (await authenticatedFetch(`/api/statements/imports/?${query}`, token, { signal })).json());
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

const statementCounterpartyCodeSchema = z.object({
  account: z.string(), account_name: z.string(), profile: z.enum(["city_bank", "bkash"]), code: z.string(), printed_code: z.string().nullable(), direction: z.enum(["debit", "credit"]),
  count: z.number(), pending_count: z.number(), last_seen: z.string().nullable(),
  examples: z.array(z.object({ date: z.string().nullable(), amount: z.string().nullable(), description: z.string() })),
  mapping: z.object({ id: z.string(), party_kind: z.enum(["owned", "external"]), label: z.string(), other_account: z.string().nullable(), suggested_type: z.string(), category: z.string().nullable(), note_template: z.string().default(""), updated_at: z.string() }).nullable()
});
export type StatementCounterpartyCode = z.infer<typeof statementCounterpartyCodeSchema>;
export type StatementCounterpartyCodeInput = { account: string; profile: "city_bank" | "bkash"; code: string; direction: "debit" | "credit"; party_kind: "owned" | "external"; label: string; other_account: string | null; suggested_type: string; category: string | null; note_template: string };
export async function listStatementCounterpartyCodes(token: string, signal?: AbortSignal): Promise<StatementCounterpartyCode[]> {
  const payload = await (await authenticatedFetch("/api/statements/counterparty-codes/", token, { signal })).json();
  return z.object({ count: z.number(), results: z.array(statementCounterpartyCodeSchema) }).parse(payload).results;
}
export async function saveStatementCounterpartyCode(token: string, input: StatementCounterpartyCodeInput) {
  return (await authenticatedFetch("/api/statements/counterparty-codes/", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json();
}
export async function forgetStatementCounterpartyCode(token: string, id: string) {
  await authenticatedFetch(`/api/statements/counterparty-codes/${id}/`, token, { method: "DELETE" });
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
export async function getStatementComparison(token: string, id: string, offset = 0, signal?: AbortSignal, filters: { start_date?: string; end_date?: string } = {}): Promise<StatementComparison> {
  const query = new URLSearchParams({ limit: "50", offset: String(offset) });
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return statementComparisonSchema.parse(await (await authenticatedFetch(`/api/statements/imports/${id}/comparison/?${query}`, token, { signal })).json());
}

export async function listQuickPresets(accessToken: string): Promise<QuickPreset[]> {
  const response = await authenticatedFetch("/api/quick-add/presets/", accessToken);
  return await response.json() as QuickPreset[];
}
export async function saveQuickPreset(accessToken: string, input: PresetInput | Partial<PresetInput>, id?: string): Promise<QuickPreset> {
  const response = await authenticatedFetch(`/api/quick-add/presets/${id ? `${id}/` : ""}`, accessToken, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return await response.json() as QuickPreset;
}
export async function postQuickEntry(accessToken: string, input: QuickEntryInput): Promise<{ transaction: string; replayed: boolean; undo_action?: TransactionAction | null }> {
  const response = await authenticatedFetch("/api/quick-add/entries/", accessToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return z.object({ transaction: z.string(), replayed: z.boolean(), undo_action: transactionActionSchema.nullable().optional() }).parse(await response.json());
}

export async function reorderQuickPresets(accessToken: string, ids: string[]): Promise<QuickPreset[]> {
  const response = await authenticatedFetch("/api/quick-add/presets/reorder/", accessToken, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
  return await response.json() as QuickPreset[];
}


export async function recentTransactionAction(token: string, signal?: AbortSignal): Promise<TransactionAction | null> {
  const response = await authenticatedFetch("/api/transactions/recent-action/", token, { signal });
  return transactionActionSchema.nullable().parse(await response.json());
}
export async function undoTransactionAction(token: string, action: string): Promise<TransactionAction> {
  const response = await authenticatedFetch("/api/transactions/undo/", token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action })
  });
  return transactionActionSchema.parse(await response.json());
}
export async function getTransaction(token: string, id: string, signal?: AbortSignal): Promise<Transaction> {
  const response = await authenticatedFetch(`/api/transactions/${id}/`, token, { signal });
  return transactionSchema.parse(await response.json());
}

const pendingSourceSchema = z.object({
  source: z.enum(["sms", "statement"]), id: z.string(), account: z.string().nullable(), account_name: z.string(), currency: z.string(),
  date: z.string().nullable(), value_date: z.string().nullable().default(null), time: z.string().nullable(), amount: z.string().nullable(), balance_after: z.string().nullable(), direction: z.enum(["debit", "credit"]),
  type: z.string(), description: z.string(), reference: z.string(), updated_at: z.string(), version: z.number().nullable(), batch: z.string().nullable(), needs_correction: z.boolean()
});
const pendingSignalsSchema = z.object({ strength: z.enum(["strong", "possible"]), conflict: z.boolean(), late_posting: z.boolean().default(false), reasons: z.array(z.string()) });
const smsStatementMatchesSchema = z.object({
  unavailable: z.boolean(),
  matches: z.array(z.object({ statement: pendingSourceSchema, signals: pendingSignalsSchema, unique: z.boolean() }))
});
export type SmsStatementMatch = z.infer<typeof smsStatementMatchesSchema>["matches"][number];
export async function findSmsStatementMatches(token: string, id: string, input: ConfirmMessageCandidateInput) {
  const response = await authenticatedFetch(`/api/messages/review/${id}/statement-matches/`, token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  });
  return smsStatementMatchesSchema.parse(await response.json());
}
const pendingPairSchema = z.object({ id: z.string(), statement: pendingSourceSchema, sms: pendingSourceSchema, match: pendingSignalsSchema, needs_correction: z.boolean(), needs_decision: z.boolean().default(false) });
const unifiedPendingSchema = z.object({
  count: z.number(), offset: z.number(), limit: z.number(), next_cursor: z.string().nullable(),
  overview: z.object({ matched: z.number(), ambiguous: z.number(), statement_only: z.number(), sms_only: z.number() }),
  results: z.array(pendingPairSchema)
});
const competingSourceSchema = z.object({ source: pendingSourceSchema, source_text: z.string(), token: z.string() });
const unifiedPairSchema = z.object({ row: savedStatementRowSchema, batch: savedStatementSchema, sms: parsedMessageCandidateSchema, sms_summary: pendingSourceSchema, match: pendingSignalsSchema, competing_sources: z.array(competingSourceSchema).default([]), sms_account_changed: z.boolean().default(false), ledger_matches: z.array(statementMatchSchema).optional(), ledger_matching_truncated: z.boolean().optional() });
export type UnifiedPendingPair = z.infer<typeof pendingPairSchema>;
export type UnifiedPendingPage = z.infer<typeof unifiedPendingSchema>;
export type UnifiedPair = z.infer<typeof unifiedPairSchema>;
export type UnifiedPairDecision = { statement: string; sms: string; statement_version: number; sms_updated_at: string; sms_account?: string; acknowledge_sms_account_override?: boolean; transaction?: string | null; balance_source: "sms" | "statement" | "existing"; type_choice?: "statement" | "sms" | "custom"; draft?: StatementRowEdit; acknowledge_match: boolean; acknowledge_conflict: boolean; acknowledge_issues: boolean; acknowledge_competing_sources?: boolean; competing_source_tokens?: string[]; remember_choices: boolean; dismissed_ledger_matches?: string[]; acknowledge_distinct_ledger_matches?: boolean };
export async function listUnifiedPending(token: string, filters: Record<string, string>, signal?: AbortSignal): Promise<UnifiedPendingPage> {
  const query = new URLSearchParams(filters);
  return unifiedPendingSchema.parse(await (await authenticatedFetch(`/api/review/pending/?${query}`, token, { signal })).json());
}
export async function getUnifiedPair(token: string, statement: string, sms: string, signal?: AbortSignal): Promise<UnifiedPair> {
  const query = new URLSearchParams({ statement, sms });
  return unifiedPairSchema.parse(await (await authenticatedFetch(`/api/review/pair/?${query}`, token, { signal })).json());
}
export async function previewUnifiedPair(token: string, statement: string, sms: string, smsAccount?: string, draft?: StatementRowEdit): Promise<UnifiedPair> {
  const response = await authenticatedFetch("/api/review/pair/preview/", token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statement, sms, ...(smsAccount ? { sms_account: smsAccount } : {}), ...(draft ? { draft } : {}) }),
  });
  return unifiedPairSchema.parse(await response.json());
}
export async function confirmUnifiedPair(token: string, input: UnifiedPairDecision) {
  return z.object({ transaction: z.string(), statement: z.string(), sms: z.string(), unchanged: z.boolean() }).parse(await (await authenticatedFetch("/api/review/pair/", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).json());
}
