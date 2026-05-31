import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import {
  checkHealth,
  confirmMessageCandidate,
  createBalanceSnapshot,
  createCreditCardBill,
  createCreditCardPayment,
  createDebt,
  createDebtPayment,
  createRecurringBill,
  createRecurringBillPayment,
  createTransaction,
  getApiBaseUrl,
  getAccountReconciliation,
  getCurrentUser,
  ignoreMessageCandidate,
  importRawMessage,
  listAccounts,
  listCategories,
  listCreditCardBills,
  listDebts,
  listMessageCandidates,
  listPaymentMethods,
  listRecurringBills,
  listSenderRules,
  listTransactions,
  login,
  type Account,
  type AccountReconciliation,
  type Category,
  type CreateTransactionInput,
  type CreditCardBill,
  type Debt,
  type HealthResult,
  type ParsedMessageCandidate,
  type PaymentMethod,
  type RecurringBill,
  type SenderRule,
  type Transaction
} from "./src/api";

type ViewState = "idle" | "loading" | "success" | "error";
type SmsPermissionState = "unknown" | "checking" | "granted" | "denied";
type ReviewCandidateDraft = {
  accountId: string;
  transferAccountId: string;
  transactionType: string;
};
type QueuedRawMessage = {
  attempts: number;
  body: string;
  createdAt: string;
  deviceMessageId: string;
  id: string;
  lastAttemptAt: string;
  lastError: string;
  nextRetryAt: string;
  receivedAt: string;
  sender: string;
};
type QueuedManualTransaction = {
  attempts: number;
  createdAt: string;
  id: string;
  input: CreateTransactionInput;
  lastAttemptAt: string;
  lastError: string;
  nextRetryAt: string;
};

const rawMessageQueueKey = "finance.rawMessageQueue";
const manualTransactionQueueKey = "finance.manualTransactionQueue";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rawMessageDedupeKey(input: Pick<QueuedRawMessage, "body" | "deviceMessageId" | "receivedAt" | "sender">) {
  const sender = input.sender.trim().toLowerCase();
  const receivedAt = input.receivedAt.trim();
  const deviceMessageId = input.deviceMessageId.trim();
  const body = input.body.trim();

  return deviceMessageId
    ? `device:${sender}:${deviceMessageId}`
    : `body:${sender}:${receivedAt}:${body}`;
}

function queueRetryDelayMs(attempts: number) {
  const retryNumber = Math.max(attempts, 1);
  const delaySeconds = Math.min(60 * 2 ** (retryNumber - 1), 60 * 60);
  return delaySeconds * 1000;
}

function nextQueueRetryAt(attempts: number) {
  return new Date(Date.now() + queueRetryDelayMs(attempts)).toISOString();
}

function isRawMessageRetryDue(queuedMessage: QueuedRawMessage, nowMs = Date.now()) {
  if (!queuedMessage.nextRetryAt) {
    return true;
  }
  const retryAtMs = new Date(queuedMessage.nextRetryAt).getTime();
  return Number.isNaN(retryAtMs) || retryAtMs <= nowMs;
}

function manualTransactionDedupeKey(input: CreateTransactionInput) {
  return [
    input.account.trim(),
    input.category?.trim() ?? "",
    input.date.trim(),
    input.type.trim(),
    input.amount.trim(),
    input.note?.trim() ?? ""
  ].join(":");
}

function normalizeManualTransactionQueue(storedQueue: string | null): QueuedManualTransaction[] {
  if (!storedQueue) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedQueue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const nextQueue: QueuedManualTransaction[] = [];
    const seenKeys = new Set<string>();

    for (const item of parsed) {
      if (!isRecord(item) || !isRecord(item.input)) {
        continue;
      }

      const input: CreateTransactionInput = {
        account: stringValue(item.input.account),
        amount: stringValue(item.input.amount),
        category: stringValue(item.input.category) || undefined,
        date: stringValue(item.input.date),
        note: stringValue(item.input.note),
        type: stringValue(item.input.type)
      };

      if (!input.account || !input.amount || !input.date || !input.type) {
        continue;
      }

      const dedupeKey = manualTransactionDedupeKey(input);
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);

      nextQueue.push({
        attempts: numberValue(item.attempts),
        createdAt: stringValue(item.createdAt) || new Date().toISOString(),
        id: stringValue(item.id) || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        input,
        lastAttemptAt: stringValue(item.lastAttemptAt),
        lastError: stringValue(item.lastError),
        nextRetryAt: stringValue(item.nextRetryAt)
      });
    }

    return nextQueue;
  } catch {
    return [];
  }
}

function isManualTransactionRetryDue(queuedTransaction: QueuedManualTransaction, nowMs = Date.now()) {
  if (!queuedTransaction.nextRetryAt) {
    return true;
  }
  const retryAtMs = new Date(queuedTransaction.nextRetryAt).getTime();
  return Number.isNaN(retryAtMs) || retryAtMs <= nowMs;
}

