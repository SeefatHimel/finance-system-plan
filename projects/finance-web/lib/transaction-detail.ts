/** Conservative comparisons for a read-only view: unknown values never become matches. */
export type DetailMovement = {
  type: string; account: string; transfer_account?: string | null; date: string;
  time: string | null; direction: string; amount: string;
};
export type DetailObservation = {
  account: string | null; date: string | null; time: string | null;
  amount: string | null; balance: string | null; direction?: string | null;
  currency?: string | null; dateKind?: "reported" | "received"; compareAmount?: boolean;
};
export type DetailDifference = { field: "account" | "date" | "time" | "amount" | "balance" | "direction" | "currency"; label: string };
function moneyKey(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^(-?)0+(?=\d)/, "$1")}.${fraction.padEnd(2, "0")}`;
}
export function detailDifferences(record: DetailMovement, source: DetailObservation, balances: Record<string, string>, currency: string): DetailDifference[] {
  const result: DetailDifference[] = [];
  const belongs = source.account === record.account || (record.type === "transfer" && source.account === record.transfer_account);
  if (source.account && !belongs) result.push({ field: "account", label: "Different account" });
  if (source.currency && source.currency !== currency) result.push({ field: "currency", label: "Different currency" });
  if (source.dateKind !== "received" && source.date && source.date !== record.date) result.push({ field: "date", label: "Different dates" });
  if (source.dateKind !== "received" && source.date === record.date && source.time && record.time && (source.time.length === 5 ? `${source.time}:00` : source.time) !== (record.time.length === 5 ? `${record.time}:00` : record.time)) result.push({ field: "time", label: "Different times" });
  const comparableCurrency = source.currency === currency || (!source.currency && belongs);
  if (comparableCurrency && source.compareAmount !== false && source.amount !== null && moneyKey(source.amount) !== moneyKey(record.amount)) result.push({ field: "amount", label: "Different amount" });
  if (belongs && comparableCurrency && source.balance !== null && source.account && balances[source.account] && moneyKey(source.balance) !== moneyKey(balances[source.account])) result.push({ field: "balance", label: "Different balance" });
  const direction = record.type === "transfer" ? source.account === record.transfer_account ? "credit" : "debit" : record.direction;
  if (belongs && source.direction && source.direction !== direction) result.push({ field: "direction", label: "Different direction" });
  return result;
}
export function detailAmount(record: DetailMovement, selectedAccount = "") {
  const direction = record.type === "transfer" ? selectedAccount === record.transfer_account ? "credit" : selectedAccount === record.account ? "debit" : "internal" : record.direction;
  return { sign: direction === "internal" ? "" : direction === "credit" ? "+" : "−", tone: direction === "internal" ? "transfer" : direction === "credit" ? "credit" : "debit" };
}
export function detailSourceCount(messages: { id: string }[] | null, rows: { batch: string }[] | null) {
  const sms = messages === null ? "SMS unavailable" : `${new Set(messages.map(row => row.id)).size} SMS`;
  const pdfs = rows === null ? "Statements unavailable" : `${new Set(rows.map(row => row.batch)).size} statement PDF${new Set(rows.map(row => row.batch)).size === 1 ? "" : "s"}`;
  return `${sms} · ${pdfs}`;
}

/** An old scalar transfer balance does not establish which account reported it. */
export function detailBalances(record: DetailMovement & {
  balance_after: string | null; balance_reporting_account?: string | null;
  reported_balances?: { account: string; balance_after: string | null }[];
  transfer_evidence: { account: string; is_primary: boolean; balance_after: string | null }[];
}): Record<string, string> {
  if (record.type !== "transfer") return record.balance_after === null ? {} : { [record.account]: record.balance_after };
  if (record.reported_balances) return Object.fromEntries(record.reported_balances.filter(item => item.balance_after !== null && [record.account, record.transfer_account].includes(item.account)).map(item => [item.account, item.balance_after!]));
  const primary = record.transfer_evidence.find(item => item.is_primary);
  const reporter = record.balance_reporting_account || primary?.account;
  const value = record.balance_after ?? primary?.balance_after;
  return reporter && value != null ? { [reporter]: value } : {};
}
