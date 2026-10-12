type BalanceRecord = {
  type: string;
  balance_after: string | null;
  transfer_evidence: Array<{ is_primary: boolean; balance_after: string | null }>;
};

export function balanceReportingAccount(
  context: { type: string; account: string; transfer_account: string },
  primaryDirection = "debit"
): string {
  return context.type === "transfer" && primaryDirection === "credit"
    ? context.transfer_account : context.account;
}

export function balanceAfterAccountChange(balance: string, before: string, after: string): string {
  // Selecting the first account assigns an otherwise unbound manual/parser value.
  return before && before !== after ? "" : balance;
}

export function editableReportedBalance(record: BalanceRecord): string {
  if (record.balance_after !== null) return record.balance_after;
  if (record.type !== "transfer") return "";
  // A receiving account's balance must never be substituted for the primary report.
  return record.transfer_evidence.find((item) => item.is_primary)?.balance_after ?? "";
}

export function accountBoundBalances(record: Omit<BalanceRecord, "transfer_evidence"> & {
  account: string;
  balance_reporting_account?: string | null;
  reported_balances?: { account: string; balance_after: string | null }[];
  transfer_evidence: Array<{ account: string; is_primary: boolean; balance_after: string | null }>;
}): Record<string, string> {
  if (record.type !== "transfer") return {
    ...Object.fromEntries(record.transfer_evidence.map(item => [item.account, item.balance_after ?? ""])),
    [record.account]: record.balance_after ?? ""
  };
  if (record.reported_balances?.length) return Object.fromEntries(record.reported_balances.map(item => [item.account, item.balance_after ?? ""]));
  const balances = Object.fromEntries(record.transfer_evidence.map(item => [item.account, item.balance_after ?? ""]));
  const primary = record.transfer_evidence.find(item => item.is_primary);
  const account = record.balance_reporting_account || primary?.account || record.account;
  balances[account] = editableReportedBalance(record);
  return balances;
}

export function transferBalancePayload(from: string, to: string, balances: Record<string, string>) {
  return [...new Set([from, to])].filter(Boolean).map(account => ({ account, balance_after: balances[account] || null }));
}
