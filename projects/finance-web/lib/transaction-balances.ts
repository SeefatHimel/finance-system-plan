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
