import { NativeModules, Platform } from "react-native";
import type { Account, Transaction } from "./api";
import type { QuickPreset } from "../../finance-contracts/quick-add";

export const widgetKinds = ["quick_add", "review", "balances", "activity", "spending", "presets"] as const;
export type WidgetKind = typeof widgetKinds[number];
export type WidgetPrivacy = {
  showBalances: boolean;
  showActivity: boolean;
  showSpending: boolean;
};
export const defaultWidgetPrivacy: WidgetPrivacy = {
  showBalances: false,
  showActivity: false,
  showSpending: false,
};
type NativeWidgets = {
  syncSnapshot: (json: string) => Promise<boolean>;
  clearSnapshot: () => Promise<boolean>;
  getPrivacy: (owner: string) => Promise<string | null>;
  setPrivacy: (owner: string, json: string) => Promise<boolean>;
  pinWidget: (kind: WidgetKind) => Promise<boolean>;
  installedWidgets: () => Promise<Record<WidgetKind, number>>;
  recognizeSpeech: () => Promise<string>;
};
const native = Platform?.OS === "android" ? NativeModules?.FinanceWidgets as NativeWidgets | undefined : undefined;
export const widgetsAvailable = Boolean(native);
// Serialize writes so an older in-flight snapshot cannot reappear after hiding or sign-out.
let widgetWrite: Promise<unknown> = Promise.resolve();
function enqueueWidgetWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = widgetWrite.catch(() => {}).then(write);
  widgetWrite = next.catch(() => {});
  return next;
}
export const pinWidget = (kind: WidgetKind) => native?.pinWidget(kind) ?? Promise.resolve(false);
export const installedWidgets = () => native?.installedWidgets() ?? Promise.resolve({} as Record<WidgetKind, number>);
export const clearWidgetSnapshot = () => enqueueWidgetWrite(() => native?.clearSnapshot() ?? Promise.resolve(false));
export const readWidgetPrivacy = async (owner: string): Promise<WidgetPrivacy> => {
  const saved = await native?.getPrivacy(owner);
  if (!saved) return defaultWidgetPrivacy;
  try {
    const parsed = JSON.parse(saved);
    return {
      showBalances: parsed.showBalances === true,
      showActivity: parsed.showActivity === true,
      showSpending: parsed.showSpending === true,
    };
  } catch { return defaultWidgetPrivacy; }
};
export const saveWidgetPrivacy = (owner: string, privacy: WidgetPrivacy) =>
  enqueueWidgetWrite(() => native?.setPrivacy(owner, JSON.stringify(privacy)) ?? Promise.resolve(false));
export const recognizeWidgetSpeech = () => native?.recognizeSpeech() ?? Promise.reject(new Error("Voice input is available in the Android app."));

export type MonthlySpending = { month: string; total: string; topCategory: string };
export function buildWidgetSnapshot(input: {
  owner: string;
  privacy: WidgetPrivacy;
  accounts: Account[];
  transactions: Transaction[];
  reviewCount: number;
  presets: QuickPreset[];
  spending: MonthlySpending | null;
}) {
  const { privacy } = input;
  const accountName = (id: string) => input.accounts.find(account => account.id === id)?.name ?? "Account";
  return {
    signedIn: true,
    owner: input.owner,
    syncedAt: Date.now(),
    reviewCount: input.reviewCount,
    showBalances: privacy.showBalances,
    showActivity: privacy.showActivity,
    showSpending: privacy.showSpending,
    accounts: privacy.showBalances ? input.accounts.filter(account => account.is_active !== false).slice(0, 3).map(account => ({
      name: account.name.slice(0, 40),
      balance: `${account.currency} ${account.ledger_balance}`,
    })) : [],
    activity: privacy.showActivity ? input.transactions.slice(0, 3).map(transaction => ({
      title: (transaction.type === "transfer" && transaction.transfer_account
        ? `${accountName(transaction.account)} → ${accountName(transaction.transfer_account)}`
        : transaction.counterparty_text || transaction.note || transaction.type).slice(0, 45),
      amount: `${transaction.type === "transfer" ? "↔" : transaction.direction === "credit" ? "+" : "−"}${input.accounts.find(account => account.id === transaction.account)?.currency ?? "BDT"} ${transaction.amount}`,
    })) : [],
    spendingMonth: input.spending?.month ?? "This month",
    spending: privacy.showSpending ? input.spending && { total: input.spending.total, topCategory: input.spending.topCategory.slice(0, 40) } : null,
    presets: input.presets.filter(preset => preset.is_enabled && preset.available).slice(0, 3).map(preset => ({
      id: preset.id,
      name: preset.name.slice(0, 40),
    })),
  };
}
export const syncWidgetSnapshot = (snapshot: ReturnType<typeof buildWidgetSnapshot>) =>
  enqueueWidgetWrite(() => native?.syncSnapshot(JSON.stringify(snapshot)) ?? Promise.resolve(false));

export type WidgetAction =
  | { kind: "expense" | "transfer" | "voice" | "review" | "accounts" | "activity" | "widgets" | "home" | "quick_add" }
  | { kind: "preset"; id: string };
export function parseWidgetAction(url: string): WidgetAction | null {
  const match = /^finance:\/\/widget\/([a-z_]+)(?:\/([\w-]{1,80}))?$/.exec(url);
  if (!match) return null;
  if (match[1] === "preset" && match[2]) return { kind: "preset", id: match[2] };
  if (!match[2] && ["expense", "transfer", "voice", "review", "accounts", "activity", "widgets", "home", "quick_add"].includes(match[1]))
    return { kind: match[1] as Exclude<WidgetAction["kind"], "preset"> };
  return null;
}