function normalizeRawQueue(storedQueue: string | null): QueuedRawMessage[] {
  if (!storedQueue) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedQueue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const nextQueue: QueuedRawMessage[] = [];
    const seenKeys = new Set<string>();

    for (const item of parsed) {
      if (!isRecord(item)) {
        continue;
      }

      const queuedMessage: QueuedRawMessage = {
        attempts: numberValue(item.attempts),
        body: stringValue(item.body),
        createdAt: stringValue(item.createdAt) || stringValue(item.receivedAt) || new Date().toISOString(),
        deviceMessageId: stringValue(item.deviceMessageId),
        id: stringValue(item.id) || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        lastAttemptAt: stringValue(item.lastAttemptAt),
        lastError: stringValue(item.lastError),
        nextRetryAt: stringValue(item.nextRetryAt),
        receivedAt: stringValue(item.receivedAt),
        sender: stringValue(item.sender)
      };

      if (!queuedMessage.sender || !queuedMessage.body || !queuedMessage.receivedAt) {
        continue;
      }

      const dedupeKey = rawMessageDedupeKey(queuedMessage);
      if (seenKeys.has(dedupeKey)) {
        continue;
      }
      seenKeys.add(dedupeKey);
      nextQueue.push(queuedMessage);
    }

    return nextQueue;
  } catch {
    return [];
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function confidencePercent(value: string) {
  const score = Number(value);
  if (Number.isNaN(score)) {
    return "unknown";
  }
  return `${Math.round(score * 100)}%`;
}

function confidenceLabel(value: string) {
  const score = Number(value);
  if (Number.isNaN(score)) {
    return "Unknown confidence";
  }
  if (score >= 0.85) {
    return "High confidence";
  }
  if (score >= 0.65) {
    return "Medium confidence";
  }
  return "Low confidence";
}

function candidateReviewReason(candidate: ParsedMessageCandidate) {
  if (candidate.raw_message.duplicate_of) {
    return `Duplicate raw message of ${candidate.raw_message.duplicate_of}.`;
  }
  if (candidate.related_match_reason) {
    return candidate.related_match_reason;
  }
  if (candidate.possible_internal_transfer) {
    return "Possible internal transfer; verify both accounts before confirming.";
  }
  if (!candidate.account || !candidate.amount) {
    return "Missing account or amount; complete required fields before confirming.";
  }
  if (Number(candidate.confidence) < 0.65) {
    return "Low parser confidence; compare against the raw SMS before confirming.";
  }
  return "Parser matched known fields; verify the ledger details before confirming.";
}

export default function App() {
  const [result, setResult] = useState<HealthResult | null>(null);
  const [state, setState] = useState<ViewState>("idle");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [authState, setAuthState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [authMessage, setAuthMessage] = useState("");
  const [dataState, setDataState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [dataMessage, setDataMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txAccountId, setTxAccountId] = useState("");
  const [txCategoryId, setTxCategoryId] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txType, setTxType] = useState("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txState, setTxState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [txMessage, setTxMessage] = useState("");
  const [transactionQueue, setTransactionQueue] = useState<QueuedManualTransaction[]>([]);
  const [transactionQueueState, setTransactionQueueState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [transactionQueueMessage, setTransactionQueueMessage] = useState("");
  const [listState, setListState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [listMessage, setListMessage] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [debtState, setDebtState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [debtMessage, setDebtMessage] = useState("");
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtCounterparty, setDebtCounterparty] = useState("");
  const [debtDirection, setDebtDirection] = useState("lent_by_me");
  const [debtPrincipal, setDebtPrincipal] = useState("");
  const [debtOpenedAt, setDebtOpenedAt] = useState(today());
  const [debtDueDate, setDebtDueDate] = useState("");
  const [debtNote, setDebtNote] = useState("");
  const [debtPaymentId, setDebtPaymentId] = useState("");
  const [debtPaymentAmount, setDebtPaymentAmount] = useState("");
  const [debtPaymentDate, setDebtPaymentDate] = useState(today());
  const [debtPaymentNote, setDebtPaymentNote] = useState("");
  const [cardBillState, setCardBillState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [cardBillMessage, setCardBillMessage] = useState("");
  const [cardBills, setCardBills] = useState<CreditCardBill[]>([]);
  const [cardAccountId, setCardAccountId] = useState("");
  const [cardStatementBalance, setCardStatementBalance] = useState("");
  const [cardMinimumDue, setCardMinimumDue] = useState("");
  const [cardStatementDate, setCardStatementDate] = useState(today());
  const [cardDueDate, setCardDueDate] = useState("");
  const [cardReference, setCardReference] = useState("");
  const [cardNote, setCardNote] = useState("");
  const [cardPaymentBillId, setCardPaymentBillId] = useState("");
  const [cardPaymentAmount, setCardPaymentAmount] = useState("");
  const [cardPaymentDate, setCardPaymentDate] = useState(today());
  const [cardPaymentNote, setCardPaymentNote] = useState("");
  const [recurringState, setRecurringState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [recurringMessage, setRecurringMessage] = useState("");
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [recurringName, setRecurringName] = useState("");
  const [recurringAccountId, setRecurringAccountId] = useState("");
  const [recurringCategoryId, setRecurringCategoryId] = useState("");
  const [recurringAmount, setRecurringAmount] = useState("");
  const [recurringFrequency, setRecurringFrequency] = useState("monthly");
  const [recurringNextDueDate, setRecurringNextDueDate] = useState(today());
  const [recurringReminderDays, setRecurringReminderDays] = useState("3");
  const [recurringNote, setRecurringNote] = useState("");
  const [recurringPaymentBillId, setRecurringPaymentBillId] = useState("");
  const [recurringPaymentAmount, setRecurringPaymentAmount] = useState("");
  const [recurringPaymentDate, setRecurringPaymentDate] = useState(today());
  const [recurringPaymentNote, setRecurringPaymentNote] = useState("");
  const [reconciliationState, setReconciliationState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [reconciliationMessage, setReconciliationMessage] = useState("");
  const [reconciliationAccountId, setReconciliationAccountId] = useState("");
  const [reconciliation, setReconciliation] = useState<AccountReconciliation | null>(null);
  const [snapshotActualBalance, setSnapshotActualBalance] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");
  const [smsPermissionState, setSmsPermissionState] = useState<SmsPermissionState>("unknown");
  const [smsPermissionMessage, setSmsPermissionMessage] = useState(
    "Native SMS permission is not wired in this Expo scaffold yet."
  );
  const [smsSettingsState, setSmsSettingsState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [smsSettingsMessage, setSmsSettingsMessage] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [senderRules, setSenderRules] = useState<SenderRule[]>([]);
  const [enabledSenderRuleIds, setEnabledSenderRuleIds] = useState<string[]>([]);
  const [rawSender, setRawSender] = useState("");
  const [rawBody, setRawBody] = useState("");
  const [rawReceivedAt, setRawReceivedAt] = useState(new Date().toISOString());
  const [rawDeviceMessageId, setRawDeviceMessageId] = useState("");
  const [rawQueue, setRawQueue] = useState<QueuedRawMessage[]>([]);
  const [rawQueueState, setRawQueueState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [rawQueueMessage, setRawQueueMessage] = useState("");
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewCandidates, setReviewCandidates] = useState<ParsedMessageCandidate[]>([]);
  const [reviewActionCandidateId, setReviewActionCandidateId] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewCandidateDraft>>({});

  const loadHealth = async () => {
    setState("loading");
    const nextResult = await checkHealth();
    setResult(nextResult);
    setState(nextResult.ok ? "success" : "error");
  };

  const handleLoadTransactions = async () => {
    if (!accessToken.trim()) {
      setListState("error");
      setListMessage("Sign in first or paste a valid access token.");
      return;
    }

    setListState("loading");
    setListMessage("");
    try {
      const payload = await listTransactions(accessToken.trim());
      setTransactions(payload);
      setListState("ok");
      setListMessage(`Loaded ${payload.length} transaction(s).`);
    } catch (error) {
      setListState("error");
      setListMessage(error instanceof Error ? error.message : "Could not load transactions.");
    }
  };

  const handleLoadDebts = async () => {
    if (!accessToken.trim()) {
      setDebtState("error");
      setDebtMessage("Sign in first or paste a valid access token.");
      return;
    }

    setDebtState("loading");
    setDebtMessage("");
    try {
      const payload = await listDebts(accessToken.trim());
      setDebts(payload);
      setDebtState("ok");
      setDebtMessage(`Loaded ${payload.length} debt record(s).`);
    } catch (error) {
      setDebtState("error");
      setDebtMessage(error instanceof Error ? error.message : "Could not load debts.");
    }
  };

  const handleCreateDebt = async () => {
    if (!accessToken.trim()) {
      setDebtState("error");
      setDebtMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!debtCounterparty.trim() || !debtPrincipal.trim() || !debtOpenedAt.trim()) {
      setDebtState("error");
      setDebtMessage("Counterparty, principal, and opened date are required.");
      return;
    }

    setDebtState("loading");
    setDebtMessage("");
    try {
      await createDebt(accessToken.trim(), {
        counterparty_name: debtCounterparty.trim(),
        direction: debtDirection,
        due_date: debtDueDate.trim() || null,
        note: debtNote.trim(),
        opened_at: debtOpenedAt.trim(),
        principal_amount: debtPrincipal.trim()
      });
      setDebtCounterparty("");
      setDebtPrincipal("");
      setDebtDueDate("");
      setDebtNote("");
      await handleLoadDebts();
    } catch (error) {
      setDebtState("error");
      setDebtMessage(error instanceof Error ? error.message : "Could not create debt record.");
    }
  };

  const handleCreateDebtPayment = async () => {
    if (!accessToken.trim()) {
      setDebtState("error");
      setDebtMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!debtPaymentId || !debtPaymentAmount.trim() || !debtPaymentDate.trim()) {
      setDebtState("error");
      setDebtMessage("Debt, amount, and paid date are required.");
      return;
    }

    setDebtState("loading");
    setDebtMessage("");
    try {
      await createDebtPayment(accessToken.trim(), debtPaymentId, {
        amount: debtPaymentAmount.trim(),
        note: debtPaymentNote.trim(),
        paid_at: debtPaymentDate.trim()
      });
      setDebtPaymentAmount("");
      setDebtPaymentNote("");
      await handleLoadDebts();
    } catch (error) {
      setDebtState("error");
      setDebtMessage(error instanceof Error ? error.message : "Could not record repayment.");
    }
  };

  const handleLoadCreditCardBills = async () => {
    if (!accessToken.trim()) {
      setCardBillState("error");
      setCardBillMessage("Sign in first or paste a valid access token.");
      return;
    }

    setCardBillState("loading");
    setCardBillMessage("");
    try {
      const [nextBills, nextAccounts] = await Promise.all([
        listCreditCardBills(accessToken.trim()),
        accounts.length ? Promise.resolve(accounts) : listAccounts(accessToken.trim())
      ]);
      setCardBills(nextBills);
      if (!accounts.length) {
        setAccounts(nextAccounts);
      }
      const firstCard = nextAccounts.find((account) => account.type === "credit_card");
      if (!cardAccountId && firstCard) {
        setCardAccountId(firstCard.id);
      }
      setCardBillState("ok");
      setCardBillMessage(`Loaded ${nextBills.length} credit card bill(s).`);
    } catch (error) {
      setCardBillState("error");
      setCardBillMessage(error instanceof Error ? error.message : "Could not load credit card bills.");
    }
  };

  const handleCreateCreditCardBill = async () => {
    if (!accessToken.trim()) {
      setCardBillState("error");
      setCardBillMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!cardAccountId || !cardStatementBalance.trim() || !cardStatementDate.trim() || !cardDueDate.trim()) {
      setCardBillState("error");
      setCardBillMessage("Card account, statement balance, statement date, and due date are required.");
      return;
    }

    setCardBillState("loading");
    setCardBillMessage("");
    try {
      await createCreditCardBill(accessToken.trim(), {
        account: cardAccountId,
        due_date: cardDueDate.trim(),
        minimum_due: cardMinimumDue.trim() || "0.00",
        note: cardNote.trim(),
        reference: cardReference.trim(),
        statement_balance: cardStatementBalance.trim(),
        statement_date: cardStatementDate.trim()
      });
      setCardStatementBalance("");
      setCardMinimumDue("");
      setCardDueDate("");
      setCardReference("");
      setCardNote("");
      await handleLoadCreditCardBills();
    } catch (error) {
      setCardBillState("error");
      setCardBillMessage(error instanceof Error ? error.message : "Could not create credit card bill.");
    }
  };

  const handleCreateCreditCardPayment = async () => {
    if (!accessToken.trim()) {
      setCardBillState("error");
      setCardBillMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!cardPaymentBillId || !cardPaymentAmount.trim() || !cardPaymentDate.trim()) {
      setCardBillState("error");
      setCardBillMessage("Bill, amount, and paid date are required.");
      return;
    }

    setCardBillState("loading");
    setCardBillMessage("");
    try {
      await createCreditCardPayment(accessToken.trim(), cardPaymentBillId, {
        amount: cardPaymentAmount.trim(),
        note: cardPaymentNote.trim(),
        paid_at: cardPaymentDate.trim()
      });
      setCardPaymentAmount("");
      setCardPaymentNote("");
      await handleLoadCreditCardBills();
    } catch (error) {
      setCardBillState("error");
      setCardBillMessage(error instanceof Error ? error.message : "Could not record card payment.");
    }
  };

  const handleLoadRecurringBills = async () => {
    if (!accessToken.trim()) {
      setRecurringState("error");
      setRecurringMessage("Sign in first or paste a valid access token.");
      return;
    }

    setRecurringState("loading");
    setRecurringMessage("");
    try {
      const [nextBills, nextAccounts, nextCategories] = await Promise.all([
        listRecurringBills(accessToken.trim()),
        accounts.length ? Promise.resolve(accounts) : listAccounts(accessToken.trim()),
        categories.length ? Promise.resolve(categories) : listCategories(accessToken.trim())
      ]);
      setRecurringBills(nextBills);
      if (!accounts.length) {
        setAccounts(nextAccounts);
      }
      if (!categories.length) {
        setCategories(nextCategories);
      }
      if (!recurringAccountId && nextAccounts[0]) {
        setRecurringAccountId(nextAccounts[0].id);
      }
      setRecurringState("ok");
      setRecurringMessage(`Loaded ${nextBills.length} recurring bill(s).`);
    } catch (error) {
      setRecurringState("error");
      setRecurringMessage(error instanceof Error ? error.message : "Could not load recurring bills.");
    }
  };

  const handleCreateRecurringBill = async () => {
    if (!accessToken.trim()) {
      setRecurringState("error");
      setRecurringMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!recurringName.trim() || !recurringAccountId || !recurringAmount.trim() || !recurringNextDueDate.trim()) {
      setRecurringState("error");
      setRecurringMessage("Name, account, amount, and next due date are required.");
      return;
    }

    setRecurringState("loading");
    setRecurringMessage("");
    try {
      await createRecurringBill(accessToken.trim(), {
        account: recurringAccountId,
        amount: recurringAmount.trim(),
        category: recurringCategoryId || null,
        frequency: recurringFrequency,
        name: recurringName.trim(),
        next_due_date: recurringNextDueDate.trim(),
        note: recurringNote.trim(),
        reminder_days_before: Number(recurringReminderDays || 3)
      });
      setRecurringName("");
      setRecurringAmount("");
      setRecurringNote("");
      await handleLoadRecurringBills();
    } catch (error) {
      setRecurringState("error");
      setRecurringMessage(error instanceof Error ? error.message : "Could not create recurring bill.");
    }
  };

  const handleCreateRecurringBillPayment = async () => {
    if (!accessToken.trim()) {
      setRecurringState("error");
      setRecurringMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!recurringPaymentBillId || !recurringPaymentAmount.trim() || !recurringPaymentDate.trim()) {
      setRecurringState("error");
      setRecurringMessage("Bill, amount, and paid date are required.");
      return;
    }

    setRecurringState("loading");
    setRecurringMessage("");
    try {
      await createRecurringBillPayment(accessToken.trim(), recurringPaymentBillId, {
        amount: recurringPaymentAmount.trim(),
        note: recurringPaymentNote.trim(),
        paid_at: recurringPaymentDate.trim()
      });
      setRecurringPaymentAmount("");
      setRecurringPaymentNote("");
      await handleLoadRecurringBills();
    } catch (error) {
      setRecurringState("error");
      setRecurringMessage(error instanceof Error ? error.message : "Could not record recurring bill payment.");
    }
  };

  const handleLoadReconciliation = async (accountId = reconciliationAccountId) => {
    if (!accessToken.trim()) {
      setReconciliationState("error");
      setReconciliationMessage("Sign in first or paste a valid access token.");
      return;
    }

    let selectedAccountId = accountId;
    setReconciliationState("loading");
    setReconciliationMessage("");
    try {
      let nextAccounts = accounts;
      if (!nextAccounts.length) {
        nextAccounts = await listAccounts(accessToken.trim());
        setAccounts(nextAccounts);
      }
      selectedAccountId = selectedAccountId || nextAccounts[0]?.id || "";
      if (!selectedAccountId) {
        setReconciliationState("error");
        setReconciliationMessage("Create an account before reconciling balances.");
        return;
      }
      setReconciliationAccountId(selectedAccountId);
      const payload = await getAccountReconciliation(accessToken.trim(), selectedAccountId);
      setReconciliation(payload);
      setReconciliationState("ok");
      setReconciliationMessage(`Expected balance for ${payload.account_name}: ${payload.expected_balance}.`);
    } catch (error) {
      setReconciliationState("error");
      setReconciliationMessage(error instanceof Error ? error.message : "Could not load reconciliation check.");
    }
  };

  const handleCreateBalanceSnapshot = async () => {
    if (!accessToken.trim()) {
      setReconciliationState("error");
      setReconciliationMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (!reconciliationAccountId || !snapshotActualBalance.trim()) {
      setReconciliationState("error");
      setReconciliationMessage("Account and actual balance are required.");
      return;
    }

    setReconciliationState("loading");
    setReconciliationMessage("");
    try {
      const snapshot = await createBalanceSnapshot(accessToken.trim(), {
        account: reconciliationAccountId,
        actual_balance: snapshotActualBalance.trim(),
        checked_at: new Date().toISOString(),
        note: snapshotNote.trim()
      });
      setSnapshotActualBalance("");
      setSnapshotNote("");
      await handleLoadReconciliation(snapshot.account);
      setReconciliationMessage(`Snapshot saved. Difference: ${snapshot.difference}.`);
    } catch (error) {
      setReconciliationState("error");
      setReconciliationMessage(error instanceof Error ? error.message : "Could not save balance snapshot.");
    }
  };

  const handleLoadReviewCandidates = async () => {
    if (!accessToken.trim()) {
      setReviewState("error");
      setReviewMessage("Sign in first or paste a valid access token.");
      return;
    }

    setReviewState("loading");
    setReviewMessage("");
    try {
      const [candidates, nextAccounts] = await Promise.all([
        listMessageCandidates(accessToken.trim()),
        accounts.length ? Promise.resolve(accounts) : listAccounts(accessToken.trim())
      ]);
      setReviewCandidates(candidates);
      if (!accounts.length) {
        setAccounts(nextAccounts);
      }
      setReviewDrafts((currentDrafts) => {
        const nextDrafts: Record<string, ReviewCandidateDraft> = {};
        for (const candidate of candidates) {
          nextDrafts[candidate.id] = currentDrafts[candidate.id] ?? buildReviewDraft(candidate);
        }
        return nextDrafts;
      });
      setReviewState("ok");
      setReviewMessage(`Loaded ${candidates.length} SMS candidate(s).`);
    } catch (error) {
      setReviewState("error");
      setReviewMessage(error instanceof Error ? error.message : "Could not load SMS review inbox.");
    }
  };

  const handleConfirmReviewCandidate = async (candidate: ParsedMessageCandidate) => {
    if (!accessToken.trim()) {
      setReviewState("error");
      setReviewMessage("Sign in first or paste a valid access token.");
      return;
    }

    const draft = getReviewDraft(candidate);
    if (!draft.accountId || !candidate.amount) {
      setReviewState("error");
      setReviewMessage("Select a source account before confirming this candidate.");
      return;
    }
    if (draft.transactionType === "transfer" && !draft.transferAccountId) {
      setReviewState("error");
      setReviewMessage("Select a destination account before confirming this transfer.");
      return;
    }
    if (draft.transactionType === "transfer" && draft.accountId === draft.transferAccountId) {
      setReviewState("error");
      setReviewMessage("Source and destination accounts must be different.");
      return;
    }

    setReviewActionCandidateId(candidate.id);
    setReviewState("loading");
    setReviewMessage("");
    try {
      await confirmMessageCandidate(accessToken.trim(), candidate.id, {
        account: draft.accountId,
        amount: candidate.amount,
        date: candidate.raw_message.received_at.slice(0, 10),
        note: candidate.raw_message.body,
        transfer_account: draft.transactionType === "transfer" ? draft.transferAccountId : null,
        type: draft.transactionType
      });
      await handleLoadReviewCandidates();
    } catch (error) {
      setReviewState("error");
      setReviewMessage(error instanceof Error ? error.message : "Could not confirm SMS candidate.");
    } finally {
      setReviewActionCandidateId("");
    }
  };

  const buildReviewDraft = (candidate: ParsedMessageCandidate): ReviewCandidateDraft => ({
    accountId: candidate.account ?? "",
    transactionType: candidate.transaction_type,
    transferAccountId: candidate.destination_account ?? ""
  });

  const getReviewDraft = (candidate: ParsedMessageCandidate): ReviewCandidateDraft =>
    reviewDrafts[candidate.id] ?? buildReviewDraft(candidate);

  const updateReviewDraft = (candidate: ParsedMessageCandidate, patch: Partial<ReviewCandidateDraft>) => {
    setReviewDrafts((currentDrafts) => ({
      ...currentDrafts,
      [candidate.id]: {
        ...(currentDrafts[candidate.id] ?? buildReviewDraft(candidate)),
        ...patch
      }
    }));
  };

  const accountName = (accountId: string | null) =>
    accounts.find((account) => account.id === accountId)?.name ?? (accountId ? "Unknown account" : "Not selected");

  const handleIgnoreReviewCandidate = async (candidateId: string) => {
    if (!accessToken.trim()) {
      setReviewState("error");
      setReviewMessage("Sign in first or paste a valid access token.");
      return;
    }

    setReviewActionCandidateId(candidateId);
    setReviewState("loading");
    setReviewMessage("");
    try {
      await ignoreMessageCandidate(accessToken.trim(), candidateId);
      await handleLoadReviewCandidates();
    } catch (error) {
      setReviewState("error");
      setReviewMessage(error instanceof Error ? error.message : "Could not ignore SMS candidate.");
    } finally {
      setReviewActionCandidateId("");
    }
  };

  const handleRequestSmsPermission = () => {
    setSmsPermissionState("checking");
    setSmsPermissionMessage(
      "Permission gate reached. Add a native Android SMS permission module before reading inbox messages."
    );
    setSmsPermissionState("denied");
  };

  const handleLoadSmsSettings = async () => {
    if (!accessToken.trim()) {
      setSmsSettingsState("error");
      setSmsSettingsMessage("Sign in first or paste a valid access token.");
      return;
    }

    setSmsSettingsState("loading");
    setSmsSettingsMessage("");
    try {
      const [nextPaymentMethods, nextSenderRules] = await Promise.all([
        listPaymentMethods(accessToken.trim()),
        listSenderRules(accessToken.trim())
      ]);
      setPaymentMethods(nextPaymentMethods);
      setSenderRules(nextSenderRules);
      setEnabledSenderRuleIds((currentIds) =>
        currentIds.filter((ruleId) => nextSenderRules.some((rule) => rule.id === ruleId))
      );
      setSmsSettingsState("ok");
      setSmsSettingsMessage(
        `Loaded ${nextPaymentMethods.length} payment method(s) and ${nextSenderRules.length} sender rule(s).`
      );
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not load SMS settings.");
    }
  };

  const handleToggleSenderRule = (senderRuleId: string) => {
    setEnabledSenderRuleIds((currentIds) => {
      if (currentIds.includes(senderRuleId)) {
        return currentIds.filter((id) => id !== senderRuleId);
      }
      return [...currentIds, senderRuleId];
    });
  };

  const saveRawQueue = async (nextQueue: QueuedRawMessage[]) => {
    setRawQueue(nextQueue);
    await AsyncStorage.setItem(rawMessageQueueKey, JSON.stringify(nextQueue));
  };

  const handleQueueRawMessage = async () => {
    if (!rawSender.trim() || !rawBody.trim() || !rawReceivedAt.trim()) {
      setRawQueueState("error");
      setRawQueueMessage("Sender, body, and received time are required.");
      return;
    }

    const queuedInput = {
      body: rawBody.trim(),
      deviceMessageId: rawDeviceMessageId.trim(),
      receivedAt: rawReceivedAt.trim(),
      sender: rawSender.trim()
    };

    if (rawQueue.some((queuedMessage) => rawMessageDedupeKey(queuedMessage) === rawMessageDedupeKey(queuedInput))) {
      setRawQueueState("error");
      setRawQueueMessage("This raw message is already queued locally.");
      return;
    }

    const queuedMessage: QueuedRawMessage = {
      attempts: 0,
      body: queuedInput.body,
      createdAt: new Date().toISOString(),
      deviceMessageId: queuedInput.deviceMessageId,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      lastAttemptAt: "",
      lastError: "",
      nextRetryAt: "",
      receivedAt: queuedInput.receivedAt,
      sender: queuedInput.sender
    };

    try {
      await saveRawQueue([...rawQueue, queuedMessage]);
      setRawQueueState("ok");
      setRawQueueMessage("Raw message queued locally.");
      setRawBody("");
      setRawDeviceMessageId("");
      setRawReceivedAt(new Date().toISOString());
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not save raw message.");
    }
  };

  const handleSyncRawQueue = async () => {
    if (!accessToken.trim()) {
      setRawQueueState("error");
      setRawQueueMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (rawQueue.length === 0) {
      setRawQueueState("ok");
      setRawQueueMessage("No queued raw messages to sync.");
      return;
    }

    setRawQueueState("loading");
    setRawQueueMessage("");

    const remainingQueue: QueuedRawMessage[] = [];
    const nowMs = Date.now();
    let failedCount = 0;
    let syncedCount = 0;
    let skippedCount = 0;

    for (const queuedMessage of rawQueue) {
      if (!isRawMessageRetryDue(queuedMessage, nowMs)) {
        remainingQueue.push(queuedMessage);
        skippedCount += 1;
        continue;
      }

      const attemptedMessage: QueuedRawMessage = {
        ...queuedMessage,
        attempts: queuedMessage.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: ""
      };

      try {
        await importRawMessage(accessToken.trim(), {
          body: attemptedMessage.body,
          device_message_id: attemptedMessage.deviceMessageId,
          received_at: attemptedMessage.receivedAt,
          sender: attemptedMessage.sender
        });
        syncedCount += 1;
      } catch (error) {
        failedCount += 1;
        remainingQueue.push({
          ...attemptedMessage,
          lastError: error instanceof Error ? error.message : "Unknown sync error.",
          nextRetryAt: nextQueueRetryAt(attemptedMessage.attempts)
        });
      }
    }

    try {
      await saveRawQueue(remainingQueue);
      setRawQueueState(failedCount > 0 ? "error" : "ok");
      setRawQueueMessage(
        `Synced ${syncedCount} message(s). ${failedCount} failed. ${skippedCount} waiting for retry. ${remainingQueue.length} message(s) remain queued.`
      );
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not update local queue.");
    }
  };

  const handleRemoveQueuedMessage = async (queuedMessageId: string) => {
    try {
      await saveRawQueue(rawQueue.filter((queuedMessage) => queuedMessage.id !== queuedMessageId));
      setRawQueueState("ok");
      setRawQueueMessage("Queued message removed.");
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not remove queued message.");
    }
  };

  const handleLogin = async () => {
    setAuthState("loading");
    setAuthMessage("");

    try {
      const tokens = await login(username.trim(), password);
      setAccessToken(tokens.access);
      setRefreshToken(tokens.refresh);
      setAuthState("ok");
      setAuthMessage("Login successful. Tokens received.");
    } catch (error) {
      setAuthState("error");
      setAuthMessage(error instanceof Error ? error.message : "Login failed.");
    }
  };

  const handleTokenValidation = async () => {
    if (!accessToken.trim()) {
      setAuthState("error");
      setAuthMessage("Enter or generate an access token first.");
      return;
    }

    setAuthState("loading");
    setAuthMessage("");

    try {
      const user = await getCurrentUser(accessToken.trim());
      setAuthState("ok");
      setAuthMessage(`Authenticated as ${user.username}.`);
    } catch (error) {
      setAuthState("error");
      setAuthMessage(error instanceof Error ? error.message : "Token check failed.");
    }
  };

  const handleLoadReferenceData = async () => {
    if (!accessToken.trim()) {
      setDataState("error");
      setDataMessage("Sign in first or paste a valid access token.");
      return;
    }

    setDataState("loading");
    setDataMessage("");

    try {
      const [nextAccounts, nextCategories] = await Promise.all([
        listAccounts(accessToken.trim()),
        listCategories(accessToken.trim())
      ]);
      setAccounts(nextAccounts);
      setCategories(nextCategories);
      if (!txAccountId && nextAccounts.length > 0) {
        setTxAccountId(nextAccounts[0].id);
      }
      if (!txCategoryId && nextCategories.length > 0) {
        setTxCategoryId(nextCategories[0].id);
      }
      setDataState("ok");
      setDataMessage(
        `Loaded ${nextAccounts.length} account(s) and ${nextCategories.length} categor${nextCategories.length === 1 ? "y" : "ies"}.`
      );
    } catch (error) {
      setDataState("error");
      setDataMessage(error instanceof Error ? error.message : "Could not load accounts/categories.");
    }
  };

  const currentManualTransactionInput = (): CreateTransactionInput | null => {
    if (!txAccountId.trim() || !txDate.trim() || !txType.trim() || !txAmount.trim()) {
      return null;
    }

    return {
      account: txAccountId.trim(),
      amount: txAmount.trim(),
      category: txCategoryId.trim() || undefined,
      date: txDate.trim(),
      note: txNote.trim(),
      type: txType.trim()
    };
  };

  const saveTransactionQueue = async (nextQueue: QueuedManualTransaction[]) => {
    setTransactionQueue(nextQueue);
    await AsyncStorage.setItem(manualTransactionQueueKey, JSON.stringify(nextQueue));
  };

  const handleQueueManualTransaction = async () => {
    const input = currentManualTransactionInput();

    if (!input) {
      setTransactionQueueState("error");
      setTransactionQueueMessage("Account, date, type, and amount are required.");
      return;
    }

    if (transactionQueue.some((queuedTransaction) => manualTransactionDedupeKey(queuedTransaction.input) === manualTransactionDedupeKey(input))) {
      setTransactionQueueState("error");
      setTransactionQueueMessage("This manual transaction is already queued locally.");
      return;
    }

    const queuedTransaction: QueuedManualTransaction = {
      attempts: 0,
      createdAt: new Date().toISOString(),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      input,
      lastAttemptAt: "",
      lastError: "",
      nextRetryAt: ""
    };

    try {
      await saveTransactionQueue([...transactionQueue, queuedTransaction]);
      setTransactionQueueState("ok");
      setTransactionQueueMessage("Manual transaction queued locally.");
      setTxAmount("");
      setTxNote("");
    } catch (error) {
      setTransactionQueueState("error");
      setTransactionQueueMessage(error instanceof Error ? error.message : "Could not save queued transaction.");
    }
  };

  const handleQuickAddTransaction = async () => {
    if (!accessToken.trim()) {
      setTxState("error");
      setTxMessage("Sign in first or paste a valid access token.");
      return;
    }

    const input = currentManualTransactionInput();

    if (!input) {
      setTxState("error");
      setTxMessage("Account, date, type, and amount are required.");
      return;
    }

    setTxState("loading");
    setTxMessage("");

    try {
      await createTransaction(accessToken.trim(), input);
      setTxState("ok");
      setTxMessage("Transaction created.");
      setTxAmount("");
      setTxNote("");
    } catch (error) {
      setTxState("error");
      setTxMessage(error instanceof Error ? error.message : "Could not create transaction.");
    }
  };

  const handleSyncTransactionQueue = async () => {
    if (!accessToken.trim()) {
      setTransactionQueueState("error");
      setTransactionQueueMessage("Sign in first or paste a valid access token.");
      return;
    }
    if (transactionQueue.length === 0) {
      setTransactionQueueState("ok");
      setTransactionQueueMessage("No queued manual transactions to sync.");
      return;
    }

    setTransactionQueueState("loading");
    setTransactionQueueMessage("");

    const remainingQueue: QueuedManualTransaction[] = [];
    const nowMs = Date.now();
    let failedCount = 0;
    let skippedCount = 0;
    let syncedCount = 0;

    for (const queuedTransaction of transactionQueue) {
      if (!isManualTransactionRetryDue(queuedTransaction, nowMs)) {
        remainingQueue.push(queuedTransaction);
        skippedCount += 1;
        continue;
      }

      const attemptedTransaction: QueuedManualTransaction = {
        ...queuedTransaction,
        attempts: queuedTransaction.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: ""
      };

      try {
        await createTransaction(accessToken.trim(), attemptedTransaction.input);
        syncedCount += 1;
      } catch (error) {
        failedCount += 1;
        remainingQueue.push({
          ...attemptedTransaction,
          lastError: error instanceof Error ? error.message : "Unknown sync error.",
          nextRetryAt: nextQueueRetryAt(attemptedTransaction.attempts)
        });
      }
    }

    try {
      await saveTransactionQueue(remainingQueue);
      setTransactionQueueState(failedCount > 0 ? "error" : "ok");
      setTransactionQueueMessage(
        `Synced ${syncedCount} transaction(s). ${failedCount} failed. ${skippedCount} waiting for retry. ${remainingQueue.length} transaction(s) remain queued.`
      );
    } catch (error) {
      setTransactionQueueState("error");
      setTransactionQueueMessage(error instanceof Error ? error.message : "Could not update transaction queue.");
    }
  };

  const handleRemoveQueuedTransaction = async (queuedTransactionId: string) => {
    try {
      await saveTransactionQueue(transactionQueue.filter((queuedTransaction) => queuedTransaction.id !== queuedTransactionId));
      setTransactionQueueState("ok");
      setTransactionQueueMessage("Queued transaction removed.");
    } catch (error) {
      setTransactionQueueState("error");
      setTransactionQueueMessage(error instanceof Error ? error.message : "Could not remove queued transaction.");
    }
  };

  useEffect(() => {
    void loadHealth();
    AsyncStorage.getItem(manualTransactionQueueKey)
      .then((storedQueue) => {
        setTransactionQueue(normalizeManualTransactionQueue(storedQueue));
      })
      .catch(() => {
        setTransactionQueueState("error");
        setTransactionQueueMessage("Could not load local transaction queue.");
      });
    AsyncStorage.getItem(rawMessageQueueKey)
      .then((storedQueue) => {
        setRawQueue(normalizeRawQueue(storedQueue));
      })
      .catch(() => {
        setRawQueueState("error");
        setRawQueueMessage("Could not load local raw message queue.");
      });
  }, []);

  const openDebts = debts.filter((debt) => debt.status !== "paid");
  const cardAccounts = accounts.filter((account) => account.type === "credit_card");
  const openCardBills = cardBills.filter((bill) => bill.status !== "paid");
  const activeRecurringBills = recurringBills.filter((bill) => bill.status === "active");
  const expenseCategories = categories.filter((category) => category.kind === "expense");

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Finance Mobile</Text>
          <Text style={styles.subtitle}>Phase 1 backend connection</Text>
          <Text style={styles.meta}>API: {getApiBaseUrl()}</Text>

          {state === "loading" ? (
            <View style={styles.statusRow}>
              <ActivityIndicator />
              <Text style={styles.statusText}>Checking backend...</Text>
            </View>
          ) : null}

          {state === "success" ? (
            <Text style={styles.okText}>Backend status: {result?.status?.toUpperCase()}</Text>
          ) : null}

          {state === "error" ? (
            <Text style={styles.errorText}>Health check failed: {result?.error ?? "Unknown error"}</Text>
          ) : null}

          <Pressable onPress={loadHealth} style={styles.button}>
            <Text style={styles.buttonText}>Retry Health Check</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Login (JWT)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUsername}
            placeholder="Username"
            style={styles.input}
            value={username}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <Pressable onPress={handleLogin} style={styles.button}>
            <Text style={styles.buttonText}>Sign In</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Access Token</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setAccessToken}
            placeholder="Paste access token for testing /api/auth/me/"
            style={styles.inputMultiline}
            value={accessToken}
          />
          <Pressable onPress={handleTokenValidation} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Validate Token</Text>
          </Pressable>

          {refreshToken ? <Text style={styles.meta}>Refresh token received.</Text> : null}
          {authState === "loading" ? <ActivityIndicator /> : null}
          {authState === "ok" ? <Text style={styles.okText}>{authMessage}</Text> : null}
          {authState === "error" ? <Text style={styles.errorText}>{authMessage}</Text> : null}

          <Text style={styles.sectionTitle}>Reference Data</Text>
          <Pressable onPress={handleLoadReferenceData} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Accounts & Categories</Text>
          </Pressable>

          {dataState === "loading" ? <ActivityIndicator /> : null}
          {dataState === "ok" ? <Text style={styles.okText}>{dataMessage}</Text> : null}
          {dataState === "error" ? <Text style={styles.errorText}>{dataMessage}</Text> : null}

          {accounts.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Accounts</Text>
              {accounts.map((account) => (
                <Pressable key={account.id} onPress={() => setTxAccountId(account.id)}>
                  <Text style={styles.listItem}>
                    {account.name} ({account.type})
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {categories.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Categories</Text>
              {categories.map((category) => (
                <Pressable key={category.id} onPress={() => setTxCategoryId(category.id)}>
                  <Text style={styles.listItem}>
                    {category.name} ({category.kind})
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Quick Add Transaction</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxAccountId}
            placeholder="Account ID"
            style={styles.input}
            value={txAccountId}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxCategoryId}
            placeholder="Category ID (optional)"
            style={styles.input}
            value={txCategoryId}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxDate}
            placeholder="Date (YYYY-MM-DD)"
            style={styles.input}
            value={txDate}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxType}
            placeholder="Type (expense/income/transfer...)"
            style={styles.input}
            value={txType}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={setTxAmount}
            placeholder="Amount (e.g. 1200.00)"
            style={styles.input}
            value={txAmount}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setTxNote}
            placeholder="Note (optional)"
            style={styles.input}
            value={txNote}
          />
          <Pressable onPress={handleQuickAddTransaction} style={styles.button}>
            <Text style={styles.buttonText}>Create Transaction</Text>
          </Pressable>
          <Pressable onPress={handleQueueManualTransaction} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Queue Transaction Offline</Text>
          </Pressable>
          <Pressable onPress={handleSyncTransactionQueue} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Sync Queued Transactions</Text>
          </Pressable>

          {txState === "loading" ? <ActivityIndicator /> : null}
          {txState === "ok" ? <Text style={styles.okText}>{txMessage}</Text> : null}
          {txState === "error" ? <Text style={styles.errorText}>{txMessage}</Text> : null}
          {transactionQueueState === "loading" ? <ActivityIndicator /> : null}
          {transactionQueueState === "ok" ? <Text style={styles.okText}>{transactionQueueMessage}</Text> : null}
          {transactionQueueState === "error" ? <Text style={styles.errorText}>{transactionQueueMessage}</Text> : null}

          <View style={styles.listSection}>
            <Text style={styles.listTitle}>Queued Transactions ({transactionQueue.length})</Text>
            {transactionQueue.map((queuedTransaction) => (
              <View key={queuedTransaction.id} style={styles.queueItem}>
                <Text style={styles.listItem}>
                  {queuedTransaction.input.date} | {queuedTransaction.input.type} | {queuedTransaction.input.amount} | attempts {queuedTransaction.attempts}
                </Text>
                <Text style={styles.meta}>Account: {queuedTransaction.input.account}</Text>
                {queuedTransaction.input.category ? (
                  <Text style={styles.meta}>Category: {queuedTransaction.input.category}</Text>
                ) : null}
                {queuedTransaction.input.note ? <Text style={styles.meta}>{queuedTransaction.input.note}</Text> : null}
                {queuedTransaction.lastAttemptAt ? (
                  <Text style={styles.meta}>Last sync attempt: {queuedTransaction.lastAttemptAt}</Text>
                ) : null}
                {queuedTransaction.nextRetryAt ? (
                  <Text style={styles.meta}>Next retry after: {queuedTransaction.nextRetryAt}</Text>
                ) : null}
                {queuedTransaction.lastError ? <Text style={styles.errorText}>{queuedTransaction.lastError}</Text> : null}
                <Pressable
                  onPress={() => void handleRemoveQueuedTransaction(queuedTransaction.id)}
                  style={styles.buttonDanger}
                >
                  <Text style={styles.buttonText}>Remove From Queue</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Transactions</Text>
          <Pressable onPress={handleLoadTransactions} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Transactions</Text>
          </Pressable>
          {listState === "loading" ? <ActivityIndicator /> : null}
          {listState === "ok" ? <Text style={styles.okText}>{listMessage}</Text> : null}
          {listState === "error" ? <Text style={styles.errorText}>{listMessage}</Text> : null}

          {transactions.length ? (
            <View style={styles.listSection}>
              {transactions.map((transaction) => (
                <Text key={transaction.id} style={styles.listItem}>
                  {transaction.date} | {transaction.type} | {transaction.amount} | {transaction.note || "No note"}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Debts & Lending</Text>
          <Text style={styles.meta}>
            Create money owed records and mark repayments while away from the web dashboard.
          </Text>

          <Pressable onPress={handleLoadDebts} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Debts</Text>
          </Pressable>
          {debtState === "loading" ? <ActivityIndicator /> : null}
          {debtState === "ok" ? <Text style={styles.okText}>{debtMessage}</Text> : null}
          {debtState === "error" ? <Text style={styles.errorText}>{debtMessage}</Text> : null}

          <Text style={styles.sectionTitle}>Add Debt Record</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setDebtCounterparty}
            placeholder="Person or business"
            style={styles.input}
            value={debtCounterparty}
          />
          <View style={styles.choiceRow}>
            {[
              ["lent_by_me", "Lent by me"],
              ["borrowed_by_me", "Borrowed by me"]
            ].map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setDebtDirection(value)}
                style={debtDirection === value ? styles.choiceSelected : styles.choice}
              >
                <Text style={debtDirection === value ? styles.choiceTextSelected : styles.choiceText}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setDebtPrincipal}
            placeholder="Principal amount"
            style={styles.input}
            value={debtPrincipal}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDebtOpenedAt}
            placeholder="Opened date (YYYY-MM-DD)"
            style={styles.input}
            value={debtOpenedAt}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDebtDueDate}
            placeholder="Due date (optional)"
            style={styles.input}
            value={debtDueDate}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setDebtNote}
            placeholder="Note (optional)"
            style={styles.input}
            value={debtNote}
          />
          <Pressable onPress={handleCreateDebt} style={styles.button}>
            <Text style={styles.buttonText}>Save Debt</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Record Repayment</Text>
          {openDebts.length ? (
            <View style={styles.choiceRow}>
              {openDebts.map((debt) => (
                <Pressable
                  key={debt.id}
                  onPress={() => setDebtPaymentId(debt.id)}
                  style={debtPaymentId === debt.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={debtPaymentId === debt.id ? styles.choiceTextSelected : styles.choiceText}>
                    {debt.counterparty_name} | {debt.current_balance}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>No open debt records loaded.</Text>
          )}
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setDebtPaymentAmount}
            placeholder="Payment amount"
            style={styles.input}
            value={debtPaymentAmount}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDebtPaymentDate}
            placeholder="Paid date (YYYY-MM-DD)"
            style={styles.input}
            value={debtPaymentDate}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setDebtPaymentNote}
            placeholder="Payment note (optional)"
            style={styles.input}
            value={debtPaymentNote}
          />
          <Pressable
            disabled={openDebts.length === 0}
            onPress={handleCreateDebtPayment}
            style={openDebts.length === 0 ? styles.buttonDisabled : styles.button}
          >
            <Text style={styles.buttonText}>Record Repayment</Text>
          </Pressable>

          {debts.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>People and balances</Text>
              {debts.map((debt) => (
                <Text key={debt.id} style={styles.listItem}>
                  {debt.counterparty_name} | {debt.direction.replaceAll("_", " ")} | {debt.current_balance} | {debt.status}
                  {debt.due_date ? ` | due ${debt.due_date}` : ""}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Credit Card Bills</Text>
          <Text style={styles.meta}>
            Track statement balances, due dates, minimum dues, and card bill payments from mobile.
          </Text>

          <Pressable onPress={handleLoadCreditCardBills} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Card Bills</Text>
          </Pressable>
          {cardBillState === "loading" ? <ActivityIndicator /> : null}
          {cardBillState === "ok" ? <Text style={styles.okText}>{cardBillMessage}</Text> : null}
          {cardBillState === "error" ? <Text style={styles.errorText}>{cardBillMessage}</Text> : null}

          <Text style={styles.sectionTitle}>Add Statement Bill</Text>
          {cardAccounts.length ? (
            <View style={styles.choiceRow}>
              {cardAccounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => setCardAccountId(account.id)}
                  style={cardAccountId === account.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={cardAccountId === account.id ? styles.choiceTextSelected : styles.choiceText}>
                    {account.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>Load or create a credit-card account before adding card bills.</Text>
          )}
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setCardStatementBalance}
            placeholder="Statement balance"
            style={styles.input}
            value={cardStatementBalance}
          />
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setCardMinimumDue}
            placeholder="Minimum due"
            style={styles.input}
            value={cardMinimumDue}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCardStatementDate}
            placeholder="Statement date (YYYY-MM-DD)"
            style={styles.input}
            value={cardStatementDate}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCardDueDate}
            placeholder="Due date (YYYY-MM-DD)"
            style={styles.input}
            value={cardDueDate}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCardReference}
            placeholder="Reference (optional)"
            style={styles.input}
            value={cardReference}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setCardNote}
            placeholder="Note (optional)"
            style={styles.input}
            value={cardNote}
          />
          <Pressable onPress={handleCreateCreditCardBill} style={styles.button}>
            <Text style={styles.buttonText}>Save Card Bill</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Record Card Payment</Text>
          {openCardBills.length ? (
            <View style={styles.choiceRow}>
              {openCardBills.map((bill) => (
                <Pressable
                  key={bill.id}
                  onPress={() => setCardPaymentBillId(bill.id)}
                  style={cardPaymentBillId === bill.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={cardPaymentBillId === bill.id ? styles.choiceTextSelected : styles.choiceText}>
                    {bill.due_date} | {bill.remaining_balance}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>No open card bills loaded.</Text>
          )}
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setCardPaymentAmount}
            placeholder="Payment amount"
            style={styles.input}
            value={cardPaymentAmount}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setCardPaymentDate}
            placeholder="Paid date (YYYY-MM-DD)"
            style={styles.input}
            value={cardPaymentDate}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setCardPaymentNote}
            placeholder="Payment note (optional)"
            style={styles.input}
            value={cardPaymentNote}
          />
          <Pressable
            disabled={openCardBills.length === 0}
            onPress={handleCreateCreditCardPayment}
            style={openCardBills.length === 0 ? styles.buttonDisabled : styles.button}
          >
            <Text style={styles.buttonText}>Record Card Payment</Text>
          </Pressable>

          {cardBills.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Card bill balances</Text>
              {cardBills.map((bill) => (
                <Text key={bill.id} style={styles.listItem}>
                  {bill.statement_date} | due {bill.due_date} | remaining {bill.remaining_balance} | {bill.status}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Recurring Bills</Text>
          <Text style={styles.meta}>
            Track repeating bills and advance the next due date after each payment.
          </Text>

          <Pressable onPress={handleLoadRecurringBills} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Recurring Bills</Text>
          </Pressable>
          {recurringState === "loading" ? <ActivityIndicator /> : null}
          {recurringState === "ok" ? <Text style={styles.okText}>{recurringMessage}</Text> : null}
          {recurringState === "error" ? <Text style={styles.errorText}>{recurringMessage}</Text> : null}

          <Text style={styles.sectionTitle}>Add Recurring Bill</Text>
          <TextInput
            autoCapitalize="words"
            onChangeText={setRecurringName}
            placeholder="Bill name"
            style={styles.input}
            value={recurringName}
          />
          {accounts.length ? (
            <View style={styles.choiceRow}>
              {accounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => setRecurringAccountId(account.id)}
                  style={recurringAccountId === account.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={recurringAccountId === account.id ? styles.choiceTextSelected : styles.choiceText}>
                    {account.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>Load accounts before adding recurring bills.</Text>
          )}
          {expenseCategories.length ? (
            <View style={styles.choiceRow}>
              {expenseCategories.map((category) => (
                <Pressable
                  key={category.id}
                  onPress={() => setRecurringCategoryId(category.id)}
                  style={recurringCategoryId === category.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={recurringCategoryId === category.id ? styles.choiceTextSelected : styles.choiceText}>
                    {category.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setRecurringAmount}
            placeholder="Amount"
            style={styles.input}
            value={recurringAmount}
          />
          <View style={styles.choiceRow}>
            {["weekly", "monthly", "quarterly", "yearly"].map((frequency) => (
              <Pressable
                key={frequency}
                onPress={() => setRecurringFrequency(frequency)}
                style={recurringFrequency === frequency ? styles.choiceSelected : styles.choice}
              >
                <Text style={recurringFrequency === frequency ? styles.choiceTextSelected : styles.choiceText}>
                  {frequency}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRecurringNextDueDate}
            placeholder="Next due date (YYYY-MM-DD)"
            style={styles.input}
            value={recurringNextDueDate}
          />
          <TextInput
            keyboardType="number-pad"
            onChangeText={setRecurringReminderDays}
            placeholder="Reminder days"
            style={styles.input}
            value={recurringReminderDays}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setRecurringNote}
            placeholder="Note (optional)"
            style={styles.input}
            value={recurringNote}
          />
          <Pressable onPress={handleCreateRecurringBill} style={styles.button}>
            <Text style={styles.buttonText}>Save Recurring Bill</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Record Payment</Text>
          {activeRecurringBills.length ? (
            <View style={styles.choiceRow}>
              {activeRecurringBills.map((bill) => (
                <Pressable
                  key={bill.id}
                  onPress={() => setRecurringPaymentBillId(bill.id)}
                  style={recurringPaymentBillId === bill.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={recurringPaymentBillId === bill.id ? styles.choiceTextSelected : styles.choiceText}>
                    {bill.name} | {bill.next_due_date} | {bill.amount}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>No active recurring bills loaded.</Text>
          )}
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setRecurringPaymentAmount}
            placeholder="Payment amount"
            style={styles.input}
            value={recurringPaymentAmount}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRecurringPaymentDate}
            placeholder="Paid date (YYYY-MM-DD)"
            style={styles.input}
            value={recurringPaymentDate}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setRecurringPaymentNote}
            placeholder="Payment note (optional)"
            style={styles.input}
            value={recurringPaymentNote}
          />
          <Pressable
            disabled={activeRecurringBills.length === 0}
            onPress={handleCreateRecurringBillPayment}
            style={activeRecurringBills.length === 0 ? styles.buttonDisabled : styles.button}
          >
            <Text style={styles.buttonText}>Record Recurring Payment</Text>
          </Pressable>

          {recurringBills.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Recurring schedule</Text>
              {recurringBills.map((bill) => (
                <Text key={bill.id} style={styles.listItem}>
                  {bill.name} | {bill.frequency} | {bill.amount} | next {bill.next_due_date} | {bill.status}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Balance Reconciliation</Text>
          <Text style={styles.meta}>
            Compare the expected ledger balance with the real balance you see in cash, wallet, bank, or card apps.
          </Text>

          <Pressable onPress={() => void handleLoadReconciliation()} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Load Reconciliation Check</Text>
          </Pressable>
          {reconciliationState === "loading" ? <ActivityIndicator /> : null}
          {reconciliationState === "ok" ? <Text style={styles.okText}>{reconciliationMessage}</Text> : null}
          {reconciliationState === "error" ? <Text style={styles.errorText}>{reconciliationMessage}</Text> : null}

          {accounts.length ? (
            <View style={styles.choiceRow}>
              {accounts.map((account) => (
                <Pressable
                  key={account.id}
                  onPress={() => void handleLoadReconciliation(account.id)}
                  style={reconciliationAccountId === account.id ? styles.choiceSelected : styles.choice}
                >
                  <Text style={reconciliationAccountId === account.id ? styles.choiceTextSelected : styles.choiceText}>
                    {account.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.meta}>Load accounts to choose an account for reconciliation.</Text>
          )}

          {reconciliation ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>{reconciliation.account_name}</Text>
              <Text style={styles.listItem}>Expected balance: {reconciliation.expected_balance}</Text>
              <Text style={styles.listItem}>
                Latest snapshot: {reconciliation.latest_snapshot?.actual_balance ?? "No snapshot"}
              </Text>
              <Text style={styles.listItem}>
                Status: {reconciliation.latest_snapshot?.status ?? "not checked"}
              </Text>
            </View>
          ) : null}

          <TextInput
            keyboardType="decimal-pad"
            onChangeText={setSnapshotActualBalance}
            placeholder="Actual balance"
            style={styles.input}
            value={snapshotActualBalance}
          />
          <TextInput
            autoCapitalize="sentences"
            onChangeText={setSnapshotNote}
            placeholder="Snapshot note (optional)"
            style={styles.input}
            value={snapshotNote}
          />
          <Pressable onPress={handleCreateBalanceSnapshot} style={styles.button}>
            <Text style={styles.buttonText}>Save Balance Snapshot</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>SMS Tracking Settings</Text>
          <Text style={styles.meta}>
            Choose trusted backend sender rules before any future native SMS reader imports messages.
          </Text>

          <View style={styles.permissionBox}>
            <Text style={styles.listTitle}>Permission gate</Text>
            <Text style={styles.meta}>Status: {smsPermissionState}</Text>
            <Text style={styles.meta}>{smsPermissionMessage}</Text>
            <Pressable onPress={handleRequestSmsPermission} style={styles.buttonSecondary}>
              <Text style={styles.buttonText}>Check SMS Permission Scaffold</Text>
            </Pressable>
          </View>

          <Pressable onPress={handleLoadSmsSettings} style={styles.button}>
            <Text style={styles.buttonText}>Load Payment Methods & Sender Rules</Text>
          </Pressable>

          {smsSettingsState === "loading" ? <ActivityIndicator /> : null}
          {smsSettingsState === "ok" ? <Text style={styles.okText}>{smsSettingsMessage}</Text> : null}
          {smsSettingsState === "error" ? <Text style={styles.errorText}>{smsSettingsMessage}</Text> : null}

          {paymentMethods.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Payment Methods</Text>
              {paymentMethods.map((method) => (
                <Text key={method.id} style={styles.listItem}>
                  {method.name} ({method.provider}){method.identifier ? ` - ${method.identifier}` : ""}
                </Text>
              ))}
            </View>
          ) : null}

          {senderRules.length ? (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Tracked Senders</Text>
              {senderRules.map((rule) => {
                const isEnabled = enabledSenderRuleIds.includes(rule.id);
                return (
                  <Pressable
                    key={rule.id}
                    onPress={() => handleToggleSenderRule(rule.id)}
                    style={isEnabled ? styles.senderRuleSelected : styles.senderRule}
                  >
                    <Text style={styles.listTitle}>{rule.sender}</Text>
                    <Text style={styles.listItem}>
                      {rule.name} | {rule.provider} | {rule.match_type} | priority {rule.priority}
                    </Text>
                    <Text style={isEnabled ? styles.okText : styles.meta}>
                      {isEnabled ? "Enabled for future import" : "Tap to enable"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Local Raw Message Queue</Text>
          <Text style={styles.meta}>
            This is the offline-safe handoff point for future native SMS capture.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRawSender}
            placeholder="Sender (for example bKash)"
            style={styles.input}
            value={rawSender}
          />
          <TextInput
            autoCapitalize="sentences"
            multiline
            onChangeText={setRawBody}
            placeholder="Raw SMS body"
            style={styles.inputMultiline}
            value={rawBody}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRawReceivedAt}
            placeholder="Received at ISO time"
            style={styles.input}
            value={rawReceivedAt}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setRawDeviceMessageId}
            placeholder="Device message ID (optional)"
            style={styles.input}
            value={rawDeviceMessageId}
          />
          <Pressable onPress={handleQueueRawMessage} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Queue Raw Message</Text>
          </Pressable>
          <Pressable onPress={handleSyncRawQueue} style={styles.button}>
            <Text style={styles.buttonText}>Sync Queued Messages</Text>
          </Pressable>

          {rawQueueState === "loading" ? <ActivityIndicator /> : null}
          {rawQueueState === "ok" ? <Text style={styles.okText}>{rawQueueMessage}</Text> : null}
          {rawQueueState === "error" ? <Text style={styles.errorText}>{rawQueueMessage}</Text> : null}

          <View style={styles.listSection}>
            <Text style={styles.listTitle}>Queued Messages ({rawQueue.length})</Text>
            {rawQueue.map((queuedMessage) => (
              <View key={queuedMessage.id} style={styles.queueItem}>
                <Text style={styles.listItem}>
                  {queuedMessage.sender} | {queuedMessage.receivedAt} | attempts {queuedMessage.attempts}
                </Text>
                <Text style={styles.meta}>{queuedMessage.body}</Text>
                {queuedMessage.lastAttemptAt ? (
                  <Text style={styles.meta}>Last sync attempt: {queuedMessage.lastAttemptAt}</Text>
                ) : null}
                {queuedMessage.nextRetryAt ? (
                  <Text style={styles.meta}>Next retry after: {queuedMessage.nextRetryAt}</Text>
                ) : null}
                {queuedMessage.lastError ? <Text style={styles.errorText}>{queuedMessage.lastError}</Text> : null}
                <Pressable onPress={() => void handleRemoveQueuedMessage(queuedMessage.id)} style={styles.buttonDanger}>
                  <Text style={styles.buttonText}>Remove From Queue</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>SMS Review Inbox</Text>
          <Text style={styles.meta}>
            Review backend parser candidates before they become transactions. Choose source and destination accounts before confirming transfers.
          </Text>
          <Pressable onPress={handleLoadReviewCandidates} style={styles.button}>
            <Text style={styles.buttonText}>Load SMS Review Inbox</Text>
          </Pressable>

          {reviewState === "loading" ? <ActivityIndicator /> : null}
          {reviewState === "ok" ? <Text style={styles.okText}>{reviewMessage}</Text> : null}
          {reviewState === "error" ? <Text style={styles.errorText}>{reviewMessage}</Text> : null}

          {reviewCandidates.length ? (
            <View style={styles.listSection}>
              {reviewCandidates.map((candidate) => {
                const isWorking = reviewActionCandidateId === candidate.id;
                const draft = getReviewDraft(candidate);
                return (
                  <View key={candidate.id} style={styles.reviewCandidate}>
                    <Text style={styles.listTitle}>
                      {candidate.provider} / {candidate.message_kind} / BDT {candidate.amount ?? "missing"}
                    </Text>
                    <Text style={styles.listItem}>
                      {candidate.raw_message.sender} | {candidate.transaction_type} | {confidenceLabel(candidate.confidence)} ({confidencePercent(candidate.confidence)})
                    </Text>
                    <Text style={styles.warningText}>{candidateReviewReason(candidate)}</Text>
                    <Text style={styles.meta}>
                      Counterparty: {candidate.counterparty_text || "Not detected"}
                    </Text>
                    <Text style={styles.meta}>
                      Ref: {candidate.reference || "None"} | Balance: {candidate.balance_after ?? "missing"} | Fee: {candidate.fee_amount ?? "missing"}
                    </Text>
                    {candidate.possible_internal_transfer ? (
                      <Text style={styles.warningText}>
                        Possible internal transfer{candidate.possible_related_candidate ? ` linked to ${candidate.possible_related_candidate}` : ""}.
                      </Text>
                    ) : null}
                    <View style={styles.reviewControls}>
                      <Text style={styles.listTitle}>Type</Text>
                      <View style={styles.choiceRow}>
                        {["expense", "income", "transfer"].map((type) => (
                          <Pressable
                            key={type}
                            onPress={() =>
                              updateReviewDraft(candidate, {
                                transactionType: type,
                                transferAccountId: type === "transfer" ? draft.transferAccountId : ""
                              })
                            }
                            style={draft.transactionType === type ? styles.choiceSelected : styles.choice}
                          >
                            <Text style={draft.transactionType === type ? styles.choiceTextSelected : styles.choiceText}>
                              {type}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.listTitle}>Source account: {accountName(draft.accountId)}</Text>
                      {accounts.length ? (
                        <View style={styles.choiceRow}>
                          {accounts.map((account) => (
                            <Pressable
                              key={account.id}
                              onPress={() => updateReviewDraft(candidate, { accountId: account.id })}
                              style={draft.accountId === account.id ? styles.choiceSelected : styles.choice}
                            >
                              <Text style={draft.accountId === account.id ? styles.choiceTextSelected : styles.choiceText}>
                                {account.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.warningText}>Load accounts before confirming from mobile.</Text>
                      )}

                      {draft.transactionType === "transfer" ? (
                        <>
                          <Text style={styles.listTitle}>
                            Destination account: {accountName(draft.transferAccountId)}
                          </Text>
                          {accounts.length ? (
                            <View style={styles.choiceRow}>
                              {accounts.map((account) => (
                                <Pressable
                                  key={account.id}
                                  onPress={() => updateReviewDraft(candidate, { transferAccountId: account.id })}
                                  style={draft.transferAccountId === account.id ? styles.choiceSelected : styles.choice}
                                >
                                  <Text
                                    style={draft.transferAccountId === account.id ? styles.choiceTextSelected : styles.choiceText}
                                  >
                                    {account.name}
                                  </Text>
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                        </>
                      ) : null}
                    </View>
                    <Text style={styles.rawSmsText}>{candidate.raw_message.body}</Text>
                    <Text style={styles.meta}>{candidate.parser_notes}</Text>
                    <Text style={styles.meta}>Raw message status: {candidate.raw_message.status}</Text>
                    <View style={styles.actionRow}>
                      <Pressable
                        disabled={isWorking}
                        onPress={() => void handleConfirmReviewCandidate(candidate)}
                        style={isWorking ? styles.buttonDisabled : styles.button}
                      >
                        <Text style={styles.buttonText}>{isWorking ? "Working..." : "Confirm"}</Text>
                      </Pressable>
                      <Pressable
                        disabled={isWorking}
                        onPress={() => void handleIgnoreReviewCandidate(candidate.id)}
                        style={isWorking ? styles.buttonDisabled : styles.buttonDanger}
                      >
                        <Text style={styles.buttonText}>Ignore</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: "#0f766e",
    borderRadius: 8,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  buttonDanger: {
    backgroundColor: "#b91c1c",
    borderRadius: 8,
    flex: 1,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  buttonDisabled: {
    backgroundColor: "#94a3b8",
    borderRadius: 8,
    flex: 1,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center"
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 20,
    width: "100%"
  },
  choice: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  choiceSelected: {
    backgroundColor: "#0f766e",
    borderColor: "#0f766e",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  choiceText: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "600"
  },
  choiceTextSelected: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700"
  },
  content: {
    gap: 14,
    padding: 20
  },
  errorText: {
    color: "#b91c1c",
    fontSize: 14
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  inputMultiline: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 12,
    minHeight: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top"
  },
  meta: {
    color: "#334155",
    fontSize: 13
  },
  listItem: {
    color: "#0f172a",
    fontSize: 13
  },
  listSection: {
    gap: 4,
    marginTop: 8
  },
  listTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700"
  },
  actionRow: {
    flexDirection: "row",
    gap: 8
  },
  okText: {
    color: "#065f46",
    fontSize: 14,
    fontWeight: "600"
  },
  permissionBox: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    marginTop: 8,
    padding: 12
  },
  queueItem: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    marginTop: 8,
    padding: 12
  },
  rawSmsText: {
    color: "#475569",
    fontSize: 12,
    lineHeight: 18
  },
  reviewCandidate: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    padding: 12
  },
  reviewControls: {
    gap: 8,
    marginTop: 4
  },
  screen: {
    backgroundColor: "#f8fafc",
    flex: 1,
    width: "100%"
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  statusText: {
    color: "#0f172a",
    fontSize: 14
  },
  subtitle: {
    color: "#334155",
    fontSize: 15
  },
  buttonSecondary: {
    backgroundColor: "#0369a1",
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  senderRule: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12
  },
  senderRuleSelected: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981",
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12
  },
  title: {
    color: "#0f172a",
    fontSize: 22,
    fontWeight: "700"
  },
  warningText: {
    color: "#92400e",
    fontSize: 13,
    fontWeight: "600"
  }
});
