import type { TransactionRevalidation } from "@/lib/api";

type Source = TransactionRevalidation["sources"][number];

export function linkedSmsReports(preview: TransactionRevalidation, source: Source) {
  return preview.sources.filter(item => item.kind === "Linked report"
    && source.raw_message !== null && item.raw_message === source.raw_message);
}

export function reportAccountChoices(preview: TransactionRevalidation, source: Source) {
  if (source.kind !== "Saved SMS") return [];
  const reports = linkedSmsReports(preview, source);
  return preview.ledger.accounts.filter(account => account.direction === source.direction
    && (account.id !== source.account || reports.some(report => report.account !== account.id || report.direction !== account.direction)));
}
