declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
  };
};

export type HealthResponse = {
  status: "ok";
};

export type AuthTokens = {
  access: string;
  refresh: string;
};

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

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

export type PaymentMethod = {
  account: string;
  id: string;
  identifier: string;
  name: string;
  provider: string;
};

export type SenderRule = {
  account: string;
  id: string;
  match_type: string;
  name: string;
  payment_method: string | null;
  priority: number;
  provider: string;
  sender: string;
};

export type RawMessageImportInput = {
  body: string;
  device_message_id?: string;
  received_at: string;
  sender: string;
};

export type RawMessageImportResult = {
  candidate?: ParsedMessageCandidate | null;
  is_duplicate: boolean;
  message: {
    id: string;
    sender: string;
    status: string;
  };
};

export type RawMessage = {
  body: string;
  body_hash: string;
  created_at: string;
  device_message_id: string;
  duplicate_of: string | null;
  id: string;
  redacted_at: string | null;
  received_at: string;
  sender: string;
  status: string;
};

export type ParsedMessageCandidate = {
  account: string | null;
  amount: string | null;
  balance_after: string | null;
  confidence: string;
  counterparty_text: string;
  created_at: string;
  destination_account: string | null;
  destination_payment_method: string | null;
  fee_amount: string | null;
  id: string;
  message_kind: string;
  parser_name: string;
  parser_notes: string;
  payment_method: string | null;
  possible_internal_transfer: boolean;
  possible_related_candidate: string | null;
  provider: string;
  raw_message: RawMessage;
  reference: string;
  related_match_reason: string;
  sender_rule: string | null;
  status: string;
  transaction: string | null;
  transaction_type: string;
  updated_at: string;
};

export type ConfirmMessageCandidateInput = {
  account?: string;
  amount?: string;
  balance_after?: string | null;
  counterparty_text?: string;
  date?: string;
  direction?: string;
  note?: string;
  payment_method?: string | null;
  reference?: string;
  transfer_account?: string | null;
  type?: string;
};

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
  transfer_account?: string | null;
  type: string;
};

export type Transaction = {
  account: string;
  amount: string;
  balance_after: string | null;
  category: string | null;
  counterparty_text: string;
  created_at: string;
  date: string;
  direction: string;
  external_key: string;
  id: string;
  needs_review: boolean;
  note: string;
  payment_method: string | null;
  raw_message: string | null;
  reference: string;
  source: string;
  transfer_account: string | null;
  type: string;
  updated_at: string;
};

export type Debt = {
  counterparty_name: string;
  created_at: string;
  current_balance: string;
  direction: string;
  due_date: string | null;
  id: string;
  note: string;
  opened_at: string;
  opened_transaction: string | null;
  principal_amount: string;
  status: string;
  updated_at: string;
};

export type CreateDebtInput = {
  counterparty_name: string;
  direction: string;
  due_date?: string | null;
  note?: string;
  opened_at: string;
  principal_amount: string;
};

export type CreateDebtPaymentInput = {
  amount: string;
  note?: string;
  paid_at: string;
  transaction?: string | null;
};

export type CreditCardBill = {
  account: string;
  created_at: string;
  due_date: string;
  id: string;
  minimum_due: string;
  note: string;
  paid_amount: string;
  reference: string;
  remaining_balance: string;
  statement_balance: string;
  statement_date: string;
  statement_transaction: string | null;
  status: string;
  updated_at: string;
};

export type CreateCreditCardBillInput = {
  account: string;
  due_date: string;
  minimum_due?: string;
  note?: string;
  reference?: string;
  statement_balance: string;
  statement_date: string;
};

export type CreateCreditCardPaymentInput = {
  amount: string;
  note?: string;
  paid_at: string;
  transaction?: string | null;
};

export type RecurringBill = {
  account: string;
  amount: string;
  auto_create_transaction: boolean;
  category: string | null;
  created_at: string;
  frequency: string;
  id: string;
  name: string;
  next_due_date: string;
  note: string;
  reminder_days_before: number;
  status: string;
  updated_at: string;
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
};

export type CreateRecurringBillPaymentInput = {
  amount: string;
  note?: string;
  paid_at: string;
  transaction?: string | null;
};

export type BalanceSnapshot = {
  account: string;
  actual_balance: string;
  adjustment_transaction: string | null;
  checked_at: string;
  created_at: string;
  difference: string;
  expected_balance: string;
  id: string;
  note: string;
  status: string;
  updated_at: string;
};

export type AccountReconciliation = {
  account: string;
  account_name: string;
  expected_balance: string;
  latest_snapshot: BalanceSnapshot | null;
};

export type CreateBalanceSnapshotInput = {
  account: string;
  actual_balance: string;
  checked_at?: string;
  note?: string;
};

export type HealthResult = {
  error?: string;
  ok: boolean;
  status?: string;
};

