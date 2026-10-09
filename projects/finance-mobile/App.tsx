import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Animated,
  Easing,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import {
  checkHealth,
  configureAuthenticationRecovery,
  confirmMessageCandidate,
  createBalanceSnapshot,
  createCreditCardBill,
  createCreditCardPayment,
  createDebt,
  createDebtPayment,
  createRecurringBill,
  createRecurringBillPayment,
  createSenderRule,
  createTransaction,
  findTransferMatches,
  linkTransfer,
  type TransferMatch,
  type TransferMatchInput,
  type ConfirmMessageCandidateInput,
  AuthenticationError,
  getApiBaseUrl,
  getAccountReconciliation,
  getCurrentUser,
  getSmsCapturePreference,
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
  logout as revokeLoginSession,
  refreshLogin,
  rejectMessageCandidate,
  resetSmsDevelopmentData,
  updateSmsCapturePreference,
  updateSmsDeviceStatus,
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
  type SmsCapturePreference,
  type Transaction
} from "./src/api";
import {
  clearNativeSmsBackgroundSyncSession,
  clearCapturedSmsMessages,
  configureNativeSmsBackgroundSync,
  configureNativeSmsSenderRules,
  enqueueNativeSmsBackgroundSync,
  getCapturedSmsMessages,
  getNativeSmsBackgroundSyncStatus,
  getNativeSmsBackgroundSyncSession,
  getNativeSmsPermissionStatus,
  isNativeSmsCaptureAvailable,
  listNativeSmsInboxSenders,
  resetNativeSmsTrackingState,
  scanHistoricalSmsMessages,
  type CapturedSmsMessage,
  type NativeSmsSenderRule,
  type NativeSmsBackgroundSyncStatus,
  type SmsInboxSender
} from "./modules/finance-sms-capture/src";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";

import { ChoicePressable } from "./src/choice-pressable";
import { clearSession, loadSession, saveSession } from "./src/session";
import { loadSecureSmsQueue, saveSecureSmsQueue } from "./src/secure-sms-queue";

type ViewState = "idle" | "loading" | "success" | "error";
type SmsPermissionState = "unknown" | "checking" | "granted" | "denied";
type SmsScanMode = "new" | "history";
type MainTab = "home" | "activity" | "capture" | "review" | "more";
type HomeFeed = "review" | "captured";
type MobilePanel = "sms-automation" | null;
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type ReviewCandidateDraft = {
  direction: string;
  accountId: string;
  amount: string;
  categoryId: string;
  counterpartyText: string;
  date: string;
  note: string;
  paymentMethodId: string;
  reference: string;
  time: string;
  transferAccountId: string;
  transactionType: string;
};
function isIncomingReview(candidate: ParsedMessageCandidate) {
  return ["cash_in", "receive_money", "bank_transfer_in"].includes(candidate.message_kind);
}

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
  reprocessExisting: boolean;
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
const rawMessageQueueOwnerKey = "finance.rawMessageQueueOwner";
const manualTransactionQueueKey = "finance.manualTransactionQueue";
const accountCacheKey = "finance.accountCache";
const categoryCacheKey = "finance.categoryCache";
const transactionCacheKey = "finance.transactionCache";
const enabledSenderRulesKey = "finance.enabledSenderRules";
const smsProviderOptions = [
  { label: "bKash", value: "bkash" },
  { label: "Nagad", value: "nagad" },
  { label: "Rocket", value: "rocket" },
  { label: "EBL", value: "ebl" },
  { label: "City Bank", value: "city_bank" },
  { label: "Pathao Pay", value: "pathao_pay" },
  { label: "Bank", value: "bank" },
  { label: "Card", value: "card" },
  { label: "Other", value: "other" }
] as const;

function parseMoney(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const amount = Number(value.replaceAll(",", ""));
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(value: number) {
  const [wholePart, decimalPart] = value.toFixed(2).split(".");
  return `BDT ${wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimalPart}`;
}

function sumMoney<T>(items: T[], selector: (item: T) => string | null | undefined) {
  return items.reduce((total, item) => total + parseMoney(selector(item)), 0);
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day);
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

function isDueSoon(date: string | null | undefined, daysAhead = 7) {
  if (!date) {
    return false;
  }

  const dueDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + daysAhead);
  return dueDate <= end;
}

function SummaryMetric({
  label,
  tone = "default",
  value
}: {
  label: string;
  tone?: "default" | "success" | "warning";
  value: string;
}) {
  return (
    <View
      style={[
        styles.summaryMetric,
        tone === "success" ? styles.summaryMetricSuccess : null,
        tone === "warning" ? styles.summaryMetricWarning : null
      ]}
    >
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ label, tone = "default" }: { label: string; tone?: "default" | "success" | "warning" }) {
  return (
    <Text
      style={[
        styles.statusPill,
        tone === "success" ? styles.statusPillSuccess : null,
        tone === "warning" ? styles.statusPillWarning : null
      ]}
    >
      {label}
    </Text>
  );
}

function InlineFeedback({
  loadingLabel,
  message,
  state
}: {
  loadingLabel: string;
  message: string;
  state: "idle" | "loading" | "ok" | "success" | "error";
}) {
  if (state === "idle" && !message) {
    return null;
  }

  const isLoading = state === "loading";
  const isError = state === "error";
  const label = isLoading ? loadingLabel : message;
  if (!label) {
    return null;
  }

  return (
    <View style={[styles.mobileInlineFeedback, isError ? styles.mobileInlineFeedbackError : null]}>
      {isLoading ? (
        <ActivityIndicator color="#32d8f2" size="small" />
      ) : (
        <MaterialCommunityIcons
          color={isError ? "#ff9399" : "#55e6a5"}
          name={isError ? "alert-circle-outline" : "check-circle-outline"}
          size={19}
        />
      )}
      <Text style={[styles.mobileInlineFeedbackText, isError ? styles.mobileInlineFeedbackTextError : null]}>
        {label}
      </Text>
    </View>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeStringArray(storedValue: string | null): string[] {
  if (!storedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedValue) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function normalizeAccountCache(storedAccounts: string | null): Account[] {
  if (!storedAccounts) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedAccounts) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const account = {
        currency: stringValue(item.currency) || "BDT",
        id: stringValue(item.id),
        latest_reported_balance: stringValue(item.latest_reported_balance) || null,
        latest_reported_balance_date: stringValue(item.latest_reported_balance_date) || null,
        ledger_balance: stringValue(item.ledger_balance) || stringValue(item.starting_balance) || "0.00",
        name: stringValue(item.name),
        starting_balance: stringValue(item.starting_balance) || "0.00",
        type: stringValue(item.type)
      };

      return account.id && account.name ? [account] : [];
    });
  } catch {
    return [];
  }
}

function normalizeCategoryCache(storedCategories: string | null): Category[] {
  if (!storedCategories) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedCategories) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const category = {
        id: stringValue(item.id),
        kind: stringValue(item.kind),
        name: stringValue(item.name)
      };

      return category.id && category.name ? [category] : [];
    });
  } catch {
    return [];
  }
}

function normalizeTransactionCache(storedTransactions: string | null): Transaction[] {
  if (!storedTransactions) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedTransactions) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const transaction: Transaction = {
        account_direction: stringValue(item.account_direction) || stringValue(item.direction),
        transfer_evidence: Array.isArray(item.transfer_evidence) ? item.transfer_evidence.filter(isRecord).map((evidence) => ({
          id: stringValue(evidence.id), account: stringValue(evidence.account), raw_message: nullableStringValue(evidence.raw_message), is_primary: evidence.is_primary === true,
          direction: stringValue(evidence.direction) as "debit" | "credit", date: stringValue(evidence.date), time: nullableStringValue(evidence.time),
          balance_after: nullableStringValue(evidence.balance_after), fee_amount: nullableStringValue(evidence.fee_amount),
          reference: stringValue(evidence.reference), provider: stringValue(evidence.provider), source: stringValue(evidence.source) as "web" | "mobile" | "sms" | "import" | "system", note: stringValue(evidence.note)
        })) : [],
        account: stringValue(item.account),
        amount: stringValue(item.amount),
        balance_after: nullableStringValue(item.balance_after),
        category: nullableStringValue(item.category),
        counterparty_text: stringValue(item.counterparty_text),
        created_at: stringValue(item.created_at),
        date: stringValue(item.date),
        direction: stringValue(item.direction),
        external_key: stringValue(item.external_key),
        id: stringValue(item.id),
        needs_review: item.needs_review === true,
        note: stringValue(item.note),
        payment_method: nullableStringValue(item.payment_method),
        raw_message: nullableStringValue(item.raw_message),
        receiver_account_identifier: stringValue(item.receiver_account_identifier),
        receiver_card_identifier: stringValue(item.receiver_card_identifier),
        reference: stringValue(item.reference),
        sender_account_identifier: stringValue(item.sender_account_identifier),
        sender_card_identifier: stringValue(item.sender_card_identifier),
        source: stringValue(item.source),
        time: nullableStringValue(item.time),
        transfer_account: nullableStringValue(item.transfer_account),
        type: stringValue(item.type),
        updated_at: stringValue(item.updated_at)
      };

      return transaction.id && transaction.date && transaction.amount && transaction.type ? [transaction] : [];
    });
  } catch {
    return [];
  }
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

function senderMatchesRule(
  sender: string,
  rule: Pick<SenderRule, "is_active" | "match_type" | "pattern" | "sender">
) {
  const normalizedSender = sender.trim().toLowerCase();
  const normalizedRuleSender = rule.sender.trim().toLowerCase();

  if (!rule.is_active || !normalizedSender || !normalizedRuleSender) {
    return false;
  }

  if (rule.match_type === "contains") {
    return normalizedSender.includes((rule.pattern || rule.sender).trim().toLowerCase());
  }
  if (rule.match_type === "regex") {
    try {
      return new RegExp(rule.pattern || rule.sender, "i").test(sender.trim());
    } catch {
      return false;
    }
  }
  return normalizedSender === normalizedRuleSender;
}

function buildNativeSenderRules(
  senderRules: SenderRule[],
  enabledSenderRuleIds: string[],
  excludedProviders: string[] = []
): NativeSmsSenderRule[] {
  const enabledIds = new Set(enabledSenderRuleIds);
  const excludedProviderSet = new Set(excludedProviders);
  return senderRules
    .filter(
      (rule) =>
        rule.is_active
        && enabledIds.has(rule.id)
        && !excludedProviderSet.has(rule.provider)
        && rule.sender.trim()
    )
    .map((rule) => ({
      id: rule.id,
      isActive: rule.is_active,
      matchType: rule.match_type,
      pattern: rule.pattern,
      sender: rule.sender
    }));
}

function inferSmsProvider(sender: string) {
  const normalized = sender.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("bkash")) return "bkash";
  if (normalized.includes("nagad")) return "nagad";
  if (normalized.includes("rocket") || normalized.includes("dbbl")) return "rocket";
  if (normalized.includes("citybank") || normalized === "city") return "city_bank";
  if (normalized.includes("pathao")) return "pathao_pay";
  if (normalized.includes("ebl")) return "ebl";
  return "other";
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
    input.transfer_account?.trim() ?? "",
    input.direction ?? "",
    input.category?.trim() ?? "",
    input.date.trim(),
    input.time?.trim() ?? "",
    input.type.trim(),
    input.amount.trim().replaceAll(",", ""),
    input.balance_after?.trim().replaceAll(",", "") ?? "",
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
        direction: stringValue(item.input.direction) || undefined,
        transfer_account: nullableStringValue(item.input.transfer_account),
        external_key: stringValue(item.input.external_key) || undefined,
        amount: stringValue(item.input.amount),
        balance_after: stringValue(item.input.balance_after) || undefined,
        category: stringValue(item.input.category) || undefined,
        date: stringValue(item.input.date),
        note: stringValue(item.input.note),
        time: stringValue(item.input.time) || undefined,
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
        reprocessExisting: item.reprocessExisting === true,
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

function currentInputTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function inputTimeFromTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatMobileDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><FinanceApp /></SafeAreaProvider>;
}

