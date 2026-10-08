type BalanceRecord = {
  type: string;
  balance_after: string | null;
  transfer_evidence: Array<{ is_primary: boolean; balance_after: string | null }>;
};

export function editableReportedBalance(record: BalanceRecord): string {
  if (record.balance_after !== null) return record.balance_after;
  if (record.type !== "transfer") return "";
  // A receiving account's balance must never be substituted for the primary report.
  return record.transfer_evidence.find((item) => item.is_primary)?.balance_after ?? "";
}
