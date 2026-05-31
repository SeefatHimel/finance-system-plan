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
  id: z.string(),
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
  related_match_reason: z.string(),
  sender_rule: z.string().nullable(),
  status: z.string(),
  transaction: z.string().nullable(),
  transaction_type: z.string(),
  updated_at: z.string()
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
  direction?: string;
  external_key?: string;
  note?: string;
  payment_method?: string | null;
  raw_message?: string | null;
  reference?: string;
  source?: "web";
  transfer_account?: string;
  type: string;
};

export type TransactionFilters = {
  account?: string;
  category?: string;
  direction?: string;
  month?: string;
  search?: string;
  type?: string;
};

export type CreateAccountInput = {
  currency?: "BDT";
  name: string;
  starting_balance?: string;
  type: string;
};

export type CreateCategoryInput = {
  kind: string;
  name: string;
};

export type UpdateAccountInput = {
  name?: string;
  type?: string;
};

export type UpdateCategoryInput = {
  kind?: string;
  name?: string;
};

export type CreatePaymentMethodInput = {
  account: string;
  identifier?: string;
  name: string;
  provider: string;
};

export type UpdatePaymentMethodInput = {
  account?: string;
  identifier?: string;
  name?: string;
  provider?: string;
};

export type CreateSenderRuleInput = {
  account: string;
  match_type?: string;
  name: string;
  payment_method?: string | null;
  pattern?: string;
  priority?: number;
  provider: string;
  sender: string;
};

export type UpdateSenderRuleInput = {
  account?: string;
  match_type?: string;
  name?: string;
  payment_method?: string | null;
  pattern?: string;
  priority?: number;
  provider?: string;
  sender?: string;
};

export type ConfirmMessageCandidateInput = {
  account?: string;
  amount?: string;
  balance_after?: string | null;
  category?: string | null;
  counterparty_text?: string;
  date?: string;
  direction?: string;
  note?: string;
  payment_method?: string | null;
  reference?: string;
  transfer_account?: string | null;
  type?: string;
};

export type UpdateTransactionInput = {
  account?: string;
  amount?: string;
  balance_after?: string | null;
  category?: string | null;
  counterparty_text?: string;
  date?: string;
  direction?: string;
  external_key?: string;
  note?: string;
  payment_method?: string | null;
  raw_message?: string | null;
  reference?: string;
  transfer_account?: string | null;
  type?: string;
};

export type CreateDebtInput = {
  counterparty_name: string;
  direction: string;
  due_date?: string | null;
  note?: string;
  opened_at: string;
  opened_transaction?: string | null;
  principal_amount: string;
};

export type CreateDebtPaymentInput = {
  amount: string;
  note?: string;
  paid_at: string;
  transaction?: string | null;
};

export type CreditCardBillFilters = {
  account?: string;
  status?: string;
};

export type CreateCreditCardBillInput = {
  account: string;
  due_date: string;
  minimum_due?: string;
  note?: string;
  reference?: string;
  statement_balance: string;
  statement_date: string;
  statement_transaction?: string | null;
};

export type CreateCreditCardPaymentInput = {
  amount: string;
  note?: string;
  paid_at: string;
  transaction?: string | null;
};

export type RecurringBillFilters = {
  account?: string;
  due?: string;
  status?: string;
};

export type CreateRecurringBillInput = {
  account: string;
  amount: string;
  auto_create_transaction?: boolean;
  category?: string | null;
  frequency: string;
  name: string;
  next_due_date: string;
  note?: string;
  reminder_days_before?: number;
  status?: string;
};

export type CreateRecurringBillPaymentInput = {
  amount: string;
  note?: string;
  paid_at: string;
  transaction?: string | null;
};

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
  if (typeof window === "undefined") {
    return process.env.NEXT_SERVER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  }
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