function FinanceApp() {
  const [iconsLoaded, iconFontError] = useFonts(MaterialCommunityIcons.font);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [state, setState] = useState<ViewState>("idle");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [sessionRestoring, setSessionRestoring] = useState(true);
  const [authState, setAuthState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [authMessage, setAuthMessage] = useState("");
  const [dataState, setDataState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [dataMessage, setDataMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [txAccountId, setTxAccountId] = useState("");
  const [txCategoryId, setTxCategoryId] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txTime, setTxTime] = useState(currentInputTime());
  const [txDirection, setTxDirection] = useState("debit");
  const [txTransferAccountId, setTxTransferAccountId] = useState("");
  const [transferDecision, setTransferDecision] = useState<{ input: TransferMatchInput; matches: TransferMatch[]; queueId?: string } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [txType, setTxType] = useState("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txBalanceAfter, setTxBalanceAfter] = useState("");
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
    "Native SMS capture requires a custom Android dev client or APK."
  );
  const [smsSettingsState, setSmsSettingsState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [smsSettingsMessage, setSmsSettingsMessage] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [senderRules, setSenderRules] = useState<SenderRule[]>([]);
  const [smsCapturePreference, setSmsCapturePreference] = useState<SmsCapturePreference>({
    created_at: "",
    excluded_message_kinds: ["otp_or_security", "promotional"],
    excluded_providers: [],
    raw_sms_retention_days: 30,
    updated_at: ""
  });
  const [updatingCaptureKey, setUpdatingCaptureKey] = useState("");
  const [enabledSenderRuleIds, setEnabledSenderRuleIds] = useState<string[]>([]);
  const [updatingSenderRuleId, setUpdatingSenderRuleId] = useState("");
  const [smsInboxSenders, setSmsInboxSenders] = useState<SmsInboxSender[]>([]);
  const [smsSenderSearch, setSmsSenderSearch] = useState("");
  const [selectedSmsSender, setSelectedSmsSender] = useState("");
  const [newSenderRuleName, setNewSenderRuleName] = useState("");
  const [newSenderAccountId, setNewSenderAccountId] = useState("");
  const [newSenderCategoryId, setNewSenderCategoryId] = useState("");
  const [newSenderTransactionType, setNewSenderTransactionType] = useState("");
  const [newSenderProvider, setNewSenderProvider] = useState("other");
  const [smsSenderDiscoveryState, setSmsSenderDiscoveryState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [smsSenderDiscoveryMessage, setSmsSenderDiscoveryMessage] = useState("");
  const [smsRuleCreateState, setSmsRuleCreateState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [smsRuleCreateMessage, setSmsRuleCreateMessage] = useState("");
  const [rawSender, setRawSender] = useState("");
  const [rawBody, setRawBody] = useState("");
  const [rawReceivedAt, setRawReceivedAt] = useState(new Date().toISOString());
  const [rawDeviceMessageId, setRawDeviceMessageId] = useState("");
  const [rawQueue, setRawQueue] = useState<QueuedRawMessage[]>([]);
  const [rawQueueState, setRawQueueState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [rawQueueMessage, setRawQueueMessage] = useState("");
  const [smsScanMode, setSmsScanMode] = useState<SmsScanMode>("new");
  const [smsScanFrom, setSmsScanFrom] = useState(daysAgo(30));
  const [smsScanTo, setSmsScanTo] = useState(today());
  const [smsReprocessExisting, setSmsReprocessExisting] = useState(false);
  const [smsDevResetArmed, setSmsDevResetArmed] = useState(false);
  const [smsDevResetState, setSmsDevResetState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [smsDevResetMessage, setSmsDevResetMessage] = useState("");
  const [smsBackgroundStatus, setSmsBackgroundStatus] = useState<NativeSmsBackgroundSyncStatus | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewCandidates, setReviewCandidates] = useState<ParsedMessageCandidate[]>([]);
  const [reviewActionCandidateId, setReviewActionCandidateId] = useState("");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewCandidateDraft>>({});
  const [reviewCandidateIndex, setReviewCandidateIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<MainTab>("home");
  const [homeFeed, setHomeFeed] = useState<HomeFeed>("review");
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const drawerTranslateX = useRef(new Animated.Value(-320)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  const loadHealth = async () => {
    setState("loading");
    let nextResult = await checkHealth();
    if (!nextResult.ok) {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 1500));
      nextResult = await checkHealth();
    }
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
      try {
        await AsyncStorage.setItem(transactionCacheKey, JSON.stringify(payload));
      } catch {
        setListMessage(`Loaded ${payload.length} transaction(s), but could not update the local cache.`);
        return;
      }
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
      setReviewCandidateIndex((current) => Math.min(current, Math.max(0, candidates.length - 1)));
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
    if (!draft.accountId || !draft.amount.trim()) {
      setReviewState("error");
      setReviewMessage("Select an account and enter the transaction amount before confirming.");
      return;
    }
    const normalizedAmount = draft.amount.trim().replaceAll(",", "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedAmount) || Number(normalizedAmount) <= 0) {
      setReviewState("error");
      setReviewMessage("Enter a valid positive amount with no more than two decimal places.");
      return;
    }
    if (!isValidIsoDate(draft.date.trim())) {
      setReviewState("error");
      setReviewMessage("Enter a valid transaction date in YYYY-MM-DD format.");
      return;
    }
    if (draft.time.trim() && !isValidTime(draft.time.trim())) {
      setReviewState("error");
      setReviewMessage("Enter a valid transaction time in HH:MM format.");
      return;
    }
    setReviewActionCandidateId(candidate.id);
    setReviewState("loading");
    setReviewMessage("");
    try {
      const input: ConfirmMessageCandidateInput = {
        account_perspective: true,
        direction: draft.direction,
        account: draft.accountId,
        amount: normalizedAmount,
        balance_after: candidate.balance_after,
        category: draft.categoryId || null,
        counterparty_text: draft.counterpartyText.trim(),
        date: draft.date.trim(),
        note: draft.note.trim(),
        payment_method: draft.paymentMethodId || null,
        reference: draft.reference.trim(),
        remember_mapping: true,
        time: draft.time.trim() || null,
        transfer_account: draft.transactionType === "transfer" ? draft.transferAccountId : null,
        type: draft.transactionType
      };
      if (draft.transactionType === "transfer" || candidate.possible_internal_transfer || ["receive_money", "bank_transfer_in"].includes(candidate.message_kind)) {
        const matchInput = { candidate: candidate.id, draft: input };
        const matches = await findTransferMatches(accessToken.trim(), matchInput);
        if (matches.length) {
          setTransferError("");
          setTransferDecision({ input: matchInput, matches });
          setReviewState("ok");
          return;
        }
      }
      await confirmMessageCandidate(accessToken.trim(), candidate.id, input);
      await handleLoadReviewCandidates();
    } catch (error) {
      setReviewState("error");
      setReviewMessage(error instanceof Error ? error.message : "Could not confirm SMS candidate.");
    } finally {
      setReviewActionCandidateId("");
    }
  };

  const buildReviewDraft = (candidate: ParsedMessageCandidate): ReviewCandidateDraft => ({
    accountId: isIncomingReview(candidate) ? candidate.destination_account ?? candidate.account ?? "" : candidate.account ?? "",
    direction: isIncomingReview(candidate) || ["income", "refund"].includes(candidate.transaction_type) ? "credit" : "debit",
    amount: candidate.amount ?? "",
    categoryId: candidate.category ?? "",
    counterpartyText: candidate.counterparty_text,
    date: candidate.raw_message.received_at.slice(0, 10),
    note: "",
    paymentMethodId: (isIncomingReview(candidate) && candidate.destination_account ? candidate.destination_payment_method : candidate.payment_method) ?? "",
    reference: candidate.reference,
    time: inputTimeFromTimestamp(candidate.raw_message.received_at),
    transactionType: candidate.transaction_type,
    transferAccountId: (isIncomingReview(candidate) ? candidate.destination_account ? candidate.account : null : candidate.destination_account) ?? ""
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

  const handleRejectReviewCandidate = async (
    candidate: ParsedMessageCandidate,
    exclusion: "entry" | "provider" | "sender" = "entry"
  ) => {
    if (!accessToken.trim()) {
      setReviewState("error");
      setReviewMessage("Sign in first or paste a valid access token.");
      return;
    }

    setReviewActionCandidateId(candidate.id);
    setReviewState("loading");
    setReviewMessage("");
    try {
      await rejectMessageCandidate(accessToken.trim(), candidate.id, {
        exclude_provider: exclusion === "provider",
        exclude_sender: exclusion === "sender",
        reason: candidate.message_kind === "otp_or_security" ? "otp_security" : "not_transaction",
        redact_raw_sms: true
      });
      await Promise.all([
        handleLoadReviewCandidates(),
        exclusion === "entry" ? Promise.resolve() : handleLoadSmsSettings()
      ]);
    } catch (error) {
      setReviewState("error");
      setReviewMessage(error instanceof Error ? error.message : "Could not reject SMS candidate.");
    } finally {
      setReviewActionCandidateId("");
    }
  };

  const confirmRejectReviewCandidate = (candidate: ParsedMessageCandidate) => {
    Alert.alert(
      "Reject this message",
      "Choose whether this decision applies only to this message or to future captures. The stored SMS body will be redacted.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => void handleRejectReviewCandidate(candidate, "entry"),
          style: "destructive",
          text: "Only this message"
        },
        {
          onPress: () => void handleRejectReviewCandidate(candidate, "sender"),
          style: "destructive",
          text: `Disable ${candidate.raw_message.sender}`
        },
        {
          onPress: () => void handleRejectReviewCandidate(candidate, "provider"),
          style: "destructive",
          text: `Exclude ${titleCase(candidate.provider)}`
        }
      ]
    );
  };

  const pendingSmsCount = isNativeSmsCaptureAvailable()
    ? smsBackgroundStatus?.pendingCount ?? rawQueue.length
    : rawQueue.length;

  const refreshSmsPermissionState = async () => {
    if (Platform.OS !== "android" || !isNativeSmsCaptureAvailable()) {
      setSmsPermissionState("denied");
      setSmsPermissionMessage("SMS automation is available in the installed Android app.");
      return;
    }

    try {
      const nativeStatus = await getNativeSmsPermissionStatus();
      const isGranted = nativeStatus.canReadSms && nativeStatus.canReceiveSms;
      setSmsPermissionState(isGranted ? "granted" : "denied");
      setSmsPermissionMessage(
        isGranted
          ? "SMS access is ready. Choose trusted senders and start the sync."
          : "Allow read and receive access so Finance Mobile can find matching messages."
      );
      if (accessToken.trim()) {
        await updateSmsDeviceStatus(accessToken.trim(), {
          app_version: "0.1.4",
          background_state: isGranted ? "idle" : "disabled",
          device_id: "android-primary",
          pending_upload_count: pendingSmsCount,
          platform: Platform.OS,
          sms_permission_state: isGranted ? "granted" : "denied"
        }).catch(() => undefined);
      }
    } catch (error) {
      setSmsPermissionState("denied");
      setSmsPermissionMessage(error instanceof Error ? error.message : "Could not check SMS permission.");
    }
  };

  const refreshSmsBackgroundStatus = async () => {
    const nextStatus = await getNativeSmsBackgroundSyncStatus();
    setSmsBackgroundStatus(nextStatus);
    if (isNativeSmsCaptureAvailable()) {
      setRawQueue(normalizeRawQueue(await loadSecureSmsQueue()));
    }
    if (accessToken.trim() && nextStatus) {
      await updateSmsDeviceStatus(accessToken.trim(), {
        app_version: "0.1.4",
        background_state: nextStatus.state === "error" ? "error" : nextStatus.state === "running" ? "running" : nextStatus.state === "success" ? "success" : "idle",
        device_id: "android-primary",
        failed_upload_count: nextStatus.rejectedCount,
        last_error: nextStatus.state === "error" ? nextStatus.message : "",
        pending_upload_count: nextStatus.pendingCount ?? pendingSmsCount,
        platform: Platform.OS,
        sms_permission_state: smsPermissionState === "granted" ? "granted" : smsPermissionState === "denied" ? "denied" : "unknown"
      }).catch(() => undefined);
    }
  };

  const handleRetrySmsBackgroundSync = async () => {
    if (!isNativeSmsCaptureAvailable()) {
      setSmsBackgroundStatus({
        importedCount: 0,
        message: "Background SMS sync requires the installed Android app.",
        rejectedCount: 0,
        state: "error",
        updatedAt: new Date().toISOString()
      });
      return;
    }
    setSmsBackgroundStatus((current) => ({
      importedCount: current?.importedCount ?? 0,
      message: "Background SMS sync is queued…",
      rejectedCount: current?.rejectedCount ?? 0,
      state: "running",
      updatedAt: new Date().toISOString()
    }));
    try {
      await enqueueNativeSmsBackgroundSync();
      await refreshSmsBackgroundStatus();
    } catch (error) {
      setSmsBackgroundStatus({
        importedCount: 0,
        message: error instanceof Error ? error.message : "Could not queue background SMS sync.",
        rejectedCount: 0,
        state: "error",
        updatedAt: new Date().toISOString()
      });
    }
  };

  const handleRequestSmsPermission = async () => {
    setSmsPermissionState("checking");
    setSmsPermissionMessage("Checking native Android SMS permission.");

    if (Platform.OS !== "android") {
      setSmsPermissionState("denied");
      setSmsPermissionMessage("Native SMS capture is Android-only.");
      return;
    }

    if (!isNativeSmsCaptureAvailable()) {
      setSmsPermissionState("denied");
      setSmsPermissionMessage("Build a custom Android dev client or APK before requesting SMS permission.");
      return;
    }

    try {
      const permissionResult = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
      ]);
      const hasReadSms = permissionResult[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
      const hasReceiveSms =
        permissionResult[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED;
      const nativeStatus = await getNativeSmsPermissionStatus();

      if (hasReadSms && hasReceiveSms && nativeStatus.canReadSms && nativeStatus.canReceiveSms) {
        setSmsPermissionState("granted");
        setSmsPermissionMessage("SMS access is ready. Choose trusted senders and start the sync.");
        if (accessToken.trim()) {
          await updateSmsDeviceStatus(accessToken.trim(), {
            app_version: "0.1.4",
            background_state: smsBackgroundStatus?.state === "running" ? "running" : "idle",
            device_id: "android-primary",
            pending_upload_count: pendingSmsCount,
            platform: Platform.OS,
            sms_permission_state: "granted"
          }).catch(() => undefined);
        }
        return;
      }

      setSmsPermissionState("denied");
      setSmsPermissionMessage("SMS permission was not granted. Manual raw-message import remains available.");
      if (accessToken.trim()) {
        await updateSmsDeviceStatus(accessToken.trim(), {
          app_version: "0.1.4",
          background_state: "disabled",
          device_id: "android-primary",
          platform: Platform.OS,
          sms_permission_state: "denied"
        }).catch(() => undefined);
      }
    } catch (error) {
      setSmsPermissionState("denied");
      setSmsPermissionMessage(error instanceof Error ? error.message : "Could not request SMS permission.");
    }
  };

  const handleLoadSmsInboxSenders = async () => {
    setSmsSenderDiscoveryState("loading");
    setSmsSenderDiscoveryMessage("Reading sender names from the Android inbox…");
    try {
      const permission = await getNativeSmsPermissionStatus();
      if (!permission.canReadSms) {
        setSmsSenderDiscoveryState("error");
        setSmsSenderDiscoveryMessage("Allow SMS read access before loading sender names.");
        return;
      }

      const senders = await listNativeSmsInboxSenders();
      setSmsInboxSenders(senders);
      setSmsSenderDiscoveryState("ok");
      setSmsSenderDiscoveryMessage(
        senders.length
          ? `Found ${senders.length} unique sender name(s). Search and select one to create a rule.`
          : "No SMS sender names were found in the inbox."
      );
    } catch (error) {
      setSmsSenderDiscoveryState("error");
      setSmsSenderDiscoveryMessage(error instanceof Error ? error.message : "Could not load SMS sender names.");
    }
  };

  const handleSelectSmsInboxSender = (sender: string) => {
    setSelectedSmsSender(sender);
    setNewSenderRuleName(`${sender} transactions`);
    setNewSenderProvider(inferSmsProvider(sender));
    setNewSenderAccountId((current) => current || accounts[0]?.id || "");
    setSmsRuleCreateState("idle");
    setSmsRuleCreateMessage("");
  };

  const handleCreateSmsSenderRule = async () => {
    if (!selectedSmsSender.trim() || !newSenderRuleName.trim() || !newSenderAccountId) {
      setSmsRuleCreateState("error");
      setSmsRuleCreateMessage("Choose a sender and destination account, then enter a rule name.");
      return;
    }
    if (
      senderRules.some(
        (rule) => rule.match_type === "exact" && rule.sender.trim().toLowerCase() === selectedSmsSender.trim().toLowerCase()
      )
    ) {
      setSmsRuleCreateState("error");
      setSmsRuleCreateMessage("This exact sender already has a rule. Enable the existing rule instead.");
      return;
    }

    setSmsRuleCreateState("loading");
    setSmsRuleCreateMessage("Creating and enabling sender rule…");
    try {
      const createdRule = await createSenderRule(accessToken.trim(), {
        account: newSenderAccountId,
        category: newSenderCategoryId || null,
        default_transaction_type: newSenderTransactionType,
        match_type: "exact",
        name: newSenderRuleName.trim(),
        provider: newSenderProvider,
        sender: selectedSmsSender.trim()
      });
      const nextRules = [...senderRules, createdRule].sort(
        (left, right) => left.priority - right.priority || left.name.localeCompare(right.name)
      );
      const nextEnabledIds = Array.from(new Set([...enabledSenderRuleIds, createdRule.id]));
      setSenderRules(nextRules);
      setEnabledSenderRuleIds(nextEnabledIds);
      await AsyncStorage.setItem(enabledSenderRulesKey, JSON.stringify(nextEnabledIds));
      await configureNativeSmsSenderRules(
        buildNativeSenderRules(nextRules, nextEnabledIds, smsCapturePreference.excluded_providers)
      );
      setSmsRuleCreateState("ok");
      setSmsRuleCreateMessage(`${createdRule.sender} is now tracked and mapped to the selected account.`);
      setSelectedSmsSender("");
      setNewSenderRuleName("");
      setNewSenderCategoryId("");
      setNewSenderTransactionType("");
      setSmsSenderSearch("");
    } catch (error) {
      setSmsRuleCreateState("error");
      setSmsRuleCreateMessage(error instanceof Error ? error.message : "Could not create the sender rule.");
    }
  };

  const handleConfigureNativeSmsCapture = async () => {
    const nativeRules = buildNativeSenderRules(
      senderRules,
      enabledSenderRuleIds,
      smsCapturePreference.excluded_providers
    );

    if (nativeRules.length === 0) {
      setSmsSettingsState("error");
      setSmsSettingsMessage("Enable at least one sender rule before syncing native SMS capture.");
      return;
    }

    setSmsSettingsState("loading");
    setSmsSettingsMessage("");
    try {
      const result = await configureNativeSmsSenderRules(nativeRules);
      setSmsSettingsState("ok");
      setSmsSettingsMessage(`Native SMS capture synced ${result.configuredCount} sender rule(s).`);
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not configure native SMS capture.");
    }
  };

  const handleImportCapturedSmsMessages = async () => {
    if (isNativeSmsCaptureAvailable()) {
      await handleRetrySmsBackgroundSync();
      return;
    }
    const enabledRules = senderRules.filter(
      (rule) =>
        rule.is_active
        && enabledSenderRuleIds.includes(rule.id)
        && !smsCapturePreference.excluded_providers.includes(rule.provider)
    );

    if (enabledRules.length === 0) {
      setRawQueueState("error");
      setRawQueueMessage("Enable sender rules before importing captured SMS messages.");
      return;
    }

    setRawQueueState("loading");
    setRawQueueMessage("");

    try {
      const capturedMessages = await getCapturedSmsMessages(50);
      const currentDedupeKeys = new Set(rawQueue.map((queuedMessage) => rawMessageDedupeKey(queuedMessage)));
      const nextMessages: QueuedRawMessage[] = [];
      const clearIds: string[] = [];
      let duplicateCount = 0;
      let ignoredCount = 0;

      capturedMessages.forEach((message: CapturedSmsMessage) => {
        if (!enabledRules.some((rule) => senderMatchesRule(message.sender, rule))) {
          ignoredCount += 1;
          return;
        }

        const queuedInput = {
          body: message.body.trim(),
          deviceMessageId: `native:${message.id}`,
          receivedAt: message.receivedAt.trim(),
          sender: message.sender.trim()
        };
        const dedupeKey = rawMessageDedupeKey(queuedInput);
        clearIds.push(message.id);

        if (currentDedupeKeys.has(dedupeKey)) {
          duplicateCount += 1;
          return;
        }

        currentDedupeKeys.add(dedupeKey);
        nextMessages.push({
          attempts: 0,
          body: queuedInput.body,
          createdAt: new Date().toISOString(),
          deviceMessageId: queuedInput.deviceMessageId,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          lastAttemptAt: "",
          lastError: "",
          nextRetryAt: "",
          receivedAt: queuedInput.receivedAt,
          reprocessExisting: false,
          sender: queuedInput.sender
        });
      });

      if (nextMessages.length > 0) {
        await saveRawQueue([...rawQueue, ...nextMessages]);
      }
      await clearCapturedSmsMessages(clearIds);
      setRawQueueState("ok");
      setRawQueueMessage(
        `Imported ${nextMessages.length} captured SMS message(s). ${duplicateCount} duplicate(s) skipped. ${ignoredCount} untracked message(s) left native-side.`
      );
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not import captured SMS messages.");
    }
  };

  const handleScanAndSyncSms = async () => {
    if (!accessToken.trim()) {
      setRawQueueState("error");
      setRawQueueMessage("Your session is not ready. Sign in again and retry.");
      return;
    }

    const enabledRules = senderRules.filter(
      (rule) =>
        rule.is_active
        && enabledSenderRuleIds.includes(rule.id)
        && !smsCapturePreference.excluded_providers.includes(rule.provider)
    );
    const nativeRules = buildNativeSenderRules(
      senderRules,
      enabledSenderRuleIds,
      smsCapturePreference.excluded_providers
    );
    if (enabledRules.length === 0 || nativeRules.length === 0) {
      setRawQueueState("error");
      setRawQueueMessage("Choose at least one trusted SMS sender before scanning.");
      return;
    }

    let fromTimestamp: number | undefined;
    let toTimestamp: number | undefined;
    if (smsScanMode === "history") {
      fromTimestamp = new Date(`${smsScanFrom}T00:00:00`).getTime();
      toTimestamp = new Date(`${smsScanTo}T23:59:59.999`).getTime();
      if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) || fromTimestamp > toTimestamp) {
        setRawQueueState("error");
        setRawQueueMessage("Enter a valid history range in YYYY-MM-DD format. The start must be before the end.");
        return;
      }
    }

    setRawQueueState("loading");
    setRawQueueMessage("Checking Android SMS access…");
    await updateSmsDeviceStatus(accessToken.trim(), {
      background_state: "running",
      device_id: "android-primary",
      pending_upload_count: pendingSmsCount,
      platform: Platform.OS,
      sms_permission_state: "granted"
    }).catch(() => undefined);

    try {
      const permission = await getNativeSmsPermissionStatus();
      if (!permission.canReadSms) {
        setRawQueueState("error");
        setRawQueueMessage("Allow SMS access first, then run the scan again.");
        return;
      }

      await configureNativeSmsSenderRules(nativeRules);
      setRawQueueMessage(
        smsScanMode === "history"
          ? `Scanning tracked messages from ${smsScanFrom} through ${smsScanTo}…`
          : "Scanning messages that have not been imported before…"
      );
      const reprocessExisting = smsScanMode === "history" && smsReprocessExisting;
      const scanResult = await scanHistoricalSmsMessages({
        fromTimestamp,
        includeProcessed: reprocessExisting,
        limit: 500,
        toTimestamp
      });
      if (isNativeSmsCaptureAvailable()) {
        await enqueueNativeSmsBackgroundSync();
        await refreshSmsBackgroundStatus();
        setRawQueueState("ok");
        setRawQueueMessage(`Scanned ${scanResult.scannedCount} SMS. ${scanResult.capturedCount} newly queued; background sync will upload pending messages when connected.`);
        return;
      }
      const capturedMessages = await getCapturedSmsMessages(500);
      const queuedMessages = [...rawQueue];
      const queuedMessageIndexes = new Map(
        queuedMessages.map((queuedMessage, index) => [rawMessageDedupeKey(queuedMessage), index])
      );
      const currentDedupeKeys = new Set(queuedMessageIndexes.keys());
      const newlyQueued: QueuedRawMessage[] = [];
      const clearIds: string[] = [];
      let localDuplicateCount = 0;

      capturedMessages.forEach((message) => {
        if (!enabledRules.some((rule) => senderMatchesRule(message.sender, rule))) {
          return;
        }

        const queuedInput = {
          body: message.body.trim(),
          deviceMessageId: `native:${message.id}`,
          receivedAt: message.receivedAt.trim(),
          sender: message.sender.trim()
        };
        clearIds.push(message.id);
        const dedupeKey = rawMessageDedupeKey(queuedInput);
        if (currentDedupeKeys.has(dedupeKey)) {
          const queuedIndex = queuedMessageIndexes.get(dedupeKey);
          if (reprocessExisting && queuedIndex !== undefined) {
            queuedMessages[queuedIndex] = {
              ...queuedMessages[queuedIndex],
              reprocessExisting: true
            };
          }
          localDuplicateCount += 1;
          return;
        }

        currentDedupeKeys.add(dedupeKey);
        newlyQueued.push({
          attempts: 0,
          body: queuedInput.body,
          createdAt: new Date().toISOString(),
          deviceMessageId: queuedInput.deviceMessageId,
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          lastAttemptAt: "",
          lastError: "",
          nextRetryAt: "",
          receivedAt: queuedInput.receivedAt,
          reprocessExisting,
          sender: queuedInput.sender
        });
      });

      const queueToSync = [...queuedMessages, ...newlyQueued];
      await saveRawQueue(queueToSync);
      await clearCapturedSmsMessages(clearIds);
      const remainingQueue: QueuedRawMessage[] = [];
      let syncedCount = 0;
      let failedCount = 0;
      let importedCount = 0;
      let duplicateCount = 0;
      let excludedCount = 0;
      let reprocessedCount = 0;

      setRawQueueMessage(`Found ${newlyQueued.length} tracked message(s). Syncing securely…`);
      for (const queuedMessage of queueToSync) {
        const attemptedMessage: QueuedRawMessage = {
          ...queuedMessage,
          attempts: queuedMessage.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: ""
        };

        try {
          const result = await importRawMessage(accessToken.trim(), {
            body: attemptedMessage.body,
            device_message_id: attemptedMessage.deviceMessageId,
            received_at: attemptedMessage.receivedAt,
            reprocess_existing: attemptedMessage.reprocessExisting,
            sender: attemptedMessage.sender
          });
          syncedCount += 1;
          if (result.was_reprocessed) {
            reprocessedCount += 1;
          } else if (result.is_duplicate) {
            duplicateCount += 1;
          } else if (result.message.exclusion_reason) {
            excludedCount += 1;
          } else {
            importedCount += 1;
          }
        } catch (error) {
          failedCount += 1;
          remainingQueue.push({
            ...attemptedMessage,
            lastError: error instanceof Error ? error.message : "Unknown sync error.",
            nextRetryAt: nextQueueRetryAt(attemptedMessage.attempts)
          });
        }
      }

      await saveRawQueue(remainingQueue);
      await Promise.all([handleLoadReviewCandidates(), handleLoadTransactions()]);
      setRawQueueState(failedCount > 0 ? "error" : "ok");
      setRawQueueMessage(
        `Scanned ${scanResult.scannedCount} SMS. Imported ${importedCount}, excluded ${excludedCount} by capture policy, refreshed ${reprocessedCount}, skipped ${duplicateCount + localDuplicateCount + scanResult.duplicateCount}, and kept ${failedCount} for retry. ${syncedCount} sync request(s) completed.`
      );
      const completedAt = new Date().toISOString();
      await updateSmsDeviceStatus(accessToken.trim(), {
        background_state: failedCount > 0 ? "error" : "success",
        failed_upload_count: failedCount,
        last_error: failedCount > 0 ? `${failedCount} message(s) are waiting for retry.` : "",
        last_scan_at: completedAt,
        last_successful_sync_at: failedCount > 0 ? undefined : completedAt,
        pending_upload_count: remainingQueue.length,
        sms_permission_state: "granted"
      }).catch(() => undefined);
    } catch (error) {
      setRawQueueState("error");
      setRawQueueMessage(error instanceof Error ? error.message : "Could not scan and sync SMS messages.");
      await updateSmsDeviceStatus(accessToken.trim(), {
        background_state: "error",
        failed_upload_count: Math.max(1, rawQueue.length),
        last_error: error instanceof Error ? error.message : "Could not scan and sync SMS messages.",
        pending_upload_count: pendingSmsCount
      }).catch(() => undefined);
    }
  };

  const handleDevelopmentSmsReset = async () => {
    if (!smsDevResetArmed) {
      setSmsDevResetArmed(true);
      setSmsDevResetState("error");
      setSmsDevResetMessage(
        "This deletes this user's imported SMS candidates and SMS-created transactions. Tap again to confirm."
      );
      return;
    }

    setSmsDevResetState("loading");
    setSmsDevResetMessage("Clearing local and backend SMS development data…");
    try {
      await resetNativeSmsTrackingState();
      const result = await resetSmsDevelopmentData(accessToken.trim());
      await saveRawQueue([]);
      setReviewCandidates([]);
      setSmsDevResetArmed(false);
      setSmsDevResetState("ok");
      setSmsDevResetMessage(
        `Cleared ${result.deleted_messages} message(s), ${result.deleted_candidates} review candidate(s), and ${result.deleted_transactions} SMS transaction(s).`
      );
      await Promise.all([handleLoadReviewCandidates(), handleLoadTransactions()]);
    } catch (error) {
      setSmsDevResetState("error");
      setSmsDevResetMessage(error instanceof Error ? error.message : "Could not clear SMS development data.");
    }
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
      const [nextPaymentMethods, nextSenderRules, nextCapturePreference, storedEnabledRuleIds] = await Promise.all([
        listPaymentMethods(accessToken.trim()),
        listSenderRules(accessToken.trim()),
        getSmsCapturePreference(accessToken.trim()),
        AsyncStorage.getItem(enabledSenderRulesKey)
      ]);
      const validEnabledRuleIds = normalizeStringArray(storedEnabledRuleIds).filter((ruleId) =>
        nextSenderRules.some((rule) => rule.id === ruleId)
      );
      setPaymentMethods(nextPaymentMethods);
      setSenderRules(nextSenderRules);
      setSmsCapturePreference(nextCapturePreference);
      setEnabledSenderRuleIds(validEnabledRuleIds);
      if (isNativeSmsCaptureAvailable()) {
        await configureNativeSmsSenderRules(
          buildNativeSenderRules(
            nextSenderRules,
            validEnabledRuleIds,
            nextCapturePreference.excluded_providers
          )
        );
      }
      setSmsSettingsState("ok");
      setSmsSettingsMessage(
        `Loaded ${nextPaymentMethods.length} payment method(s) and ${nextSenderRules.length} sender rule(s).`
      );
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not load SMS settings.");
    }
  };

  const handleToggleSenderRule = async (senderRuleId: string) => {
    const nextIds = enabledSenderRuleIds.includes(senderRuleId)
      ? enabledSenderRuleIds.filter((id) => id !== senderRuleId)
      : [...enabledSenderRuleIds, senderRuleId];
    setUpdatingSenderRuleId(senderRuleId);
    setSmsSettingsState("loading");
    setSmsSettingsMessage("Updating trusted senders on this device…");
    try {
      const configured = isNativeSmsCaptureAvailable()
        ? await configureNativeSmsSenderRules(
            buildNativeSenderRules(senderRules, nextIds, smsCapturePreference.excluded_providers)
          )
        : { configuredCount: nextIds.length };
      await AsyncStorage.setItem(enabledSenderRulesKey, JSON.stringify(nextIds));
      setEnabledSenderRuleIds(nextIds);
      setSmsSettingsState("ok");
      setSmsSettingsMessage(
        isNativeSmsCaptureAvailable()
          ? `Native capture now tracks ${configured.configuredCount} active sender rule(s).`
          : `Selected ${configured.configuredCount} active sender rule(s) for foreground import.`
      );
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not update native sender tracking.");
    } finally {
      setUpdatingSenderRuleId("");
    }
  };

  const handleToggleCaptureExclusion = async (
    kind: "message_kind" | "provider",
    value: string
  ) => {
    if (!accessToken.trim()) {
      setSmsSettingsState("error");
      setSmsSettingsMessage("Sign in before updating SMS capture policy.");
      return;
    }

    const currentValues = kind === "provider"
      ? smsCapturePreference.excluded_providers
      : smsCapturePreference.excluded_message_kinds;
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    const patch = kind === "provider"
      ? { excluded_providers: nextValues }
      : { excluded_message_kinds: nextValues };
    const captureKey = `${kind}:${value}`;

    setUpdatingCaptureKey(captureKey);
    setSmsSettingsState("loading");
    setSmsSettingsMessage("Updating capture policy…");
    try {
      const nextPreference = await updateSmsCapturePreference(accessToken.trim(), patch);
      setSmsCapturePreference(nextPreference);
      if (isNativeSmsCaptureAvailable()) {
        await configureNativeSmsSenderRules(
          buildNativeSenderRules(
            senderRules,
            enabledSenderRuleIds,
            nextPreference.excluded_providers
          )
        );
      }
      setSmsSettingsState("ok");
      setSmsSettingsMessage("Capture policy updated on the server and this device.");
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not update capture policy.");
    } finally {
      setUpdatingCaptureKey("");
    }
  };

  const handleUpdateSmsRetention = async (retentionDays: number | null) => {
    if (!accessToken.trim()) {
      setSmsSettingsState("error");
      setSmsSettingsMessage("Sign in before updating SMS privacy settings.");
      return;
    }

    setUpdatingCaptureKey("retention");
    setSmsSettingsState("loading");
    setSmsSettingsMessage("Updating SMS retention…");
    try {
      const nextPreference = await updateSmsCapturePreference(accessToken.trim(), {
        raw_sms_retention_days: retentionDays
      });
      setSmsCapturePreference(nextPreference);
      setSmsSettingsState("ok");
      setSmsSettingsMessage(
        retentionDays === null
          ? "Original SMS text will be kept until you redact it."
          : retentionDays === 0
            ? "Original SMS text will be removed after confirmation."
            : `Original SMS text will be kept for ${retentionDays} days after confirmation.`
      );
    } catch (error) {
      setSmsSettingsState("error");
      setSmsSettingsMessage(error instanceof Error ? error.message : "Could not update SMS retention.");
    } finally {
      setUpdatingCaptureKey("");
    }
  };

  const saveRawQueue = async (nextQueue: QueuedRawMessage[]) => {
    setRawQueue(nextQueue);
    await saveSecureSmsQueue(JSON.stringify(nextQueue));
    await Promise.all([
      AsyncStorage.removeItem(rawMessageQueueKey),
      nextQueue.length > 0 && username.trim()
        ? AsyncStorage.setItem(rawMessageQueueOwnerKey, username.trim())
        : AsyncStorage.removeItem(rawMessageQueueOwnerKey)
    ]);
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
      reprocessExisting: false,
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
    if (isNativeSmsCaptureAvailable()) {
      await handleRetrySmsBackgroundSync();
      return;
    }
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
    let excludedCount = 0;
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
        const result = await importRawMessage(accessToken.trim(), {
          body: attemptedMessage.body,
          device_message_id: attemptedMessage.deviceMessageId,
          received_at: attemptedMessage.receivedAt,
          reprocess_existing: attemptedMessage.reprocessExisting,
          sender: attemptedMessage.sender
        });
        syncedCount += 1;
        if (result.message.exclusion_reason) {
          excludedCount += 1;
        }
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
        `Synced ${syncedCount} message(s); ${excludedCount} were discarded by capture policy. ${failedCount} failed. ${skippedCount} waiting for retry. ${remainingQueue.length} message(s) remain queued.`
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

  const clearDeviceSmsState = async () => {
    if (isNativeSmsCaptureAvailable()) {
      await Promise.all([
        clearNativeSmsBackgroundSyncSession(),
        configureNativeSmsSenderRules([])
      ]);
      await resetNativeSmsTrackingState();
    } else {
      await saveSecureSmsQueue("[]");
    }
    await Promise.all([
      AsyncStorage.removeItem(enabledSenderRulesKey),
      AsyncStorage.removeItem(rawMessageQueueKey),
      AsyncStorage.removeItem(rawMessageQueueOwnerKey)
    ]);
    setEnabledSenderRuleIds([]);
    setRawQueue([]);
    setSmsBackgroundStatus(null);
  };

  const handleLogin = async () => {
    setAuthState("loading");
    setAuthMessage("");

    try {
      const nextUsername = username.trim();
      const tokens = await login(nextUsername, password);
      const [nativeSession, rawQueueOwner, storedRawQueue, capturedSms] = await Promise.all([
        getNativeSmsBackgroundSyncSession(),
        AsyncStorage.getItem(rawMessageQueueOwnerKey),
        loadSecureSmsQueue(),
        isNativeSmsCaptureAvailable() ? getCapturedSmsMessages(1) : Promise.resolve([])
      ]);
      const hasQueuedSms = normalizeRawQueue(storedRawQueue).length > 0 || capturedSms.length > 0;
      if (
        (nativeSession?.username && nativeSession.username !== nextUsername)
        || (rawQueueOwner && rawQueueOwner !== nextUsername)
        || (!rawQueueOwner && hasQueuedSms && nativeSession?.username !== nextUsername)
      ) {
        await clearDeviceSmsState();
      } else if (hasQueuedSms) {
        await AsyncStorage.setItem(rawMessageQueueOwnerKey, nextUsername);
      }
      await saveSession({ ...tokens, username: nextUsername });
      setAccessToken(tokens.access);
      setRefreshToken(tokens.refresh);
      setPassword("");
      setAuthState("ok");
      setAuthMessage("Signed in securely.");
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
      await Promise.all([
        AsyncStorage.setItem(accountCacheKey, JSON.stringify(nextAccounts)),
        AsyncStorage.setItem(categoryCacheKey, JSON.stringify(nextCategories))
      ]);
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
      direction: txType.trim() === "transfer" ? txDirection : undefined,
      transfer_account: txType.trim() === "transfer" ? txTransferAccountId || null : undefined,
      amount: txAmount.trim(),
      balance_after: txBalanceAfter.trim() || undefined,
      category: txCategoryId.trim() || undefined,
      date: txDate.trim(),
      note: txNote.trim(),
      time: txTime.trim() || undefined,
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
      setTxBalanceAfter("");
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
      if (input.type === "transfer") {
        input.external_key = `mobile-transfer:${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const matches = await findTransferMatches(accessToken.trim(), { draft: input });
        if (matches.length) {
          setTransferError("");
          setTransferDecision({ input: { draft: input }, matches });
          setTxState("ok");
          return;
        }
      }
      await createTransaction(accessToken.trim(), input);
      setTxState("ok");
      setTxMessage("Transaction created.");
      setTxAmount("");
      setTxBalanceAfter("");
      setTxNote("");
    } catch (error) {
      setTxState("error");
      setTxMessage(error instanceof Error ? error.message : "Could not create transaction.");
    }
  };

  const handleTransferDecision = async (match?: TransferMatch) => {
    if (!transferDecision || !accessToken.trim()) return;
    setTransferBusy(true);
    setTransferError("");
    try {
      if (match) await linkTransfer(accessToken.trim(), transferDecision.input, match);
      else if (transferDecision.input.candidate) {
        await confirmMessageCandidate(accessToken.trim(), transferDecision.input.candidate, transferDecision.input.draft as ConfirmMessageCandidateInput);
      } else await createTransaction(accessToken.trim(), transferDecision.input.draft as CreateTransactionInput);
      if (transferDecision.queueId) {
        await saveTransactionQueue(transactionQueue.filter((entry) => entry.id !== transferDecision.queueId));
        setTransactionQueueMessage("Transfer resolved. Sync again to continue the remaining queue.");
      } else if (!transferDecision.input.candidate) {
        setTxAmount(""); setTxBalanceAfter(""); setTxNote("");
        setTxMessage(match ? "Transfer linked. One movement in both accounts." : "Transfer kept separate.");
      }
      setTransferDecision(null);
      await Promise.all([handleLoadReviewCandidates(), handleLoadTransactions()]);
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Could not resolve transfer match.");
    } finally { setTransferBusy(false); }
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

    for (const [queueIndex, queuedTransaction] of transactionQueue.entries()) {
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
        if (attemptedTransaction.input.type === "transfer") {
          attemptedTransaction.input = { ...attemptedTransaction.input, external_key: attemptedTransaction.input.external_key || `queued-transfer:${attemptedTransaction.id}` };
          const matches = await findTransferMatches(accessToken.trim(), { draft: attemptedTransaction.input });
          if (matches.length) {
            await saveTransactionQueue([...remainingQueue, attemptedTransaction, ...transactionQueue.slice(queueIndex + 1)]);
            setTransferError("");
            setTransferDecision({ input: { draft: attemptedTransaction.input }, matches, queueId: attemptedTransaction.id });
            setTransactionQueueState("ok");
            setTransactionQueueMessage("Possible transfer match found. Resolve it before continuing sync.");
            return;
          }
        }
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

  const openDrawer = () => {
    setDrawerVisible(true);
    drawerTranslateX.setValue(-320);
    Animated.timing(drawerTranslateX, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
      toValue: 0,
      useNativeDriver: true
    }).start();
  };

  const closeDrawer = () => {
    Animated.timing(drawerTranslateX, {
      duration: 180,
      easing: Easing.in(Easing.cubic),
      toValue: -320,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) {
        setDrawerVisible(false);
      }
    });
  };

  const switchTab = (nextTab: MainTab) => {
    if (nextTab === activeTab) {
      return;
    }
    Animated.timing(contentOpacity, {
      duration: 90,
      toValue: 0,
      useNativeDriver: true
    }).start(() => {
      setActiveTab(nextTab);
      setMobilePanel(null);
      setShowAdvancedTools(false);
      Animated.timing(contentOpacity, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true
      }).start();
    });
  };

  const handleLogout = async () => {
    let sessionRefreshToken = refreshToken.trim();
    try {
      const nativeSession = await getNativeSmsBackgroundSyncSession();
      if (nativeSession?.username === username.trim()) {
        sessionRefreshToken = nativeSession.refresh;
      }
    } catch {
      // Fall back to the refresh token held by the React session.
    }
    if (sessionRefreshToken) {
      try {
        await revokeLoginSession(sessionRefreshToken);
      } catch {
        // Device cleanup still proceeds if the network is unavailable.
      }
    }
    try {
      await Promise.all([
        clearSession(),
        clearDeviceSmsState()
      ]);
    } catch {
      // Never keep the React session active because device cleanup failed.
    } finally {
      setAccessToken("");
      setRefreshToken("");
      setPassword("");
      setAuthState("idle");
      setAuthMessage("");
      setActiveTab("home");
      setMobilePanel(null);
      setShowAdvancedTools(false);
      closeDrawer();
    }
  };

  useEffect(() => {
    void loadHealth();
    void refreshSmsPermissionState();
    void refreshSmsBackgroundStatus();
    loadSession()
      .then(async (storedSession) => {
        if (!storedSession) {
          return;
        }

        setUsername(storedSession.username);
        const nativeSession = await getNativeSmsBackgroundSyncSession();
        const sessionToRestore = nativeSession?.username === storedSession.username
          ? { ...storedSession, access: nativeSession.access, refresh: nativeSession.refresh }
          : storedSession;
        try {
          await getCurrentUser(sessionToRestore.access);
          await saveSession({ ...sessionToRestore, username: storedSession.username });
          setAccessToken(sessionToRestore.access);
          setRefreshToken(sessionToRestore.refresh);
          setAuthState("ok");
          setAuthMessage("Session restored.");
        } catch (error) {
          if (error instanceof AuthenticationError) {
            try {
              const tokens = await refreshLogin(sessionToRestore.refresh);
              await saveSession({ ...tokens, username: storedSession.username });
              setAccessToken(tokens.access);
              setRefreshToken(tokens.refresh);
              setAuthState("ok");
              setAuthMessage("Session refreshed.");
              return;
            } catch (refreshError) {
              if (refreshError instanceof AuthenticationError) {
                await clearSession();
                setAuthState("error");
                setAuthMessage("Your previous session expired. Sign in again.");
                return;
              }
            }
          }

          setAccessToken(sessionToRestore.access);
          setRefreshToken(sessionToRestore.refresh);
          setAuthState("ok");
          setAuthMessage("Session restored offline. Sync will resume when the server is available.");
        }
      })
      .catch(() => {
        setAuthState("error");
        setAuthMessage("Could not restore the saved session.");
      })
      .finally(() => setSessionRestoring(false));
    Promise.all([
      AsyncStorage.getItem(accountCacheKey),
      AsyncStorage.getItem(categoryCacheKey)
    ])
      .then(([storedAccounts, storedCategories]) => {
        const cachedAccounts = normalizeAccountCache(storedAccounts);
        const cachedCategories = normalizeCategoryCache(storedCategories);
        setAccounts(cachedAccounts);
        setCategories(cachedCategories);
        if (!txAccountId && cachedAccounts.length > 0) {
          setTxAccountId(cachedAccounts[0].id);
        }
        if (!txCategoryId && cachedCategories.length > 0) {
          setTxCategoryId(cachedCategories[0].id);
        }
      })
      .catch(() => {
        setDataState("error");
        setDataMessage("Could not load local account/category cache.");
      });
    AsyncStorage.getItem(manualTransactionQueueKey)
      .then((storedQueue) => {
        setTransactionQueue(normalizeManualTransactionQueue(storedQueue));
      })
      .catch(() => {
        setTransactionQueueState("error");
        setTransactionQueueMessage("Could not load local transaction queue.");
      });
    AsyncStorage.getItem(transactionCacheKey)
      .then((storedTransactions) => {
        setTransactions(normalizeTransactionCache(storedTransactions));
      })
      .catch(() => {
        setListState("error");
        setListMessage("Could not load local transaction cache.");
      });
    Promise.all([loadSecureSmsQueue(), AsyncStorage.getItem(rawMessageQueueKey)])
      .then(async ([secureQueue, legacyQueue]) => {
        const storedQueue = secureQueue || legacyQueue;
        const normalizedQueue = normalizeRawQueue(storedQueue);
        setRawQueue(normalizedQueue);
        if (!secureQueue && legacyQueue) {
          await saveSecureSmsQueue(JSON.stringify(normalizedQueue));
          await AsyncStorage.removeItem(rawMessageQueueKey);
        }
      })
      .catch(() => {
        setRawQueueState("error");
        setRawQueueMessage("Could not load local raw message queue.");
      });
  }, []);

  useEffect(() => {
    if (!isNativeSmsCaptureAvailable() || !accessToken) return;
    let active = AppState.currentState === "active";
    let disposed = false;
    let reading = false;
    let previous: NativeSmsBackgroundSyncStatus | null = null;
    const readStatus = async () => {
      if (!active || disposed || reading) return;
      reading = true;
      try {
        const [status, storedQueue] = await Promise.all([
          getNativeSmsBackgroundSyncStatus(), loadSecureSmsQueue()
        ]);
        if (!status || disposed || !active) return;
        setSmsBackgroundStatus(status);
        // The native worker now owns migrated app queue records.
        setRawQueue(normalizeRawQueue(storedQueue));
        const finished = previous?.state === "running" && status.state !== "running";
        const completedSinceLastRead = previous !== null && status.state !== "running" && status.importedCount > 0 &&
          status.updatedAt !== previous?.updatedAt;
        if (finished || completedSinceLastRead) {
          void Promise.all([handleLoadReviewCandidates(), handleLoadTransactions()]);
        }
        previous = status;
      } catch {
        // Keep the last known state; manual refresh reports connection failures.
      } finally {
        reading = false;
      }
    };
    void readStatus();
    const timer = setInterval(() => void readStatus(), 1500);
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      if (active) void readStatus();
    });
    return () => { disposed = true; clearInterval(timer); subscription.remove(); };
  }, [accessToken]);

  useEffect(() => {
    configureAuthenticationRecovery(async () => {
      const storedSession = await loadSession();
      if (!storedSession) {
        return null;
      }

      try {
        const nativeSession = await getNativeSmsBackgroundSyncSession();
        const tokens = await refreshLogin(
          nativeSession?.username === storedSession.username ? nativeSession.refresh : storedSession.refresh
        );
        await saveSession({ ...tokens, username: storedSession.username });
        setAccessToken(tokens.access);
        setRefreshToken(tokens.refresh);
        setAuthState("ok");
        setAuthMessage("Session refreshed.");
        return tokens.access;
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await clearSession();
          setAccessToken("");
          setRefreshToken("");
          setAuthState("error");
          setAuthMessage("Your session expired. Sign in again.");
        }
        throw error;
      }
    });

    return () => configureAuthenticationRecovery(null);
  }, []);

  useEffect(() => {
    if (!accessToken.trim()) {
      return;
    }

    void Promise.all([
      handleLoadReferenceData(),
      handleLoadTransactions(),
      handleLoadReviewCandidates(),
      handleLoadSmsSettings()
    ]);
  }, [accessToken]);

  useEffect(() => {
    if (accessToken.trim() && username.trim() && rawQueue.length > 0) {
      void AsyncStorage.setItem(rawMessageQueueOwnerKey, username.trim());
    }
  }, [accessToken, rawQueue.length, username]);

  useEffect(() => {
    if (!accessToken.trim() || !refreshToken.trim() || !username.trim() || !isNativeSmsCaptureAvailable()) {
      return;
    }

    void configureNativeSmsBackgroundSync(
      getApiBaseUrl(),
      accessToken.trim(),
      refreshToken.trim(),
      username.trim()
    )
      .then(() => refreshSmsBackgroundStatus())
      .catch((error) => {
        setSmsBackgroundStatus({
          importedCount: 0,
          message: error instanceof Error ? error.message : "Could not configure background SMS sync.",
          rejectedCount: 0,
          state: "error",
          updatedAt: new Date().toISOString()
        });
      });
  }, [accessToken, refreshToken, username]);

  const openDebts = debts.filter((debt) => debt.status !== "paid");
  const cardAccounts = accounts.filter((account) => account.type === "credit_card");
  const openCardBills = cardBills.filter((bill) => bill.status !== "paid");
  const activeRecurringBills = recurringBills.filter((bill) => bill.status === "active");
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const openDebtTotal = sumMoney(openDebts, (debt) => debt.current_balance);
  const debtDueSoonCount = openDebts.filter((debt) => isDueSoon(debt.due_date)).length;
  const openCardBillTotal = sumMoney(openCardBills, (bill) => bill.remaining_balance);
  const cardBillsDueSoonCount = openCardBills.filter((bill) => isDueSoon(bill.due_date)).length;
  const recurringMonthlyTotal = sumMoney(
    activeRecurringBills.filter((bill) => bill.frequency === "monthly"),
    (bill) => bill.amount
  );
  const recurringDueSoonCount = activeRecurringBills.filter((bill) => isDueSoon(bill.next_due_date)).length;
  const reconciliationDifference = parseMoney(reconciliation?.latest_snapshot?.difference);
  const hasReconciliationDifference =
    reconciliation?.latest_snapshot?.difference !== undefined && reconciliation?.latest_snapshot?.difference !== null;

  const renderAdvancedTools = () => (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.advancedHeader}>
        <Pressable
          accessibilityLabel="Back to Finance Mobile"
          onPress={() => setShowAdvancedTools(false)}
          style={styles.advancedHeaderButton}
        >
          <MaterialCommunityIcons color="#f6f8fc" name="arrow-left" size={22} />
        </Pressable>
        <View>
          <Text style={styles.advancedHeaderTitle}>Finance tools</Text>
          <Text style={styles.advancedHeaderSubtitle}>Detailed records and maintenance</Text>
        </View>
      </View>
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
            onChangeText={setTxTime}
            placeholder="Time (HH:MM)"
            style={styles.input}
            value={txTime}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTxType}
            placeholder="Type (expense/income/transfer...)"
            style={styles.input}
            value={txType}
          />
          {txType.trim() === "transfer" ? <View>
            <Text style={styles.mobileStateText}>Choose debit when this account sends, or credit when it receives.</Text>
            <View style={styles.mobileChoiceRow}>{["debit", "credit"].map((direction) => <Pressable key={direction} onPress={() => setTxDirection(direction)} style={styles.mobileChoice}><Text style={styles.mobileChoiceText}>{txDirection === direction ? "✓ " : ""}{direction}</Text></Pressable>)}</View>
            <Text style={styles.mobileStateText}>Other transfer account</Text>
            {accounts.filter((account) => account.id !== txAccountId).map((account) => <Pressable key={account.id} onPress={() => setTxTransferAccountId(account.id)} style={styles.mobileChoice}><Text style={styles.mobileChoiceText}>{txTransferAccountId === account.id ? "✓ " : ""}{account.name}</Text></Pressable>)}
          </View> : null}
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
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
            onChangeText={setTxBalanceAfter}
            placeholder="Reported balance after (optional)"
            style={styles.input}
            value={txBalanceAfter}
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
                {queuedTransaction.input.balance_after ? (
                  <Text style={styles.meta}>Reported balance after: {queuedTransaction.input.balance_after}</Text>
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
                  {transaction.date}{transaction.time ? ` ${transaction.time.slice(0, 5)}` : ""} | {transaction.type} | {transaction.amount} | {transaction.note || "No note"}
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

          <View style={styles.summaryGrid}>
            <SummaryMetric label="Open debts" value={`${openDebts.length}`} />
            <SummaryMetric label="Outstanding" tone={openDebtTotal > 0 ? "warning" : "success"} value={formatMoney(openDebtTotal)} />
            <SummaryMetric label="Due soon" tone={debtDueSoonCount > 0 ? "warning" : "success"} value={`${debtDueSoonCount}`} />
          </View>

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
                <View key={debt.id} style={styles.compactRecord}>
                  <View style={styles.recordHeader}>
                    <Text style={styles.listTitle}>{debt.counterparty_name}</Text>
                    <StatusPill label={debt.status} tone={debt.status === "paid" ? "success" : "warning"} />
                  </View>
                  <Text style={styles.listItem}>
                    {debt.direction.replaceAll("_", " ")} | {debt.current_balance}
                    {debt.due_date ? ` | due ${debt.due_date}` : ""}
                  </Text>
                </View>
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

          <View style={styles.summaryGrid}>
            <SummaryMetric label="Open bills" value={`${openCardBills.length}`} />
            <SummaryMetric label="Remaining" tone={openCardBillTotal > 0 ? "warning" : "success"} value={formatMoney(openCardBillTotal)} />
            <SummaryMetric label="Due soon" tone={cardBillsDueSoonCount > 0 ? "warning" : "success"} value={`${cardBillsDueSoonCount}`} />
          </View>

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
                <View key={bill.id} style={styles.compactRecord}>
                  <View style={styles.recordHeader}>
                    <Text style={styles.listTitle}>Due {bill.due_date}</Text>
                    <StatusPill label={bill.status} tone={bill.status === "paid" ? "success" : "warning"} />
                  </View>
                  <Text style={styles.listItem}>
                    Statement {bill.statement_date} | remaining {bill.remaining_balance} | minimum {bill.minimum_due}
                  </Text>
                </View>
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

          <View style={styles.summaryGrid}>
            <SummaryMetric label="Active bills" value={`${activeRecurringBills.length}`} />
            <SummaryMetric label="Monthly total" value={formatMoney(recurringMonthlyTotal)} />
            <SummaryMetric label="Due soon" tone={recurringDueSoonCount > 0 ? "warning" : "success"} value={`${recurringDueSoonCount}`} />
          </View>

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
                <View key={bill.id} style={styles.compactRecord}>
                  <View style={styles.recordHeader}>
                    <Text style={styles.listTitle}>{bill.name}</Text>
                    <StatusPill label={bill.status} tone={bill.status === "active" ? "success" : "default"} />
                  </View>
                  <Text style={styles.listItem}>
                    {bill.frequency} | {bill.amount} | next {bill.next_due_date} | reminder {bill.reminder_days_before}d
                  </Text>
                </View>
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
              <View style={styles.summaryGrid}>
                <SummaryMetric label="Expected" value={formatMoney(parseMoney(reconciliation.expected_balance))} />
                <SummaryMetric
                  label="Actual"
                  value={
                    reconciliation.latest_snapshot
                      ? formatMoney(parseMoney(reconciliation.latest_snapshot.actual_balance))
                      : "No snapshot"
                  }
                />
                <SummaryMetric
                  label="Difference"
                  tone={hasReconciliationDifference && reconciliationDifference !== 0 ? "warning" : "success"}
                  value={hasReconciliationDifference ? formatMoney(reconciliationDifference) : "Not checked"}
                />
              </View>
              <View style={styles.recordHeader}>
                <Text style={styles.meta}>Latest status</Text>
                <StatusPill
                  label={reconciliation.latest_snapshot?.status ?? "not checked"}
                  tone={reconciliation.latest_snapshot?.status === "matched" ? "success" : "warning"}
                />
              </View>
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
            <Pressable onPress={() => void handleRequestSmsPermission()} style={styles.buttonSecondary}>
              <Text style={styles.buttonText}>Request Android SMS Permission</Text>
            </Pressable>
          </View>

          <Pressable onPress={handleLoadSmsSettings} style={styles.button}>
            <Text style={styles.buttonText}>Load Payment Methods & Sender Rules</Text>
          </Pressable>
          <Pressable onPress={() => void handleConfigureNativeSmsCapture()} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Sync Native Sender Rules</Text>
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
                const providerExcluded = smsCapturePreference.excluded_providers.includes(rule.provider);
                const isEnabled = enabledSenderRuleIds.includes(rule.id) && !providerExcluded;
                return (
                  <Pressable
                    key={rule.id}
                    disabled={!rule.is_active || providerExcluded || updatingSenderRuleId === rule.id}
                    onPress={() => void handleToggleSenderRule(rule.id)}
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
          <Pressable onPress={() => void handleImportCapturedSmsMessages()} style={styles.buttonSecondary}>
            <Text style={styles.buttonText}>Import Captured SMS</Text>
          </Pressable>

          {rawQueueState === "loading" ? <ActivityIndicator /> : null}
          {rawQueueState === "ok" ? <Text style={styles.okText}>{rawQueueMessage}</Text> : null}
          {rawQueueState === "error" ? <Text style={styles.errorText}>{rawQueueMessage}</Text> : null}

          <View style={styles.listSection}>
            <Text style={styles.listTitle}>{isNativeSmsCaptureAvailable() ? "Messages awaiting handoff" : "Queued Messages"} ({rawQueue.length})</Text>
            {isNativeSmsCaptureAvailable() ? <Text style={styles.meta}>Native SMS upload queue: {pendingSmsCount} pending. Background sync uploads these messages.</Text> : null}
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

                      <Text style={styles.listTitle}>Direction for selected account</Text>
                      <View style={styles.choiceRow}>{["debit", "credit"].map((direction) => <Pressable key={direction} onPress={() => updateReviewDraft(candidate, { direction })} style={draft.direction === direction ? styles.choiceSelected : styles.choice}><Text style={draft.direction === direction ? styles.choiceTextSelected : styles.choiceText}>{direction === "credit" ? "Credit / money received" : "Debit / money sent"}</Text></Pressable>)}</View>
                      <Text style={styles.listTitle}>Account: {accountName(draft.accountId)}</Text>
                      {accounts.length ? (
                        <View style={styles.choiceRow}>
                          {accounts.map((account) => (
                            <Pressable
                              key={account.id}
                              onPress={() => updateReviewDraft(candidate, {
                                accountId: account.id,
                                paymentMethodId: draft.accountId === account.id ? draft.paymentMethodId : ""
                              })}
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
                            Other transfer account: {accountName(draft.transferAccountId)}
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
                        onPress={() => confirmRejectReviewCandidate(candidate)}
                        style={isWorking ? styles.buttonDisabled : styles.buttonDanger}
                      >
                        <Text style={styles.buttonText}>Reject & redact</Text>
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

  if (showAdvancedTools) {
    return renderAdvancedTools();
  }

  const tabItems: Array<{ icon: IconName; key: MainTab; label: string }> = [
    { icon: "home-variant-outline", key: "home", label: "Home" },
    { icon: "format-list-bulleted", key: "activity", label: "Activity" },
    { icon: "message-flash-outline", key: "capture", label: "Capture" },
    { icon: "clipboard-text-outline", key: "review", label: "Review" },
    { icon: "dots-horizontal", key: "more", label: "More" }
  ];
  const drawerItems: Array<{ icon: IconName; label: string }> = [
    { icon: "handshake-outline", label: "Debts & lending" },
    { icon: "credit-card-clock-outline", label: "Credit card bills" },
    { icon: "calendar-sync-outline", label: "Recurring bills" },
    { icon: "scale-balance", label: "Reconciliation" },
    { icon: "message-processing-outline", label: "SMS capture settings" }
  ];
  const primaryCandidate = reviewCandidates[0] ?? null;
  const additionalCandidates = reviewCandidates.slice(1, 3);
  const recentTransactions = transactions.slice(0, 8);

  const renderTransactionRow = (transaction: Transaction) => {
    const isIncome = transaction.type === "income" || transaction.direction === "credit";
    const icon: IconName = transaction.type === "transfer" ? "swap-horizontal" : isIncome ? "bank-transfer-in" : "cart-outline";
    const title = transaction.type === "transfer" ? `${accountName(transaction.account)} → ${accountName(transaction.transfer_account)}` : transaction.counterparty_text || transaction.note || titleCase(transaction.type);

    return (
      <View key={transaction.id} style={styles.mobileListRow}>
        <View style={[styles.mobileRowIcon, isIncome ? styles.mobileRowIconSuccess : null]}>
          <MaterialCommunityIcons color={isIncome ? "#55e6a5" : "#75b8ff"} name={icon} size={21} />
        </View>
        <View style={styles.mobileRowBody}>
          <Text numberOfLines={1} style={styles.mobileRowTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.mobileRowMeta}>
            {formatMobileDate(transaction.date)}{transaction.time ? ` at ${transaction.time.slice(0, 5)}` : ""} · {transaction.source || "Ledger"}
          </Text>
          {transaction.type === "transfer" ? transaction.transfer_evidence?.map((item) => <Text key={item.id} style={styles.mobileRowMeta}>{accountName(item.account)} · {item.direction}{item.reference ? ` · ${item.reference}` : ""}{item.balance_after !== null ? ` · balance ${item.balance_after}` : ""}</Text>) : null}
        </View>
        <Text style={[styles.mobileRowAmount, isIncome ? styles.mobileRowAmountSuccess : null]}>
          {transaction.type === "transfer" ? "↔" : isIncome ? "+" : "−"} {formatMoney(parseMoney(transaction.amount))}
        </Text>
      </View>
    );
  };

  const renderCompactCandidate = (candidate: ParsedMessageCandidate) => {
    const confidence = confidencePercent(candidate.confidence);
    const confidenceScore = Number(candidate.confidence);
    const isLowConfidence = Number.isFinite(confidenceScore) && confidenceScore < 0.8;
    return (
      <Pressable
        key={candidate.id}
        onPress={() => switchTab("review")}
        style={({ pressed }) => [styles.mobileQueueRow, pressed ? styles.mobilePressed : null]}
      >
        <View style={styles.mobileProviderIcon}>
          <MaterialCommunityIcons color="#32d8f2" name="message-text-outline" size={21} />
        </View>
        <View style={styles.mobileRowBody}>
          <Text style={styles.mobileRowTitle}>{candidate.provider || candidate.raw_message.sender}</Text>
          <Text numberOfLines={1} style={styles.mobileRowMeta}>
            {candidate.counterparty_text || titleCase(candidate.transaction_type)}
          </Text>
          <Text style={styles.mobileQueueAmount}>{formatMoney(parseMoney(candidate.amount))}</Text>
        </View>
        <View style={styles.mobileQueueAside}>
          <Text style={[styles.mobileConfidence, isLowConfidence ? styles.mobileConfidenceWarning : null]}>
            {confidence}
          </Text>
          <MaterialCommunityIcons color="#91a7c2" name="chevron-right" size={24} />
        </View>
      </Pressable>
    );
  };

  const renderHome = () => (
    <View style={styles.mobileSectionStack}>
      <View style={styles.mobileSegmentedControl}>
        <Pressable
          onPress={() => setHomeFeed("review")}
          style={[styles.mobileSegment, homeFeed === "review" ? styles.mobileSegmentActive : null]}
        >
          <MaterialCommunityIcons color={homeFeed === "review" ? "#06141f" : "#9eb0c7"} name="clipboard-text-outline" size={20} />
          <Text style={[styles.mobileSegmentText, homeFeed === "review" ? styles.mobileSegmentTextActive : null]}>
            To review ({reviewCandidates.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setHomeFeed("captured")}
          style={[styles.mobileSegment, homeFeed === "captured" ? styles.mobileSegmentActive : null]}
        >
          <MaterialCommunityIcons color={homeFeed === "captured" ? "#06141f" : "#9eb0c7"} name="format-list-bulleted" size={20} />
          <Text style={[styles.mobileSegmentText, homeFeed === "captured" ? styles.mobileSegmentTextActive : null]}>
            Captured ({transactions.length})
          </Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => switchTab("capture")}
        style={({ pressed }) => [styles.mobileScanBanner, pressed ? styles.mobilePressed : null]}
      >
        <MaterialCommunityIcons color="#55e6a5" name="message-flash-outline" size={22} />
        <View style={styles.mobileRowBody}>
          <Text style={styles.mobileScanBannerTitle}>Scan phone messages</Text>
          <Text style={styles.mobileScanBannerMeta}>
            {pendingSmsCount ? `${pendingSmsCount} message(s) waiting to sync` : "Find new and historical transactions"}
          </Text>
        </View>
        <MaterialCommunityIcons color="#32d8f2" name="chevron-right" size={23} />
      </Pressable>

      {homeFeed === "review" ? (
        <>
          {reviewState === "loading" && !primaryCandidate ? (
            <View style={styles.mobileCenteredState}>
              <ActivityIndicator color="#32d8f2" />
              <Text style={styles.mobileStateText}>Checking captured messages…</Text>
            </View>
          ) : primaryCandidate ? (
            <View style={styles.mobileHeroCard}>
              <View style={styles.mobileHeroHeader}>
                <View style={styles.mobileProviderIconLarge}>
                  <MaterialCommunityIcons color="#32d8f2" name="wallet-outline" size={28} />
                </View>
                <View style={styles.mobileRowBody}>
                  <Text style={styles.mobileHeroProvider}>{primaryCandidate.provider || primaryCandidate.raw_message.sender}</Text>
                  <Text style={styles.mobileHeroDate}>{formatMobileDate(primaryCandidate.raw_message.received_at)}</Text>
                </View>
                <View style={styles.mobileConfidenceBlock}>
                  <Text style={styles.mobileConfidenceLarge}>{confidencePercent(primaryCandidate.confidence)}</Text>
                  <Text style={styles.mobileConfidenceLabel}>confidence</Text>
                </View>
              </View>
              <Text style={styles.mobileHeroAmount}>{formatMoney(parseMoney(primaryCandidate.amount))}</Text>
              <Text style={styles.mobileHeroDescription}>
                {primaryCandidate.counterparty_text || titleCase(primaryCandidate.transaction_type)}
              </Text>
              <View style={styles.mobileSuggestionRow}>
                <MaterialCommunityIcons color="#91a7c2" name="tag-outline" size={18} />
                <Text style={styles.mobileSuggestionText}>
                  {titleCase(primaryCandidate.transaction_type)} · {accountName(primaryCandidate.account)}
                </Text>
              </View>
              <View style={styles.mobileSmsQuote}>
                <MaterialCommunityIcons color="#91a7c2" name="message-processing-outline" size={20} />
                <Text numberOfLines={3} style={styles.mobileSmsQuoteText}>{primaryCandidate.raw_message.body}</Text>
              </View>
              <View style={styles.mobileActionRow}>
                <Pressable
                  disabled={reviewActionCandidateId === primaryCandidate.id}
                  onPress={() => void handleConfirmReviewCandidate(primaryCandidate)}
                  style={({ pressed }) => [styles.mobilePrimaryButton, pressed ? styles.mobilePressed : null]}
                >
                  {reviewActionCandidateId === primaryCandidate.id ? (
                    <ActivityIndicator color="#06141f" />
                  ) : (
                    <MaterialCommunityIcons color="#06141f" name="check" size={22} />
                  )}
                  <Text style={styles.mobilePrimaryButtonText}>Confirm</Text>
                </Pressable>
                <Pressable
                  onPress={() => switchTab("review")}
                  style={({ pressed }) => [styles.mobileOutlineButton, pressed ? styles.mobilePressed : null]}
                >
                  <MaterialCommunityIcons color="#dce8f6" name="pencil-outline" size={20} />
                  <Text style={styles.mobileOutlineButtonText}>Edit</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.mobileEmptyState}>
              <View style={styles.mobileEmptyIcon}>
                <MaterialCommunityIcons color="#55e6a5" name="check-decagram-outline" size={34} />
              </View>
              <Text style={styles.mobileEmptyTitle}>Inbox clear</Text>
              <Text style={styles.mobileEmptyCopy}>New SMS transactions that need your attention will appear here.</Text>
              <Pressable onPress={handleLoadReviewCandidates} style={styles.mobileTextButton}>
                <Text style={styles.mobileTextButtonText}>Check again</Text>
              </Pressable>
            </View>
          )}

          {additionalCandidates.length ? (
            <View style={styles.mobileSection}>
              <View style={styles.mobileSectionHeader}>
                <Text style={styles.mobileSectionTitle}>More to review</Text>
                <Text style={styles.mobileSectionMeta}>Oldest first</Text>
              </View>
              <View style={styles.mobileGroupedList}>{additionalCandidates.map(renderCompactCandidate)}</View>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.mobileSection}>
          <View style={styles.mobileSectionHeader}>
            <Text style={styles.mobileSectionTitle}>Captured activity</Text>
            <Pressable onPress={handleLoadTransactions} style={styles.mobileIconAction}>
              <MaterialCommunityIcons color="#32d8f2" name="refresh" size={20} />
            </Pressable>
          </View>
          {recentTransactions.length ? (
            <View style={styles.mobileGroupedList}>{recentTransactions.slice(0, 5).map(renderTransactionRow)}</View>
          ) : (
            <Text style={styles.mobileStateText}>No captured transactions yet.</Text>
          )}
        </View>
      )}
    </View>
  );

  const renderActivity = () => (
    <View style={styles.mobileSectionStack}>
      <View style={styles.mobilePageIntro}>
        <Text style={styles.mobilePageTitle}>Activity</Text>
        <Text style={styles.mobilePageSubtitle}>Your imported and manually recorded ledger entries.</Text>
      </View>
      <View style={styles.mobileSummaryStrip}>
        <View>
          <Text style={styles.mobileSummaryValue}>{transactions.length}</Text>
          <Text style={styles.mobileSummaryLabel}>captured</Text>
        </View>
        <View style={styles.mobileSummaryDivider} />
        <View style={styles.mobileRowBody}>
          <Text style={styles.mobileSummaryValue}>{transactionQueue.length}</Text>
          <Text style={styles.mobileSummaryLabel}>manual pending</Text>
        </View>
        <Pressable onPress={handleLoadTransactions} style={styles.mobileIconAction}>
          <MaterialCommunityIcons color="#32d8f2" name="refresh" size={20} />
        </Pressable>
      </View>
      <InlineFeedback loadingLabel="Refreshing activity…" message={listMessage} state={listState} />
      {recentTransactions.length ? (
        <View style={styles.mobileGroupedList}>{recentTransactions.map(renderTransactionRow)}</View>
      ) : (
        <View style={styles.mobileEmptyState}>
          <Text style={styles.mobileEmptyTitle}>No activity yet</Text>
          <Text style={styles.mobileEmptyCopy}>Imported SMS transactions will build your timeline automatically.</Text>
        </View>
      )}
      <Pressable onPress={() => setShowAdvancedTools(true)} style={styles.mobileSecondaryAction}>
        <MaterialCommunityIcons color="#dce8f6" name="plus" size={20} />
        <Text style={styles.mobileSecondaryActionText}>Add a manual transaction</Text>
      </Pressable>
    </View>
  );

  const renderReview = () => (
    <View style={styles.mobileSectionStack}>
      <View style={styles.mobilePageIntro}>
        <Text style={styles.mobilePageTitle}>Review inbox</Text>
        <Text style={styles.mobilePageSubtitle}>Verify uncertain fields before they enter your ledger.</Text>
      </View>
      <Pressable onPress={handleLoadReviewCandidates} style={styles.mobileSecondaryAction}>
        <MaterialCommunityIcons color="#32d8f2" name="refresh" size={20} />
        <Text style={styles.mobileSecondaryActionText}>Refresh inbox</Text>
      </Pressable>
      <InlineFeedback loadingLabel="Refreshing review inbox…" message={reviewMessage} state={reviewState} />
      {reviewCandidates.length ? (() => {
        const candidate = reviewCandidates[Math.min(reviewCandidateIndex, reviewCandidates.length - 1)] ?? reviewCandidates[0];
        const draft = getReviewDraft(candidate);
        const isWorking = reviewActionCandidateId === candidate.id;
        return (
          <>
          <View style={styles.mobileReviewPager}>
            <Pressable
              accessibilityLabel="Previous message"
              disabled={reviewCandidateIndex === 0}
              onPress={() => setReviewCandidateIndex((current) => Math.max(0, current - 1))}
              style={styles.mobileIconAction}
            >
              <MaterialCommunityIcons color={reviewCandidateIndex === 0 ? "#50647e" : "#32d8f2"} name="chevron-left" size={23} />
            </Pressable>
            <View style={styles.mobileRowBody}>
              <Text style={styles.mobileRowTitle}>Message {reviewCandidateIndex + 1} of {reviewCandidates.length}</Text>
              <Text style={styles.mobileRowMeta}>Confirm or reject before moving on</Text>
            </View>
            <Pressable
              accessibilityLabel="Next message"
              disabled={reviewCandidateIndex >= reviewCandidates.length - 1}
              onPress={() => setReviewCandidateIndex((current) => Math.min(reviewCandidates.length - 1, current + 1))}
              style={styles.mobileIconAction}
            >
              <MaterialCommunityIcons color={reviewCandidateIndex >= reviewCandidates.length - 1 ? "#50647e" : "#32d8f2"} name="chevron-right" size={23} />
            </Pressable>
          </View>
          <View key={candidate.id} style={styles.mobileReviewCard}>
            <View style={styles.mobileHeroHeader}>
              <View style={styles.mobileProviderIcon}>
                <MaterialCommunityIcons color="#32d8f2" name="message-text-outline" size={21} />
              </View>
              <View style={styles.mobileRowBody}>
                <Text style={styles.mobileRowTitle}>{candidate.provider || candidate.raw_message.sender}</Text>
                <Text style={styles.mobileRowMeta}>{formatMobileDate(candidate.raw_message.received_at)}</Text>
              </View>
              <Text style={styles.mobileConfidence}>{confidencePercent(candidate.confidence)}</Text>
            </View>
            <Text style={styles.mobileReviewAmount}>{formatMoney(parseMoney(candidate.amount))}</Text>
            <Text numberOfLines={3} style={styles.mobileSmsQuoteText}>{candidate.raw_message.body}</Text>

            <View style={styles.mobileRangeRow}>
              <View style={styles.mobileRangeField}>
                <Text style={styles.mobileFieldLabel}>Amount</Text>
                <View style={styles.mobileInputWrap}>
                  <MaterialCommunityIcons color="#7890ad" name="cash" size={19} />
                  <TextInput
                    accessibilityLabel="Transaction amount"
                    keyboardType="decimal-pad"
                    onChangeText={(amount) => updateReviewDraft(candidate, { amount })}
                    placeholder="0.00"
                    placeholderTextColor="#5f7590"
                    style={styles.mobileInput}
                    value={draft.amount}
                  />
                </View>
              </View>
              <View style={styles.mobileRangeField}>
                <Text style={styles.mobileFieldLabel}>Date</Text>
                <View style={styles.mobileInputWrap}>
                  <MaterialCommunityIcons color="#7890ad" name="calendar-outline" size={19} />
                  <TextInput
                    accessibilityLabel="Transaction date in year month day format"
                    autoCapitalize="none"
                    onChangeText={(date) => updateReviewDraft(candidate, { date })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#5f7590"
                    style={styles.mobileInput}
                    value={draft.date}
                  />
                </View>
              </View>
            </View>

            <Text style={styles.mobileFieldLabel}>Transaction time</Text>
            <View style={styles.mobileInputWrap}>
              <MaterialCommunityIcons color="#7890ad" name="clock-outline" size={19} />
              <TextInput
                accessibilityLabel="Transaction time in hour minute format"
                autoCapitalize="none"
                onChangeText={(time) => updateReviewDraft(candidate, { time })}
                placeholder="HH:MM"
                placeholderTextColor="#5f7590"
                style={styles.mobileInput}
                value={draft.time}
              />
            </View>

            <Text style={styles.mobileFieldLabel}>Transaction type</Text>
            <View style={styles.mobileChoiceRow}>
              {["expense", "income", "transfer", "fee", "refund"].map((type) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.transactionType === type }}
                  key={type}
                  onPress={() => updateReviewDraft(candidate, {
                    transactionType: type,
                    transferAccountId: type === "transfer" ? draft.transferAccountId : ""
                  })}
                  style={[styles.mobileChoice, draft.transactionType === type ? styles.mobileChoiceActive : null]}
                >
                  <Text style={[styles.mobileChoiceText, draft.transactionType === type ? styles.mobileChoiceTextActive : null]}>
                    {titleCase(type)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.mobileFieldLabel}>Direction for selected account</Text>
            <View style={styles.mobileChoiceRow}>{["debit", "credit"].map((direction) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: draft.direction === direction }} key={direction} onPress={() => updateReviewDraft(candidate, { direction })} style={[styles.mobileChoice, draft.direction === direction ? styles.mobileChoiceActive : null]}><Text style={[styles.mobileChoiceText, draft.direction === direction ? styles.mobileChoiceTextActive : null]}>{direction === "credit" ? "Credit / money received" : "Debit / money sent"}</Text></Pressable>)}</View>
            <Text style={styles.mobileRowMeta}>For transfers, credit receives from the other account; debit sends to it.</Text>
            <Text style={styles.mobileFieldLabel}>Account</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.mobileChoiceRow}>
                {accounts.map((account) => (
                  <Pressable
                    key={account.id}
                    onPress={() => updateReviewDraft(candidate, {
                      accountId: account.id,
                      paymentMethodId: draft.accountId === account.id ? draft.paymentMethodId : ""
                    })}
                    style={[styles.mobileChoice, draft.accountId === account.id ? styles.mobileChoiceActive : null]}
                  >
                    <Text style={[styles.mobileChoiceText, draft.accountId === account.id ? styles.mobileChoiceTextActive : null]}>
                      {account.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {draft.transactionType === "transfer" ? (
              <>
                <Text style={styles.mobileFieldLabel}>Other transfer account</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.mobileChoiceRow}>
                    {accounts.filter((account) => account.id !== draft.accountId).map((account) => (
                      <Pressable
                        key={account.id}
                        onPress={() => updateReviewDraft(candidate, { transferAccountId: account.id })}
                        style={[styles.mobileChoice, draft.transferAccountId === account.id ? styles.mobileChoiceActive : null]}
                      >
                        <Text style={[styles.mobileChoiceText, draft.transferAccountId === account.id ? styles.mobileChoiceTextActive : null]}>
                          {account.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            ) : null}

            <Text style={styles.mobileFieldLabel}>Payment method</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.mobileChoiceRow}>
                <Pressable
                  onPress={() => updateReviewDraft(candidate, { paymentMethodId: "" })}
                  style={[styles.mobileChoice, !draft.paymentMethodId ? styles.mobileChoiceActive : null]}
                >
                  <Text style={[styles.mobileChoiceText, !draft.paymentMethodId ? styles.mobileChoiceTextActive : null]}>None</Text>
                </Pressable>
                {paymentMethods.filter((method) => method.account === draft.accountId).map((method) => (
                  <Pressable
                    key={method.id}
                    onPress={() => updateReviewDraft(candidate, { paymentMethodId: method.id })}
                    style={[styles.mobileChoice, draft.paymentMethodId === method.id ? styles.mobileChoiceActive : null]}
                  >
                    <Text style={[styles.mobileChoiceText, draft.paymentMethodId === method.id ? styles.mobileChoiceTextActive : null]}>
                      {method.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.mobileFieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.mobileChoiceRow}>
                <Pressable
                  onPress={() => updateReviewDraft(candidate, { categoryId: "" })}
                  style={[styles.mobileChoice, !draft.categoryId ? styles.mobileChoiceActive : null]}
                >
                  <Text style={[styles.mobileChoiceText, !draft.categoryId ? styles.mobileChoiceTextActive : null]}>None</Text>
                </Pressable>
                {categories.map((category) => (
                  <Pressable
                    key={category.id}
                    onPress={() => updateReviewDraft(candidate, { categoryId: category.id })}
                    style={[styles.mobileChoice, draft.categoryId === category.id ? styles.mobileChoiceActive : null]}
                  >
                    <Text style={[styles.mobileChoiceText, draft.categoryId === category.id ? styles.mobileChoiceTextActive : null]}>
                      {category.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={styles.mobileInputWrap}>
              <MaterialCommunityIcons color="#7890ad" name="store-outline" size={19} />
              <TextInput
                accessibilityLabel="Counterparty or merchant"
                onChangeText={(counterpartyText) => updateReviewDraft(candidate, { counterpartyText })}
                placeholder="Counterparty or merchant"
                placeholderTextColor="#5f7590"
                style={styles.mobileInput}
                value={draft.counterpartyText}
              />
            </View>
            <View style={styles.mobileInputWrap}>
              <MaterialCommunityIcons color="#7890ad" name="identifier" size={19} />
              <TextInput
                accessibilityLabel="Transaction reference"
                onChangeText={(reference) => updateReviewDraft(candidate, { reference })}
                placeholder="Reference"
                placeholderTextColor="#5f7590"
                style={styles.mobileInput}
                value={draft.reference}
              />
            </View>
            <View style={styles.mobileInputWrap}>
              <MaterialCommunityIcons color="#7890ad" name="note-text-outline" size={19} />
              <TextInput
                accessibilityLabel="Transaction note"
                onChangeText={(note) => updateReviewDraft(candidate, { note })}
                placeholder="Note (optional)"
                placeholderTextColor="#5f7590"
                style={styles.mobileInput}
                value={draft.note}
              />
            </View>
            <View style={styles.mobileActionRow}>
              <Pressable
                disabled={isWorking}
                onPress={() => void handleConfirmReviewCandidate(candidate)}
                style={styles.mobilePrimaryButton}
              >
                {isWorking ? <ActivityIndicator color="#06141f" /> : <MaterialCommunityIcons color="#06141f" name="check" size={21} />}
                <Text style={styles.mobilePrimaryButtonText}>Confirm</Text>
              </Pressable>
              <Pressable
                disabled={isWorking}
                onPress={() => confirmRejectReviewCandidate(candidate)}
                style={styles.mobileOutlineButton}
              >
                <Text style={styles.mobileOutlineButtonText}>Reject</Text>
              </Pressable>
            </View>
          </View>
          </>
        );
      })() : (
        <View style={styles.mobileEmptyState}>
          <Text style={styles.mobileEmptyTitle}>Nothing to review</Text>
          <Text style={styles.mobileEmptyCopy}>No captured messages currently require a decision.</Text>
        </View>
      )}
    </View>
  );

  const renderAccounts = () => (
    <View style={styles.mobileSectionStack}>
      <View style={styles.mobilePageIntro}>
        <Text style={styles.mobilePageTitle}>Accounts</Text>
        <Text style={styles.mobilePageSubtitle}>The bank and wallet accounts connected to your ledger.</Text>
      </View>
      <Pressable onPress={handleLoadReferenceData} style={styles.mobileSecondaryAction}>
        <MaterialCommunityIcons color="#32d8f2" name="refresh" size={20} />
        <Text style={styles.mobileSecondaryActionText}>Refresh accounts</Text>
      </Pressable>
      <InlineFeedback loadingLabel="Refreshing accounts…" message={dataMessage} state={dataState} />
      <View style={styles.mobileGroupedList}>
        {accounts.map((account) => (
          <View key={account.id} style={styles.mobileAccountRow}>
            <View style={styles.mobileProviderIcon}>
              <MaterialCommunityIcons
                color="#55e6a5"
                name={account.type === "credit_card" ? "credit-card-outline" : account.type === "cash" ? "cash" : "bank-outline"}
                size={22}
              />
            </View>
            <View style={styles.mobileRowBody}>
              <Text style={styles.mobileRowTitle}>{account.name}</Text>
              <Text style={styles.mobileRowMeta}>{titleCase(account.type)}</Text>
            </View>
            <View style={styles.mobileConnectedBadge}>
              <View style={styles.mobileConnectedDot} />
              <Text style={styles.mobileConnectedText}>Active</Text>
            </View>
          </View>
        ))}
      </View>
      {!accounts.length ? <Text style={styles.mobileStateText}>No accounts loaded yet.</Text> : null}
    </View>
  );

  const renderSmsAutomation = () => {
    const canReadSms = smsPermissionState === "granted";
    const enabledRules = senderRules.filter(
      (rule) =>
        rule.is_active
        && enabledSenderRuleIds.includes(rule.id)
        && !smsCapturePreference.excluded_providers.includes(rule.provider)
    );
    const existingExactSenders = new Set(
      senderRules
        .filter((rule) => rule.match_type === "exact")
        .map((rule) => rule.sender.trim().toLowerCase())
    );
    const normalizedSenderSearch = smsSenderSearch.trim().toLowerCase();
    const visibleInboxSenders = smsInboxSenders
      .filter((item) => !normalizedSenderSearch || item.sender.toLowerCase().includes(normalizedSenderSearch))
      .slice(0, 30);
    const setupSteps = [
      { complete: Boolean(accessToken.trim()), label: "Finance account connected" },
      { complete: canReadSms, label: "SMS permission allowed" },
      { complete: enabledRules.length > 0, label: "At least one sender enabled" },
      { complete: Boolean(smsBackgroundStatus?.updatedAt), label: "First scan completed" }
    ];
    const completedSetupSteps = setupSteps.filter((step) => step.complete).length;

    return (
      <View style={styles.mobileSectionStack}>
        {mobilePanel ? (
          <Pressable onPress={() => setMobilePanel(null)} style={styles.mobileBackAction}>
            <MaterialCommunityIcons color="#32d8f2" name="arrow-left" size={22} />
            <Text style={styles.mobileBackActionText}>More</Text>
          </Pressable>
        ) : null}
        <View style={styles.mobilePageIntro}>
          <Text style={styles.mobilePageTitle}>SMS automation</Text>
          <Text style={styles.mobilePageSubtitle}>
            Scan old and new bank messages, skip anything already processed, and send new matches to review.
          </Text>
        </View>

        <View style={styles.mobileAutomationHero}>
          <View style={styles.mobileAutomationIcon}>
            <MaterialCommunityIcons color="#06141f" name="message-flash-outline" size={30} />
          </View>
          <View style={styles.mobileRowBody}>
            <Text style={styles.mobileAutomationTitle}>Your inbox stays private</Text>
            <Text style={styles.mobileAutomationCopy}>
              Only messages matching senders you enable are added to the finance queue.
            </Text>
          </View>
        </View>

        <View style={styles.mobileSetupProgress}>
          <View style={styles.mobileSectionHeader}>
            <View>
              <Text style={styles.mobileSetupTitle}>Setup progress</Text>
              <Text style={styles.mobileRowMeta}>{completedSetupSteps} of {setupSteps.length} ready</Text>
            </View>
            <View style={styles.mobileSetupCount}>
              <Text style={styles.mobileSetupCountText}>{completedSetupSteps}/{setupSteps.length}</Text>
            </View>
          </View>
          <View style={styles.mobileSetupList}>
            {setupSteps.map((step) => (
              <View key={step.label} style={styles.mobileSetupStep}>
                <MaterialCommunityIcons
                  color={step.complete ? "#55e6a5" : "#7890ad"}
                  name={step.complete ? "check-circle" : "circle-outline"}
                  size={19}
                />
                <Text style={[styles.mobileSetupStepText, step.complete ? styles.mobileSetupStepTextDone : null]}>
                  {step.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.mobileSection}>
          <View style={styles.mobileSectionHeader}>
            <Text style={styles.mobileSectionTitle}>Automatic sync</Text>
            <Text style={styles.mobileSectionMeta}>{smsBackgroundStatus?.state ?? "idle"}</Text>
          </View>
          <Text style={styles.mobileStateText}>
            {smsBackgroundStatus?.message ?? "New trusted SMS messages will upload when a network is available."}
          </Text>
          {smsBackgroundStatus?.updatedAt ? (
            <Text style={styles.mobileRowMeta}>Last update {formatMobileDate(smsBackgroundStatus.updatedAt)}</Text>
          ) : null}
          <Pressable
            disabled={smsBackgroundStatus?.state === "running"}
            onPress={() => void handleRetrySmsBackgroundSync()}
            style={({ pressed }) => [styles.mobileSecondaryAction, pressed ? styles.mobilePressed : null]}
          >
            <MaterialCommunityIcons color="#32d8f2" name="cloud-sync-outline" size={21} />
            <Text style={styles.mobileSecondaryActionText}>
              {smsBackgroundStatus?.state === "running" ? "Sync queued…" : "Retry background sync"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.mobileSection}>
          <View style={styles.mobileSectionHeader}>
            <Text style={styles.mobileSectionTitle}>1. SMS permission</Text>
            <View style={[styles.mobileStatusChip, canReadSms ? styles.mobileStatusChipSuccess : null]}>
              <Text style={[styles.mobileStatusChipText, canReadSms ? styles.mobileStatusChipTextSuccess : null]}>
                {canReadSms ? "Allowed" : "Required"}
              </Text>
            </View>
          </View>
          <Text style={styles.mobileStateText}>{smsPermissionMessage}</Text>
          <Pressable
            onPress={() => void handleRequestSmsPermission()}
            style={({ pressed }) => [styles.mobileSecondaryAction, pressed ? styles.mobilePressed : null]}
          >
            <MaterialCommunityIcons color="#32d8f2" name="shield-key-outline" size={21} />
            <Text style={styles.mobileSecondaryActionText}>{canReadSms ? "Check permission again" : "Allow SMS access"}</Text>
          </Pressable>
        </View>

        <View style={styles.mobileSection}>
          <View style={styles.mobileSectionHeader}>
            <Text style={styles.mobileSectionTitle}>2. Capture policy</Text>
            <Text style={styles.mobileSectionMeta}>Server enforced</Text>
          </View>
          <Text style={styles.mobileStateText}>
            Excluded messages keep only a private duplicate-check ID so they are not uploaded again. Their SMS text is not stored by the server.
          </Text>
          <Text style={styles.mobileFieldLabel}>Providers</Text>
          <View style={styles.mobilePolicyChoices}>
            {smsProviderOptions.map((provider) => {
              const excluded = smsCapturePreference.excluded_providers.includes(provider.value);
              const captureKey = `provider:${provider.value}`;
              return (
                <ChoicePressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: !excluded }}
                  disabled={Boolean(updatingCaptureKey)}
                  key={provider.value}
                  onPress={() => void handleToggleCaptureExclusion("provider", provider.value)}
                  style={[styles.mobileChoice, styles.mobilePolicyChoice, !excluded ? styles.mobileChoiceActive : null]}
                >
                  <Text style={[styles.mobileChoiceText, styles.mobilePolicyChoiceText, !excluded ? styles.mobileChoiceTextActive : null]}>
                    {updatingCaptureKey === captureKey ? "Updating…" : `${provider.label} · ${excluded ? "Excluded" : "Tracking"}`}
                  </Text>
                </ChoicePressable>
              );
            })}
          </View>
          <Text style={styles.mobileFieldLabel}>Non-transaction messages</Text>
          <View style={styles.mobilePolicyChoices}>
            {["otp_or_security", "balance_notice", "promotional"].map((messageKind) => {
              const excluded = smsCapturePreference.excluded_message_kinds.includes(messageKind);
              const captureKey = `message_kind:${messageKind}`;
              return (
                <ChoicePressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: !excluded }}
                  disabled={Boolean(updatingCaptureKey)}
                  key={messageKind}
                  onPress={() => void handleToggleCaptureExclusion("message_kind", messageKind)}
                  style={[styles.mobileChoice, styles.mobilePolicyChoice, !excluded ? styles.mobileChoiceActive : null]}
                >
                  <Text style={[styles.mobileChoiceText, styles.mobilePolicyChoiceText, !excluded ? styles.mobileChoiceTextActive : null]}>
                    {updatingCaptureKey === captureKey ? "Updating…" : `${titleCase(messageKind)} · ${excluded ? "Excluded" : "Allowed"}`}
                  </Text>
                </ChoicePressable>
              );
            })}
          </View>
          <Text style={styles.mobileFieldLabel}>Original SMS retention after confirmation</Text>
          <View style={styles.mobilePolicyChoices}>
            {[
              { label: "Remove now", value: 0 },
              { label: "7 days", value: 7 },
              { label: "30 days", value: 30 },
              { label: "Keep", value: null }
            ].map((option) => {
              const selected = smsCapturePreference.raw_sms_retention_days === option.value;
              return (
                <ChoicePressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  disabled={Boolean(updatingCaptureKey)}
                  key={option.label}
                  onPress={() => void handleUpdateSmsRetention(option.value)}
                  style={[styles.mobileChoice, styles.mobilePolicyChoice, selected ? styles.mobileChoiceActive : null]}
                >
                  <Text style={[styles.mobileChoiceText, styles.mobilePolicyChoiceText, selected ? styles.mobileChoiceTextActive : null]}>
                    {updatingCaptureKey === "retention" && selected ? "Updating…" : option.label}
                  </Text>
                </ChoicePressable>
              );
            })}
          </View>
          <Text style={styles.mobileRowMeta}>
            Parsed amount, date, provider, and duplicate-check data remain after the original text is removed.
          </Text>
        </View>

        <View style={styles.mobileSection}>
          <View style={styles.mobileSectionHeader}>
            <Text style={styles.mobileSectionTitle}>3. Trusted senders</Text>
            <Text style={styles.mobileSectionMeta}>{enabledRules.length} enabled</Text>
          </View>
          <Text style={styles.mobileStateText}>
            Tap a sender to switch between Tracking and Excluded. Excluded senders stay on the phone and never enter the upload queue.
          </Text>
          <InlineFeedback loadingLabel="Loading sender rules…" message={smsSettingsMessage} state={smsSettingsState} />
          {senderRules.length ? (
            <View style={styles.mobileGroupedList}>
              {senderRules.map((rule) => {
                const providerExcluded = smsCapturePreference.excluded_providers.includes(rule.provider);
                const isEnabled = enabledSenderRuleIds.includes(rule.id) && !providerExcluded;
                return (
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isEnabled }}
                    key={rule.id}
                    disabled={providerExcluded || !rule.is_active || updatingSenderRuleId === rule.id}
                    onPress={() => void handleToggleSenderRule(rule.id)}
                    style={({ pressed }) => [styles.mobileMenuRow, pressed ? styles.mobilePressed : null]}
                  >
                    <View style={styles.mobileProviderIcon}>
                      <MaterialCommunityIcons color="#55e6a5" name="bank-outline" size={21} />
                    </View>
                    <View style={styles.mobileRowBody}>
                      <Text style={styles.mobileRowTitle}>{rule.name || rule.sender}</Text>
                      <Text style={styles.mobileRowMeta}>{rule.sender} · {titleCase(rule.provider)} · {titleCase(rule.match_type)}</Text>
                    </View>
                    <View style={styles.mobileRuleDecision}>
                      {updatingSenderRuleId === rule.id ? <ActivityIndicator color="#32d8f2" size="small" /> : null}
                      <Text style={[styles.mobileRuleDecisionText, isEnabled ? styles.mobileRuleDecisionTextActive : null]}>
                        {providerExcluded
                          ? "Provider excluded"
                          : !rule.is_active
                          ? "Inactive"
                          : updatingSenderRuleId === rule.id
                            ? "Updating"
                            : isEnabled
                              ? "Tracking"
                              : "Excluded"}
                      </Text>
                      <View style={[styles.mobileToggle, isEnabled ? styles.mobileToggleActive : null]}>
                        <View style={[styles.mobileToggleKnob, isEnabled ? styles.mobileToggleKnobActive : null]} />
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View style={styles.mobileEmptyState}>
              <Text style={styles.mobileEmptyTitle}>No sender rules loaded</Text>
              <Text style={styles.mobileEmptyCopy}>
                Load rules for {username || "this account"}. If the server returns zero, confirm the web and mobile logins use the same user.
              </Text>
              <Pressable
                disabled={smsSettingsState === "loading"}
                onPress={handleLoadSmsSettings}
                style={({ pressed }) => [styles.mobileTextButton, pressed ? styles.mobilePressed : null]}
              >
                {smsSettingsState === "loading" ? <ActivityIndicator color="#32d8f2" size="small" /> : null}
                <Text style={styles.mobileTextButtonText}>
                  {smsSettingsState === "loading" ? "Loading…" : "Load sender rules"}
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.mobileSubsection}>
            <View style={styles.mobileSectionHeader}>
              <View style={styles.mobileRowBody}>
                <Text style={styles.mobileRowTitle}>Add a sender from this phone</Text>
                <Text style={styles.mobileRowMeta}>Only sender names and counts are shown here—message text stays hidden.</Text>
              </View>
              <Pressable
                accessibilityLabel="Find SMS senders on this phone"
                disabled={!canReadSms || smsSenderDiscoveryState === "loading"}
                onPress={() => void handleLoadSmsInboxSenders()}
                style={({ pressed }) => [styles.mobileIconAction, pressed ? styles.mobilePressed : null]}
              >
                {smsSenderDiscoveryState === "loading" ? (
                  <ActivityIndicator color="#32d8f2" size="small" />
                ) : (
                  <MaterialCommunityIcons color="#32d8f2" name="database-search-outline" size={21} />
                )}
              </Pressable>
            </View>
            <InlineFeedback
              loadingLabel="Loading sender names…"
              message={smsSenderDiscoveryMessage}
              state={smsSenderDiscoveryState}
            />

            {smsInboxSenders.length ? (
              <>
                <View style={styles.mobileInputWrap}>
                  <MaterialCommunityIcons color="#7890ad" name="magnify" size={21} />
                  <TextInput
                    autoCapitalize="none"
                    onChangeText={setSmsSenderSearch}
                    placeholder="Search sender name or number"
                    placeholderTextColor="#5f7590"
                    style={styles.mobileInput}
                    value={smsSenderSearch}
                  />
                </View>
                <View style={styles.mobileGroupedList}>
                  {visibleInboxSenders.map((item) => {
                    const isTracked = existingExactSenders.has(item.sender.trim().toLowerCase());
                    const isSelected = selectedSmsSender === item.sender;
                    return (
                      <Pressable
                        disabled={isTracked}
                        key={item.sender.toLowerCase()}
                        onPress={() => handleSelectSmsInboxSender(item.sender)}
                        style={({ pressed }) => [
                          styles.mobileMenuRow,
                          isSelected ? styles.mobileSenderRowSelected : null,
                          isTracked ? styles.mobileSenderRowDisabled : null,
                          pressed ? styles.mobilePressed : null
                        ]}
                      >
                        <View style={styles.mobileProviderIcon}>
                          <MaterialCommunityIcons color={isTracked ? "#7890ad" : "#32d8f2"} name="message-text-outline" size={21} />
                        </View>
                        <View style={styles.mobileRowBody}>
                          <Text style={styles.mobileRowTitle}>{item.sender}</Text>
                          <Text style={styles.mobileRowMeta}>
                            {item.messageCount} message(s) · latest {formatMobileDate(item.latestAt)}
                          </Text>
                        </View>
                        <Text style={isTracked ? styles.mobileSectionMeta : styles.mobileTextButtonText}>
                          {isTracked ? "Tracked" : isSelected ? "Selected" : "Choose"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!visibleInboxSenders.length ? (
                  <Text style={styles.mobileStateText}>No sender names match “{smsSenderSearch}”.</Text>
                ) : null}
              </>
            ) : (
              <Pressable
                disabled={!canReadSms || smsSenderDiscoveryState === "loading"}
                onPress={() => void handleLoadSmsInboxSenders()}
                style={({ pressed }) => [styles.mobileSecondaryAction, pressed ? styles.mobilePressed : null]}
              >
                <MaterialCommunityIcons color="#32d8f2" name="message-text-outline" size={21} />
                <Text style={styles.mobileSecondaryActionText}>Find SMS senders on phone</Text>
              </Pressable>
            )}

            {selectedSmsSender ? (
              <View style={styles.mobileRuleComposer}>
                <View style={styles.mobileSectionHeader}>
                  <View style={styles.mobileRowBody}>
                    <Text style={styles.mobileRuleComposerTitle}>{selectedSmsSender}</Text>
                    <Text style={styles.mobileRowMeta}>Exact sender match</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Close sender rule editor"
                    onPress={() => setSelectedSmsSender("")}
                    style={styles.mobileIconAction}
                  >
                    <MaterialCommunityIcons color="#9eb0c7" name="close" size={20} />
                  </Pressable>
                </View>

                <Text style={styles.mobileFieldLabel}>Rule name</Text>
                <View style={styles.mobileInputWrap}>
                  <MaterialCommunityIcons color="#7890ad" name="tag-outline" size={20} />
                  <TextInput
                    onChangeText={setNewSenderRuleName}
                    placeholder="e.g. City Bank transactions"
                    placeholderTextColor="#5f7590"
                    style={styles.mobileInput}
                    value={newSenderRuleName}
                  />
                </View>

                <Text style={styles.mobileFieldLabel}>Destination account</Text>
                {accounts.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.mobileChoiceRow}>
                      {accounts.map((account) => (
                        <Pressable
                          key={account.id}
                          onPress={() => setNewSenderAccountId(account.id)}
                          style={[
                            styles.mobileChoice,
                            newSenderAccountId === account.id ? styles.mobileChoiceActive : null
                          ]}
                        >
                          <Text
                            style={[
                              styles.mobileChoiceText,
                              newSenderAccountId === account.id ? styles.mobileChoiceTextActive : null
                            ]}
                          >
                            {account.name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                ) : (
                  <Text style={styles.mobileErrorText}>Create or load an account before adding this sender.</Text>
                )}

                <Text style={styles.mobileFieldLabel}>Default category (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.mobileChoiceRow}>
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: !newSenderCategoryId }}
                      onPress={() => setNewSenderCategoryId("")}
                      style={[styles.mobileChoice, !newSenderCategoryId ? styles.mobileChoiceActive : null]}
                    >
                      <Text style={[styles.mobileChoiceText, !newSenderCategoryId ? styles.mobileChoiceTextActive : null]}>
                        Learn during review
                      </Text>
                    </Pressable>
                    {categories.map((category) => (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: newSenderCategoryId === category.id }}
                        key={category.id}
                        onPress={() => setNewSenderCategoryId(category.id)}
                        style={[styles.mobileChoice, newSenderCategoryId === category.id ? styles.mobileChoiceActive : null]}
                      >
                        <Text style={[styles.mobileChoiceText, newSenderCategoryId === category.id ? styles.mobileChoiceTextActive : null]}>
                          {category.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.mobileFieldLabel}>Default transaction type (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.mobileChoiceRow}>
                    {["", "expense", "income", "transfer", "fee", "refund"].map((transactionType) => (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: newSenderTransactionType === transactionType }}
                        key={transactionType || "detect"}
                        onPress={() => setNewSenderTransactionType(transactionType)}
                        style={[styles.mobileChoice, newSenderTransactionType === transactionType ? styles.mobileChoiceActive : null]}
                      >
                        <Text style={[styles.mobileChoiceText, newSenderTransactionType === transactionType ? styles.mobileChoiceTextActive : null]}>
                          {transactionType ? titleCase(transactionType) : "Detect each message"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.mobileFieldLabel}>Provider</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.mobileChoiceRow}>
                    {smsProviderOptions.map((provider) => (
                      <Pressable
                        key={provider.value}
                        onPress={() => setNewSenderProvider(provider.value)}
                        style={[
                          styles.mobileChoice,
                          newSenderProvider === provider.value ? styles.mobileChoiceActive : null
                        ]}
                      >
                        <Text
                          style={[
                            styles.mobileChoiceText,
                            newSenderProvider === provider.value ? styles.mobileChoiceTextActive : null
                          ]}
                        >
                          {provider.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>

                <Pressable
                  disabled={smsRuleCreateState === "loading" || !newSenderAccountId}
                  onPress={() => void handleCreateSmsSenderRule()}
                  style={({ pressed }) => [
                    styles.mobilePrimaryWideButton,
                    smsRuleCreateState === "loading" || !newSenderAccountId
                      ? styles.mobilePrimaryWideButtonDisabled
                      : null,
                    pressed ? styles.mobilePressed : null
                  ]}
                >
                  {smsRuleCreateState === "loading" ? (
                    <ActivityIndicator color="#06141f" size="small" />
                  ) : (
                    <MaterialCommunityIcons color="#06141f" name="shield-plus-outline" size={21} />
                  )}
                  <Text style={styles.mobilePrimaryButtonText}>
                    {smsRuleCreateState === "loading" ? "Adding sender…" : "Add & track sender"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            <InlineFeedback
              loadingLabel="Adding sender rule…"
              message={smsRuleCreateMessage}
              state={smsRuleCreateState}
            />
          </View>
        </View>

        <View style={styles.mobileSection}>
          <View style={styles.mobileSectionHeader}>
            <Text style={styles.mobileSectionTitle}>4. Scan and sync</Text>
            <Text style={styles.mobileSectionMeta}>{pendingSmsCount} waiting</Text>
          </View>
          <Text style={styles.mobileFieldLabel}>Choose what to scan</Text>
          <View style={styles.mobileSegmentedControl}>
            <Pressable
              onPress={() => {
                setSmsScanMode("new");
                setSmsReprocessExisting(false);
              }}
              style={[styles.mobileSegment, smsScanMode === "new" ? styles.mobileSegmentActive : null]}
            >
              <MaterialCommunityIcons
                color={smsScanMode === "new" ? "#06141f" : "#9eb0c7"}
                name="message-plus-outline"
                size={19}
              />
              <Text style={[styles.mobileSegmentText, smsScanMode === "new" ? styles.mobileSegmentTextActive : null]}>
                New only
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSmsScanMode("history")}
              style={[styles.mobileSegment, smsScanMode === "history" ? styles.mobileSegmentActive : null]}
            >
              <MaterialCommunityIcons
                color={smsScanMode === "history" ? "#06141f" : "#9eb0c7"}
                name="history"
                size={19}
              />
              <Text
                style={[styles.mobileSegmentText, smsScanMode === "history" ? styles.mobileSegmentTextActive : null]}
              >
                Import history
              </Text>
            </Pressable>
          </View>

          {smsScanMode === "history" ? (
            <View style={styles.mobileHistoryOptions}>
              <View style={styles.mobileRangeRow}>
                <View style={styles.mobileRangeField}>
                  <Text style={styles.mobileFieldLabel}>From</Text>
                  <View style={styles.mobileInputWrap}>
                    <MaterialCommunityIcons color="#7890ad" name="calendar-start" size={19} />
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={setSmsScanFrom}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#5f7590"
                      style={styles.mobileInput}
                      value={smsScanFrom}
                    />
                  </View>
                </View>
                <View style={styles.mobileRangeField}>
                  <Text style={styles.mobileFieldLabel}>Through</Text>
                  <View style={styles.mobileInputWrap}>
                    <MaterialCommunityIcons color="#7890ad" name="calendar-end" size={19} />
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={setSmsScanTo}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#5f7590"
                      style={styles.mobileInput}
                      value={smsScanTo}
                    />
                  </View>
                </View>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: smsReprocessExisting }}
                onPress={() => setSmsReprocessExisting((current) => !current)}
                style={({ pressed }) => [styles.mobileOptionRow, pressed ? styles.mobilePressed : null]}
              >
                <View style={styles.mobileRowBody}>
                  <Text style={styles.mobileRowTitle}>Refresh previous imports</Text>
                  <Text style={styles.mobileRowMeta}>Re-run pending items through the latest parser without changing confirmed transactions.</Text>
                </View>
                <View style={[styles.mobileToggle, smsReprocessExisting ? styles.mobileToggleActive : null]}>
                  <View style={[styles.mobileToggleKnob, smsReprocessExisting ? styles.mobileToggleKnobActive : null]} />
                </View>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.mobileStateText}>Fast scan. Previously processed messages stay skipped.</Text>
          )}
          <Pressable
            disabled={rawQueueState === "loading" || !canReadSms || enabledRules.length === 0}
            onPress={() => void handleScanAndSyncSms()}
            style={({ pressed }) => [
              styles.mobilePrimaryWideButton,
              rawQueueState === "loading" || !canReadSms || enabledRules.length === 0
                ? styles.mobilePrimaryWideButtonDisabled
                : null,
              pressed ? styles.mobilePressed : null
            ]}
          >
            {rawQueueState === "loading" ? (
              <ActivityIndicator color="#06141f" />
            ) : (
              <MaterialCommunityIcons color="#06141f" name="sync" size={22} />
            )}
            <Text style={styles.mobilePrimaryButtonText}>
              {rawQueueState === "loading"
                ? "Syncing messages…"
                : smsScanMode === "history"
                  ? "Scan selected history"
                  : "Scan new messages"}
            </Text>
          </Pressable>
          {rawQueueMessage ? (
            <View style={[styles.mobileSyncResult, rawQueueState === "error" ? styles.mobileSyncResultError : null]}>
              <MaterialCommunityIcons
                color={rawQueueState === "error" ? "#ff9399" : "#55e6a5"}
                name={rawQueueState === "error" ? "alert-circle-outline" : "check-circle-outline"}
                size={20}
              />
              <Text style={[styles.mobileSyncResultText, rawQueueState === "error" ? styles.mobileErrorText : null]}>
                {rawQueueMessage}
              </Text>
            </View>
          ) : null}
        </View>

        {__DEV__ && Platform.OS === "android" ? (
          <View style={[styles.mobileSection, styles.mobileDangerZone]}>
            <View style={styles.mobileSectionHeader}>
              <Text style={styles.mobileSectionTitle}>Development reset</Text>
              <Text style={styles.mobileDangerLabel}>DEBUG ONLY</Text>
            </View>
            <Text style={styles.mobileStateText}>
              Clear local scan memory and this user's backend SMS imports so the same inbox range can be tested from scratch.
            </Text>
            <Pressable
              disabled={smsDevResetState === "loading"}
              onPress={() => void handleDevelopmentSmsReset()}
              style={({ pressed }) => [styles.mobileDangerButton, pressed ? styles.mobilePressed : null]}
            >
              {smsDevResetState === "loading" ? (
                <ActivityIndicator color="#ff9399" size="small" />
              ) : (
                <MaterialCommunityIcons color="#ff9399" name="delete-alert-outline" size={21} />
              )}
              <Text style={styles.mobileDangerButtonText}>
                {smsDevResetArmed ? "Confirm clear SMS test data" : "Clear SMS test data"}
              </Text>
            </Pressable>
            <InlineFeedback
              loadingLabel="Clearing SMS test data…"
              message={smsDevResetMessage}
              state={smsDevResetState}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const renderMore = () => (
    <View style={styles.mobileSectionStack}>
      <View style={styles.mobilePageIntro}>
        <Text style={styles.mobilePageTitle}>More</Text>
        <Text style={styles.mobilePageSubtitle}>Planning tools, automation settings, and account controls.</Text>
      </View>
      <Pressable
        onPress={() => switchTab("capture")}
        style={({ pressed }) => [styles.mobileAutomationCallout, pressed ? styles.mobilePressed : null]}
      >
        <View style={styles.mobileAutomationIconSmall}>
          <MaterialCommunityIcons color="#06141f" name="message-flash-outline" size={24} />
        </View>
        <View style={styles.mobileRowBody}>
          <Text style={styles.mobileRowTitle}>SMS automation</Text>
          <Text style={styles.mobileRowMeta}>Scan history and import new transactions</Text>
        </View>
        <MaterialCommunityIcons color="#32d8f2" name="chevron-right" size={24} />
      </Pressable>
      <View style={styles.mobileGroupedList}>
        <Pressable
          onPress={() => setShowAdvancedTools(true)}
          style={({ pressed }) => [styles.mobileMenuRow, pressed ? styles.mobilePressed : null]}
        >
          <MaterialCommunityIcons color="#91a7c2" name="credit-card-outline" size={22} />
          <Text style={styles.mobileMenuLabel}>Accounts & manual tools</Text>
          <MaterialCommunityIcons color="#647b98" name="chevron-right" size={23} />
        </Pressable>
        {drawerItems.filter((item) => item.label !== "SMS capture settings").map((item) => (
          <Pressable
            key={item.label}
            onPress={() => setShowAdvancedTools(true)}
            style={({ pressed }) => [styles.mobileMenuRow, pressed ? styles.mobilePressed : null]}
          >
            <MaterialCommunityIcons color="#91a7c2" name={item.icon} size={22} />
            <Text style={styles.mobileMenuLabel}>{item.label}</Text>
            <MaterialCommunityIcons color="#647b98" name="chevron-right" size={23} />
          </Pressable>
        ))}
      </View>
      <View style={styles.mobileSystemCard}>
        <View style={styles.mobileSystemHeader}>
          <View style={[styles.mobileSyncDot, state === "error" ? styles.mobileSyncDotError : null]} />
          <View style={styles.mobileRowBody}>
            <Text style={styles.mobileRowTitle}>{state === "success" ? "All systems operational" : state === "loading" ? "Waking the server…" : "Connection needs attention"}</Text>
            <Text style={styles.mobileRowMeta}>{getApiBaseUrl()}</Text>
          </View>
        </View>
        <Pressable onPress={loadHealth} style={styles.mobileTextButton}>
          <Text style={styles.mobileTextButtonText}>Run connection check</Text>
        </Pressable>
      </View>
      <Pressable onPress={handleLogout} style={styles.mobileLogoutButton}>
        <MaterialCommunityIcons color="#ff7d84" name="logout" size={20} />
        <Text style={styles.mobileLogoutText}>Sign out</Text>
      </Pressable>
    </View>
  );

  if (!iconsLoaded) {
    return (
      <SafeAreaView style={styles.mobileRoot}>
        <StatusBar style="light" />
        <View style={styles.mobileSessionLoader}>
          {iconFontError ? null : <ActivityIndicator color="#55e6a5" size="large" />}
          <Text accessibilityRole={iconFontError ? "alert" : "text"} style={styles.mobileEmptyTitle}>
            {iconFontError ? "Could not load app icons" : "Preparing your workspace"}
          </Text>
          <Text style={styles.mobileEmptyCopy}>
            {iconFontError
              ? "Close and reopen the app. If this continues, install the latest build."
              : "Loading app icons…"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (sessionRestoring) {
    return (
      <SafeAreaView style={styles.mobileRoot}>
        <StatusBar style="light" />
        <View style={styles.mobileSessionLoader}>
          <View style={styles.mobileBrandMark}>
            <MaterialCommunityIcons color="#06141f" name="message-processing-outline" size={30} />
          </View>
          <ActivityIndicator color="#55e6a5" size="large" />
          <Text style={styles.mobileEmptyTitle}>Restoring your workspace</Text>
          <Text style={styles.mobileEmptyCopy}>Checking your secure session and cached finance data…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!accessToken.trim()) {
    return (
      <SafeAreaView style={styles.mobileRoot}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.mobileLoginContent} keyboardShouldPersistTaps="handled">
          <View style={styles.mobileLoginBrand}>
            <View style={styles.mobileBrandMark}>
              <MaterialCommunityIcons color="#06141f" name="message-processing-outline" size={30} />
            </View>
            <Text style={styles.mobileLoginTitle}>Finance Mobile</Text>
            <Text style={styles.mobileLoginSubtitle}>Your bank and wallet SMS, organized automatically.</Text>
          </View>
          <View style={styles.mobileLoginPanel}>
            <Text style={styles.mobileLoginHeading}>Welcome back</Text>
            <Text style={styles.mobileLoginHelper}>Sign in to review captured transactions and keep your ledger current.</Text>
            <Text style={styles.mobileFieldLabel}>Username</Text>
            <View style={styles.mobileInputWrap}>
              <MaterialCommunityIcons color="#7890ad" name="account-outline" size={20} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setUsername}
                placeholder="Enter your username"
                placeholderTextColor="#647b98"
                style={styles.mobileInput}
                value={username}
              />
            </View>
            <Text style={styles.mobileFieldLabel}>Password</Text>
            <View style={styles.mobileInputWrap}>
              <MaterialCommunityIcons color="#7890ad" name="lock-outline" size={20} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPassword}
                onSubmitEditing={() => void handleLogin()}
                placeholder="Enter your password"
                placeholderTextColor="#647b98"
                secureTextEntry
                style={styles.mobileInput}
                value={password}
              />
            </View>
            {authState === "error" ? <Text style={styles.mobileErrorText}>{authMessage}</Text> : null}
            <Pressable
              disabled={authState === "loading" || !username.trim() || !password}
              onPress={() => void handleLogin()}
              style={({ pressed }) => [
                styles.mobileLoginButton,
                (!username.trim() || !password) ? styles.mobileLoginButtonDisabled : null,
                pressed ? styles.mobilePressed : null
              ]}
            >
              {authState === "loading" ? <ActivityIndicator color="#06141f" /> : <Text style={styles.mobileLoginButtonText}>Sign in</Text>}
            </Pressable>
          </View>
          <View style={styles.mobileLoginStatus}>
            <View style={[styles.mobileSyncDot, state === "error" ? styles.mobileSyncDotError : null]} />
            <Text style={styles.mobileLoginStatusText}>
              {state === "loading" ? "Connecting to your finance server…" : state === "success" ? "Secure server connection ready" : "Server may be waking up—tap to retry"}
            </Text>
            {state === "error" ? (
              <Pressable onPress={loadHealth}>
                <Text style={styles.mobileTextButtonText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const activeContent = mobilePanel === "sms-automation"
    ? renderSmsAutomation()
    : activeTab === "home"
      ? renderHome()
      : activeTab === "activity"
        ? renderActivity()
        : activeTab === "capture"
          ? renderSmsAutomation()
        : activeTab === "review"
          ? renderReview()
          : renderMore();

  return (
    <SafeAreaView style={styles.mobileRoot}>
      <StatusBar style="light" />
      <View style={styles.mobileAppHeader}>
        <Pressable
          accessibilityLabel={mobilePanel ? "Go back" : "Open menu"}
          onPress={mobilePanel ? () => setMobilePanel(null) : openDrawer}
          style={styles.mobileHeaderButton}
        >
          <MaterialCommunityIcons color="#dce8f6" name={mobilePanel ? "arrow-left" : "menu"} size={27} />
        </Pressable>
        <View style={styles.mobileHeaderTitleWrap}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.mobileAppTitle}>Signal <Text style={styles.mobileAppTitleAccent}>Inbox</Text></Text>
          <Text numberOfLines={2} style={styles.mobileAppSubtitle}>Bank & wallet SMS to insights</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh server and SMS synchronization status"
          onPress={() => void Promise.all([loadHealth(), refreshSmsBackgroundStatus()])}
          style={styles.mobileSyncChip}
        >
          {state === "loading" ? (
            <ActivityIndicator color="#55e6a5" size="small" />
          ) : (
            <View style={[styles.mobileSyncDot, state === "error" ? styles.mobileSyncDotError : null]} />
          )}
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.mobileSyncTitle}>
              {smsPermissionState !== "granted"
                ? "Setup"
                : smsBackgroundStatus?.state === "error"
                  ? "Attention"
                  : smsBackgroundStatus?.state === "running"
                    ? "Syncing"
                    : state === "error"
                      ? "Offline"
                      : pendingSmsCount > 0 ? "Pending" : "Ready"}
            </Text>
            <Text style={styles.mobileSyncMeta}>
              {pendingSmsCount
                ? `${pendingSmsCount} queued`
                : smsBackgroundStatus?.state === "running"
                  ? "SMS syncing"
                  : smsBackgroundStatus?.state === "error"
                    ? "SMS needs attention"
                    : smsPermissionState === "granted"
                      ? "SMS sync ready"
                      : "Permission needed"}
            </Text>
          </View>
        </Pressable>
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.mobileScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={{ opacity: contentOpacity }}
      >
        {activeContent}
      </Animated.ScrollView>

      <View style={styles.mobileTabBar}>
        {tabItems.map((item) => {
          const isActive = activeTab === item.key;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={item.key}
              onPress={() => switchTab(item.key)}
              style={styles.mobileTabItem}
            >
              <View style={styles.mobileTabIconWrap}>
                <MaterialCommunityIcons color={isActive ? "#32d8f2" : "#7890ad"} name={item.icon} size={24} />
                {item.key === "review" && reviewCandidates.length ? <View style={styles.mobileTabBadge} /> : null}
              </View>
              <Text style={[styles.mobileTabLabel, isActive ? styles.mobileTabLabelActive : null]}>{item.label}</Text>
              {isActive ? <View style={styles.mobileTabIndicator} /> : null}
            </Pressable>
          );
        })}
      </View>

      <Modal animationType="fade" onRequestClose={closeDrawer} transparent visible={drawerVisible}>
        <View style={styles.mobileDrawerLayer}>
          <Pressable accessibilityLabel="Close menu" onPress={closeDrawer} style={styles.mobileDrawerScrim} />
          <Animated.View style={[styles.mobileDrawer, { transform: [{ translateX: drawerTranslateX }] }]}>
            <View style={styles.mobileDrawerBrand}>
              <View style={styles.mobileBrandMarkSmall}>
                <MaterialCommunityIcons color="#06141f" name="message-processing-outline" size={23} />
              </View>
              <View>
                <Text style={styles.mobileDrawerTitle}>Finance Mobile</Text>
                <Text style={styles.mobileDrawerSubtitle}>Automation center</Text>
              </View>
            </View>
            <View style={styles.mobileDrawerNav}>
              {drawerItems.map((item) => (
                <Pressable
                  key={item.label}
                  onPress={() => {
                    closeDrawer();
                    if (item.label === "SMS capture settings") {
                      setTimeout(() => switchTab("capture"), 190);
                    } else {
                      setTimeout(() => setShowAdvancedTools(true), 190);
                    }
                  }}
                  style={({ pressed }) => [styles.mobileDrawerRow, pressed ? styles.mobilePressed : null]}
                >
                  <MaterialCommunityIcons color="#91a7c2" name={item.icon} size={22} />
                  <Text style={styles.mobileDrawerRowText}>{item.label}</Text>
                  <MaterialCommunityIcons color="#647b98" name="chevron-right" size={22} />
                </Pressable>
              ))}
            </View>
            <View style={styles.mobileDrawerFooter}>
              <Text style={styles.mobileDrawerFooterLabel}>Signed in</Text>
              <Text style={styles.mobileDrawerFooterValue}>{username || "Finance user"}</Text>
              <Pressable onPress={handleLogout} style={styles.mobileDrawerLogout}>
                <MaterialCommunityIcons color="#ff7d84" name="logout" size={20} />
                <Text style={styles.mobileLogoutText}>Sign out</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
      <Modal animationType="fade" transparent visible={transferDecision !== null} onRequestClose={() => { if (!transferBusy) setTransferDecision(null); }}>
        <View style={styles.transferMatchOverlay}>
          <View accessibilityViewIsModal style={styles.transferMatchPanel}>
            <Text accessibilityRole="header" style={styles.mobileSectionTitle}>Possible matching transfer found</Text>
            <Text style={styles.mobileStateText}>Verify this is the same movement. Linking shows it in both accounts and counts it once.</Text>
            {transferError ? <Text accessibilityRole="alert" style={styles.mobileErrorText}>{transferError}</Text> : null}
            <ScrollView>
              {transferDecision?.matches.map((match) => <View key={`${match.kind}:${match.id}`} style={styles.transferMatchCard}>
                <Text style={styles.mobileRowTitle}>{match.account_name} → {match.transfer_account_name}</Text>
                <Text style={styles.mobileRowMeta}>BDT {match.amount} · {match.date}{match.time ? ` · ${match.time.slice(0, 5)}` : ""}</Text>
                {match.reference ? <Text style={styles.mobileRowMeta}>Reference: {match.reference}</Text> : null}
                <Pressable disabled={transferBusy} accessibilityRole="button" onPress={() => void handleTransferDecision(match)} style={styles.mobilePrimaryButton}><Text style={styles.mobilePrimaryButtonText}>{transferBusy ? "Linking…" : match.kind === "candidate" ? "Confirm as one transfer" : "Link to existing transfer"}</Text></Pressable>
              </View>)}
            </ScrollView>
            <Pressable disabled={transferBusy} accessibilityRole="button" onPress={() => void handleTransferDecision()} style={styles.mobileTextButton}><Text style={styles.mobileTextButtonText}>Keep separate</Text></Pressable>
            <Pressable disabled={transferBusy} accessibilityRole="button" onPress={() => setTransferDecision(null)} style={styles.mobileTextButton}><Text style={styles.mobileTextButtonText}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  transferMatchOverlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.65)" },
  transferMatchPanel: { maxHeight: "85%", borderRadius: 18, padding: 20, backgroundColor: "#081421", gap: 12 },
  transferMatchCard: { padding: 14, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: "#263a52", gap: 8 },
  advancedHeader: {
    alignItems: "center",
    backgroundColor: "#081421",
    borderBottomColor: "#263a52",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  advancedHeaderButton: {
    alignItems: "center",
    backgroundColor: "#132437",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  advancedHeaderSubtitle: {
    color: "#91a7c2",
    fontSize: 12,
    marginTop: 2
  },
  advancedHeaderTitle: {
    color: "#f6f8fc",
    fontSize: 18,
    fontWeight: "800"
  },
  mobileAccountRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  mobileActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18
  },
  mobileAppHeader: {
    alignItems: "center",
    borderBottomColor: "#1c3046",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  mobileAppSubtitle: {
    color: "#91a7c2",
    fontSize: 11,
    marginTop: 1
  },
  mobileAppTitle: {
    color: "#f6f8fc",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5
  },
  mobileAppTitleAccent: {
    color: "#32d8f2"
  },
  mobileBrandMark: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 20,
    height: 64,
    justifyContent: "center",
    marginBottom: 20,
    width: 64
  },
  mobileBrandMarkSmall: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  mobileCenteredState: {
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
    minHeight: 260
  },
  mobileChoice: {
    backgroundColor: "#0d1e2d",
    borderColor: "#2a4059",
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 15,
    paddingVertical: 11
  },
  mobileChoiceActive: {
    backgroundColor: "#123c43",
    borderColor: "#32d8f2"
  },
  mobileChoiceRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4
  },
  mobilePolicyChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 4
  },
  mobilePolicyChoice: {
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 48
  },
  mobilePolicyChoiceText: {
    flexShrink: 1,
    textAlign: "center"
  },
  mobileChoiceText: {
    color: "#a9bad0",
    fontSize: 13,
    fontWeight: "700"
  },
  mobileChoiceTextActive: {
    color: "#e7fbff"
  },
  mobileConfidence: {
    backgroundColor: "#113d38",
    borderColor: "#18745f",
    borderRadius: 999,
    borderWidth: 1,
    color: "#55e6c5",
    fontSize: 13,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  mobileConfidenceBlock: {
    alignItems: "flex-end"
  },
  mobileConfidenceLabel: {
    color: "#91a7c2",
    fontSize: 11,
    marginTop: 2
  },
  mobileConfidenceLarge: {
    backgroundColor: "#113d38",
    borderColor: "#18745f",
    borderRadius: 999,
    borderWidth: 1,
    color: "#55e6c5",
    fontSize: 17,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  mobileConfidenceWarning: {
    backgroundColor: "#443615",
    borderColor: "#9a7013",
    color: "#ffd469"
  },
  mobileConnectedBadge: {
    alignItems: "center",
    backgroundColor: "#12382f",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  mobileConnectedDot: {
    backgroundColor: "#55e6a5",
    borderRadius: 999,
    height: 7,
    width: 7
  },
  mobileConnectedText: {
    color: "#aaf5ce",
    fontSize: 11,
    fontWeight: "700"
  },
  mobileDrawer: {
    backgroundColor: "#0a1725",
    borderRightColor: "#263a52",
    borderRightWidth: 1,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 54,
    position: "absolute",
    top: 0,
    width: 310
  },
  mobileDrawerBrand: {
    alignItems: "center",
    borderBottomColor: "#1c3046",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingBottom: 22
  },
  mobileDrawerFooter: {
    borderTopColor: "#1c3046",
    borderTopWidth: 1,
    marginTop: "auto",
    paddingBottom: 30,
    paddingTop: 20
  },
  mobileDrawerFooterLabel: {
    color: "#647b98",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  mobileDrawerFooterValue: {
    color: "#dce8f6",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 4
  },
  mobileDrawerLayer: {
    flex: 1
  },
  mobileDrawerLogout: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    minHeight: 44
  },
  mobileDrawerNav: {
    gap: 4,
    paddingTop: 22
  },
  mobileDrawerRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 13,
    minHeight: 52,
    paddingHorizontal: 10
  },
  mobileDrawerRowText: {
    color: "#c5d2e2",
    flex: 1,
    fontSize: 14,
    fontWeight: "600"
  },
  mobileDrawerScrim: {
    backgroundColor: "rgba(2, 8, 15, 0.72)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  mobileDrawerSubtitle: {
    color: "#7890ad",
    fontSize: 12,
    marginTop: 2
  },
  mobileDrawerTitle: {
    color: "#f6f8fc",
    fontSize: 18,
    fontWeight: "800"
  },
  mobileDangerButton: {
    alignItems: "center",
    borderColor: "#6a3440",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 14
  },
  mobileDangerButtonText: {
    color: "#ff9399",
    fontSize: 14,
    fontWeight: "800"
  },
  mobileDangerLabel: {
    color: "#ff9399",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8
  },
  mobileDangerZone: {
    backgroundColor: "#211923",
    borderColor: "#5a3139"
  },
  mobileEmptyCopy: {
    color: "#91a7c2",
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 290,
    textAlign: "center"
  },
  mobileEmptyIcon: {
    alignItems: "center",
    backgroundColor: "#12382f",
    borderRadius: 30,
    height: 60,
    justifyContent: "center",
    width: 60
  },
  mobileEmptyState: {
    alignItems: "center",
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 32
  },
  mobileEmptyTitle: {
    color: "#f6f8fc",
    fontSize: 20,
    fontWeight: "800"
  },
  mobileErrorText: {
    color: "#ff8d92",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10
  },
  mobileFieldLabel: {
    color: "#a9bad0",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 17,
    textTransform: "uppercase"
  },
  mobileGroupedList: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden"
  },
  mobileHeaderButton: {
    alignItems: "center",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  mobileHeaderTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1
  },
  mobileHeroAmount: {
    color: "#f6f8fc",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.2,
    marginTop: 20
  },
  mobileHeroCard: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 20,
    borderWidth: 1,
    padding: 18
  },
  mobileHeroDate: {
    color: "#91a7c2",
    fontSize: 12,
    marginTop: 3
  },
  mobileHeroDescription: {
    color: "#c5d2e2",
    fontSize: 16,
    marginTop: 4
  },
  mobileHeroHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12
  },
  mobileHeroProvider: {
    color: "#f6f8fc",
    fontSize: 18,
    fontWeight: "800"
  },
  mobileHistoryOptions: {
    gap: 12
  },
  mobileIconAction: {
    alignItems: "center",
    backgroundColor: "#122538",
    borderRadius: 11,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  mobileInput: {
    color: "#f6f8fc",
    flex: 1,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 10,
    paddingVertical: 12
  },
  mobileInputWrap: {
    alignItems: "center",
    backgroundColor: "#091724",
    borderColor: "#2b4159",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: 14
  },
  mobileInlineFeedback: {
    alignItems: "center",
    backgroundColor: "#102c29",
    borderColor: "#285c50",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  mobileInlineFeedbackError: {
    backgroundColor: "#321f27",
    borderColor: "#6a3440"
  },
  mobileInlineFeedbackText: {
    color: "#b9ead5",
    flex: 1,
    fontSize: 12,
    lineHeight: 18
  },
  mobileInlineFeedbackTextError: {
    color: "#ffb2b6"
  },
  mobileListRow: {
    alignItems: "center",
    borderBottomColor: "#1c3046",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  mobileLoginBrand: {
    alignItems: "center",
    marginBottom: 30,
    marginTop: 38
  },
  mobileLoginButton: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 13,
    justifyContent: "center",
    marginTop: 24,
    minHeight: 54
  },
  mobileLoginButtonDisabled: {
    opacity: 0.45
  },
  mobileLoginButtonText: {
    color: "#06141f",
    fontSize: 15,
    fontWeight: "800"
  },
  mobileLoginContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 22
  },
  mobileLoginHeading: {
    color: "#f6f8fc",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.6
  },
  mobileLoginHelper: {
    color: "#91a7c2",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7
  },
  mobileLoginPanel: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 22,
    borderWidth: 1,
    padding: 20
  },
  mobileLoginStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    marginTop: 22,
    minHeight: 44
  },
  mobileLoginStatusText: {
    color: "#91a7c2",
    flexShrink: 1,
    fontSize: 12
  },
  mobileLoginSubtitle: {
    color: "#91a7c2",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 290,
    textAlign: "center"
  },
  mobileLoginTitle: {
    color: "#f6f8fc",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -1
  },
  mobileOptionRow: {
    alignItems: "center",
    backgroundColor: "#091724",
    borderColor: "#2b4159",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 72,
    padding: 13
  },
  mobileLogoutButton: {
    alignItems: "center",
    borderColor: "#5a3139",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 50
  },
  mobileLogoutText: {
    color: "#ff8d92",
    fontSize: 14,
    fontWeight: "700"
  },
  mobileAutomationCallout: {
    alignItems: "center",
    backgroundColor: "#102b3b",
    borderColor: "#2e6571",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    minHeight: 76,
    padding: 14
  },
  mobileAutomationCopy: {
    flexShrink: 1,
    width: "100%",
    color: "#a9bad0",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4
  },
  mobileAutomationHero: {
    alignItems: "center",
    backgroundColor: "#102b3b",
    borderColor: "#2e6571",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 16
  },
  mobileAutomationIcon: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 17,
    height: 56,
    justifyContent: "center",
    width: 56
  },
  mobileAutomationIconSmall: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  mobileAutomationTitle: {
    color: "#f6f8fc",
    fontSize: 16,
    fontWeight: "800"
  },
  mobileSetupCount: {
    alignItems: "center",
    backgroundColor: "#123047",
    borderColor: "#2f5a72",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 48,
    paddingHorizontal: 10
  },
  mobileSetupCountText: {
    color: "#55e6a5",
    fontSize: 12,
    fontWeight: "800"
  },
  mobileSetupList: {
    gap: 10,
    marginTop: 14
  },
  mobileSetupProgress: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 18,
    borderWidth: 1,
    padding: 16
  },
  mobileSetupStep: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  mobileSetupStepText: {
    flex: 1,
    flexShrink: 1,
    color: "#91a7c2",
    fontSize: 13
  },
  mobileSetupStepTextDone: {
    color: "#dce8f6"
  },
  mobileSetupTitle: {
    color: "#f6f8fc",
    fontSize: 15,
    fontWeight: "800"
  },
  mobileBackAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 7,
    minHeight: 40
  },
  mobileBackActionText: {
    color: "#32d8f2",
    fontSize: 14,
    fontWeight: "700"
  },
  mobileMenuLabel: {
    color: "#dce8f6",
    flex: 1,
    fontSize: 14,
    fontWeight: "700"
  },
  mobileMenuRow: {
    alignItems: "center",
    borderBottomColor: "#1c3046",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 13,
    minHeight: 58,
    paddingHorizontal: 16
  },
  mobileOutlineButton: {
    alignItems: "center",
    borderColor: "#557493",
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50
  },
  mobileOutlineButtonText: {
    color: "#dce8f6",
    fontSize: 14,
    fontWeight: "800"
  },
  mobilePageIntro: {
    gap: 5,
    marginBottom: 2
  },
  mobilePageSubtitle: {
    color: "#91a7c2",
    fontSize: 14,
    lineHeight: 20
  },
  mobilePageTitle: {
    color: "#f6f8fc",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8
  },
  mobilePressed: {
    opacity: 0.72
  },
  mobilePrimaryButton: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 13,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50
  },
  mobilePrimaryButtonText: {
    color: "#06141f",
    fontSize: 14,
    fontWeight: "800"
  },
  mobilePrimaryWideButton: {
    alignItems: "center",
    backgroundColor: "#55e6a5",
    borderRadius: 14,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 18
  },
  mobilePrimaryWideButtonDisabled: {
    opacity: 0.42
  },
  mobileProviderIcon: {
    alignItems: "center",
    backgroundColor: "#10283b",
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  mobileProviderIconLarge: {
    alignItems: "center",
    backgroundColor: "#102f42",
    borderRadius: 16,
    height: 54,
    justifyContent: "center",
    width: 54
  },
  mobileQueueAmount: {
    color: "#f6f8fc",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 7
  },
  mobileQueueAside: {
    alignItems: "flex-end",
    gap: 8
  },
  mobileQueueRow: {
    alignItems: "center",
    borderBottomColor: "#1c3046",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 108,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  mobileRangeField: {
    flex: 1,
    minWidth: 0
  },
  mobileRangeRow: {
    flexDirection: "row",
    gap: 10
  },
  mobileReviewAmount: {
    color: "#f6f8fc",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
    marginTop: 18
  },
  mobileReviewCard: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 18,
    borderWidth: 1,
    padding: 16
  },
  mobileReviewPager: {
    alignItems: "center",
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 10
  },
  mobileRoot: {
    backgroundColor: "#081421",
    flex: 1
  },
  mobileRuleComposer: {
    backgroundColor: "#0b1a29",
    borderColor: "#2e6571",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14
  },
  mobileRuleComposerTitle: {
    color: "#f6f8fc",
    fontSize: 17,
    fontWeight: "800"
  },
  mobileRuleDecision: {
    alignItems: "flex-end",
    gap: 5
  },
  mobileRuleDecisionText: {
    color: "#91a7c2",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  mobileRuleDecisionTextActive: {
    color: "#55e6a5"
  },
  mobileSessionLoader: {
    alignItems: "center",
    flex: 1,
    gap: 16,
    justifyContent: "center",
    paddingHorizontal: 34
  },
  mobileSenderRowDisabled: {
    opacity: 0.55
  },
  mobileSenderRowSelected: {
    backgroundColor: "#102f39"
  },
  mobileRowAmount: {
    color: "#ff7d84",
    fontSize: 13,
    fontWeight: "800",
    maxWidth: 125,
    textAlign: "right"
  },
  mobileRowAmountSuccess: {
    color: "#55e6a5"
  },
  mobileRowBody: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%"
  },
  mobileRowIcon: {
    alignItems: "center",
    backgroundColor: "#112d43",
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  mobileRowIconSuccess: {
    backgroundColor: "#12382f"
  },
  mobileRowMeta: {
    color: "#91a7c2",
    fontSize: 12,
    marginTop: 3
  },
  mobileRowTitle: {
    color: "#edf3fa",
    fontSize: 14,
    fontWeight: "700"
  },
  mobileScrollContent: {
    paddingBottom: 26,
    paddingHorizontal: 16,
    paddingTop: 16
  },
  mobileScanBanner: {
    alignItems: "center",
    backgroundColor: "#0d2232",
    borderColor: "#254459",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 62,
    paddingHorizontal: 14
  },
  mobileScanBannerMeta: {
    color: "#7890ad",
    fontSize: 11,
    marginTop: 2
  },
  mobileScanBannerTitle: {
    color: "#dce8f6",
    fontSize: 13,
    fontWeight: "800"
  },
  mobileSecondaryAction: {
    alignItems: "center",
    backgroundColor: "#102538",
    borderColor: "#2a4059",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 16
  },
  mobileSecondaryActionText: {
    flexShrink: 1,
    textAlign: "center",
    color: "#dce8f6",
    fontSize: 14,
    fontWeight: "700"
  },
  mobileSection: {
    gap: 12
  },
  mobileSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between"
  },
  mobileSectionMeta: {
    color: "#7890ad",
    fontSize: 12
  },
  mobileSectionStack: {
    gap: 18
  },
  mobileSectionTitle: {
    color: "#f6f8fc",
    fontSize: 19,
    fontWeight: "800"
  },
  mobileSegment: {
    alignItems: "center",
    borderRadius: 13,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 8
  },
  mobileSegmentActive: {
    backgroundColor: "#32d8f2"
  },
  mobileSegmentedControl: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 5
  },
  mobileSegmentText: {
    color: "#9eb0c7",
    fontSize: 12,
    fontWeight: "700"
  },
  mobileSegmentTextActive: {
    color: "#06141f"
  },
  mobileSmsQuote: {
    alignItems: "flex-start",
    backgroundColor: "#091724",
    borderColor: "#263a52",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    padding: 13
  },
  mobileSmsQuoteText: {
    color: "#a9bad0",
    flex: 1,
    fontSize: 13,
    lineHeight: 20
  },
  mobileStateText: {
    color: "#91a7c2",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  mobileSuggestionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12
  },
  mobileSuggestionText: {
    color: "#a9bad0",
    fontSize: 13
  },
  mobileSummaryDivider: {
    alignSelf: "stretch",
    backgroundColor: "#263a52",
    width: 1
  },
  mobileSummaryLabel: {
    color: "#7890ad",
    fontSize: 11,
    marginTop: 2
  },
  mobileSummaryStrip: {
    alignItems: "center",
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 18,
    padding: 15
  },
  mobileSummaryValue: {
    color: "#f6f8fc",
    fontSize: 20,
    fontWeight: "800"
  },
  mobileSyncChip: {
    maxWidth: "38%",
    flexShrink: 1,
    alignItems: "center",
    backgroundColor: "#0e2131",
    borderColor: "#284058",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10
  },
  mobileSyncDot: {
    backgroundColor: "#35e4ad",
    borderRadius: 999,
    height: 10,
    shadowColor: "#35e4ad",
    shadowOpacity: 0.55,
    shadowRadius: 6,
    width: 10
  },
  mobileSyncDotError: {
    backgroundColor: "#ff7d84",
    shadowColor: "#ff7d84"
  },
  mobileSyncMeta: {
    color: "#7890ad",
    fontSize: 9,
    marginTop: 1
  },
  mobileSyncTitle: {
    color: "#55e6a5",
    fontSize: 11,
    fontWeight: "800"
  },
  mobileSystemCard: {
    backgroundColor: "#0e1c2c",
    borderColor: "#263a52",
    borderRadius: 17,
    borderWidth: 1,
    padding: 16
  },
  mobileSystemHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11
  },
  mobileStatusChip: {
    backgroundColor: "#382b1c",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  mobileStatusChipSuccess: {
    backgroundColor: "#12382f"
  },
  mobileStatusChipText: {
    color: "#ffc36a",
    fontSize: 11,
    fontWeight: "800"
  },
  mobileStatusChipTextSuccess: {
    color: "#55e6a5"
  },
  mobileSubsection: {
    borderTopColor: "#263a52",
    borderTopWidth: 1,
    gap: 12,
    marginTop: 6,
    paddingTop: 18
  },
  mobileSyncResult: {
    alignItems: "flex-start",
    backgroundColor: "#102c29",
    borderColor: "#285c50",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    padding: 12
  },
  mobileSyncResultError: {
    backgroundColor: "#321f27",
    borderColor: "#6a3440"
  },
  mobileSyncResultText: {
    color: "#b9ead5",
    flex: 1,
    fontSize: 12,
    lineHeight: 18
  },
  mobileTabBadge: {
    backgroundColor: "#ff4f72",
    borderColor: "#081421",
    borderRadius: 999,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: -2,
    top: -2,
    width: 10
  },
  mobileTabBar: {
    alignItems: "stretch",
    backgroundColor: "#091724",
    borderTopColor: "#263a52",
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 72,
    paddingHorizontal: 5,
    paddingTop: 7
  },
  mobileTabIconWrap: {
    position: "relative"
  },
  mobileTabIndicator: {
    backgroundColor: "#32d8f2",
    borderRadius: 999,
    bottom: 0,
    height: 3,
    position: "absolute",
    width: 28
  },
  mobileToggle: {
    backgroundColor: "#33485f",
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 3,
    width: 48
  },
  mobileToggleActive: {
    backgroundColor: "#55e6a5"
  },
  mobileToggleKnob: {
    backgroundColor: "#dce8f6",
    borderRadius: 999,
    height: 22,
    width: 22
  },
  mobileToggleKnobActive: {
    alignSelf: "flex-end",
    backgroundColor: "#06141f"
  },
  mobileTabItem: {
    alignItems: "center",
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 62,
    position: "relative"
  },
  mobileTabLabel: {
    color: "#7890ad",
    fontSize: 10,
    fontWeight: "600"
  },
  mobileTabLabelActive: {
    color: "#32d8f2"
  },
  mobileTextButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 10
  },
  mobileTextButtonText: {
    color: "#32d8f2",
    fontSize: 13,
    fontWeight: "800"
  },
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
  compactRecord: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10
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
  recordHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
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
  statusPill: {
    backgroundColor: "#e2e8f0",
    borderRadius: 999,
    color: "#334155",
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "capitalize"
  },
  statusPillSuccess: {
    backgroundColor: "#dcfce7",
    color: "#166534"
  },
  statusPillWarning: {
    backgroundColor: "#fef3c7",
    color: "#92400e"
  },
  statusText: {
    color: "#0f172a",
    fontSize: 14
  },
  subtitle: {
    color: "#334155",
    fontSize: 15
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4
  },
  summaryLabel: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "600"
  },
  summaryMetric: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 96,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  summaryMetricSuccess: {
    backgroundColor: "#ecfdf5",
    borderColor: "#10b981"
  },
  summaryMetricWarning: {
    backgroundColor: "#fffbeb",
    borderColor: "#f59e0b"
  },
  summaryValue: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800"
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