export function getApiBaseUrl() {
  return (process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:8000").replace(/\/+$/, "");
}

export async function checkHealth(): Promise<HealthResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/health/`, {
      signal: controller.signal
    });
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
      error: error instanceof Error && error.name === "AbortError"
        ? "Server did not respond within 15 seconds."
        : error instanceof Error
          ? error.message
          : "Unknown network error",
      ok: false
    };
  } finally {
    clearTimeout(timeoutId);
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

export async function refreshLogin(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/refresh/`, {
    body: JSON.stringify({ refresh: refreshToken }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationError("Your saved session has expired.");
    }
    throw new Error(`Could not refresh the session (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as AuthTokens;
  if (!payload.access || !payload.refresh) {
    throw new Error("Refresh response is invalid.");
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
    if (response.status === 401) {
      throw new AuthenticationError("Token is invalid or expired.");
    }
    throw new Error("Could not load user.");
  }

  return (await response.json()) as CurrentUser;
}

async function authenticatedFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
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
  return (await response.json()) as Account[];
}

export async function listCategories(accessToken: string): Promise<Category[]> {
  const response = await authenticatedFetch("/api/categories/", accessToken);
  return (await response.json()) as Category[];
}

export async function listPaymentMethods(accessToken: string): Promise<PaymentMethod[]> {
  const response = await authenticatedFetch("/api/payment-methods/", accessToken);
  return (await response.json()) as PaymentMethod[];
}

export async function listSenderRules(accessToken: string): Promise<SenderRule[]> {
  const response = await authenticatedFetch("/api/messages/sender-rules/", accessToken);
  return (await response.json()) as SenderRule[];
}

export async function listMessageCandidates(accessToken: string): Promise<ParsedMessageCandidate[]> {
  const response = await authenticatedFetch("/api/messages/review/", accessToken);
  return (await response.json()) as ParsedMessageCandidate[];
}

export async function listDebts(accessToken: string): Promise<Debt[]> {
  const response = await authenticatedFetch("/api/debts/", accessToken);
  return (await response.json()) as Debt[];
}

export async function createDebt(accessToken: string, input: CreateDebtInput): Promise<Debt> {
  const response = await authenticatedFetch("/api/debts/", accessToken, {
    body: JSON.stringify({
      counterparty_name: input.counterparty_name,
      direction: input.direction,
      due_date: input.due_date || null,
      note: input.note || "",
      opened_at: input.opened_at,
      principal_amount: input.principal_amount
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await response.json()) as Debt;
}

export async function createDebtPayment(
  accessToken: string,
  debtId: string,
  input: CreateDebtPaymentInput
): Promise<void> {
  await authenticatedFetch(`/api/debts/${debtId}/payments/`, accessToken, {
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
}

export async function listCreditCardBills(accessToken: string): Promise<CreditCardBill[]> {
  const response = await authenticatedFetch("/api/credit-card-bills/", accessToken);
  return (await response.json()) as CreditCardBill[];
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
      statement_date: input.statement_date
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await response.json()) as CreditCardBill;
}

export async function createCreditCardPayment(
  accessToken: string,
  billId: string,
  input: CreateCreditCardPaymentInput
): Promise<void> {
  await authenticatedFetch(`/api/credit-card-bills/${billId}/payments/`, accessToken, {
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
}

export async function listRecurringBills(accessToken: string): Promise<RecurringBill[]> {
  const response = await authenticatedFetch("/api/recurring-bills/", accessToken);
  return (await response.json()) as RecurringBill[];
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
      reminder_days_before: input.reminder_days_before ?? 3
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  return (await response.json()) as RecurringBill;
}

export async function createRecurringBillPayment(
  accessToken: string,
  billId: string,
  input: CreateRecurringBillPaymentInput
): Promise<void> {
  await authenticatedFetch(`/api/recurring-bills/${billId}/payments/`, accessToken, {
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
  return (await response.json()) as BalanceSnapshot;
}

export async function getAccountReconciliation(
  accessToken: string,
  accountId: string
): Promise<AccountReconciliation> {
  const response = await authenticatedFetch(`/api/reconciliation/accounts/${accountId}/`, accessToken);
  return (await response.json()) as AccountReconciliation;
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
  return (await response.json()) as ParsedMessageCandidate;
}

export async function ignoreMessageCandidate(
  accessToken: string,
  id: string
): Promise<ParsedMessageCandidate> {
  const response = await authenticatedFetch(`/api/messages/review/${id}/ignore/`, accessToken, {
    method: "POST"
  });
  return (await response.json()) as ParsedMessageCandidate;
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

export async function importRawMessage(
  accessToken: string,
  input: RawMessageImportInput
): Promise<RawMessageImportResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/messages/import/`, {
    body: JSON.stringify({
      body: input.body,
      device_message_id: input.device_message_id || "",
      received_at: input.received_at,
      sender: input.sender
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
    throw new Error(`Raw message import failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as RawMessageImportResult;
}

export async function listTransactions(accessToken: string): Promise<Transaction[]> {
  const response = await authenticatedFetch("/api/transactions/", accessToken);
  return (await response.json()) as Transaction[];
}
