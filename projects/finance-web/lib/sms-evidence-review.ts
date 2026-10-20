import type { Account, PaymentMethod, TransactionSourceMessage } from "./api";

type ReviewInput = {
  account: Account | undefined;
  categoryName: string;
  counterparty: string;
  methods: PaymentMethod[];
  note: string;
  sources: TransactionSourceMessage[] | null;
  transactionType?: string;
};

function sourceProvider(sender: string): string {
  const normalized = sender.trim().toUpperCase().replace(/[\s_-]/g, "");
  if (normalized === "CITYBANK") return "city_bank";
  if (normalized === "EBL") return "ebl";
  return "";
}

function accountProvider(account: Account, methods: PaymentMethod[]): string {
  const providers = new Set(methods.filter(method => method.account === account.id && method.is_active).map(method => method.provider));
  if (providers.size === 1 && providers.has("city_bank")) return "city_bank";
  if (providers.size === 1 && providers.has("ebl")) return "ebl";
  const name = account.name.trim().toUpperCase().replace(/[\s_-]/g, "");
  if (name === "CITYBANK") return "city_bank";
  if (name === "EBL" || name === "EBLBANK") return "ebl";
  return "";
}

export function smsEvidenceWarnings({ account, categoryName, counterparty, methods, note, sources, transactionType }: ReviewInput): string[] {
  if (!sources?.length) return [];
  // A transfer may attach SMS from both banks; the canonical account is not
  // the reporting account for every message. The server audit checks each
  // transfer source against its saved per-account evidence instead.
  if (transactionType === "transfer") return [];
  const warnings: string[] = [];
  const selectedProvider = account ? accountProvider(account, methods) : "";
  const sourceProviders = new Set(sources.map(source => sourceProvider(source.sender)).filter(Boolean));
  if (selectedProvider && sourceProviders.size === 1 && !sourceProviders.has(selectedProvider)) {
    warnings.push(`Attached SMS is from ${[...sourceProviders][0] === "city_bank" ? "City Bank" : "EBL"}, but the selected account is ${account?.name}. Check the account and masked identifier.`);
  }
  const genericDeposit = sources.some(source => source.body && sourceProvider(source.sender) &&
    /\bdeposit(?:ed)?\b/i.test(source.body) &&
    !/\b(?:from|to|at|by|reference|ref|trx\s*id)\b/i.test(source.body));
  if (genericDeposit && (categoryName || counterparty || note)) {
    warnings.push("This SMS reports a deposit but does not name its source or purpose. Verify the category, counterparty, and note against other evidence.");
  }
  return warnings;
}
