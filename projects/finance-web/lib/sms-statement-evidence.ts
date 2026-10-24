type MatchSignals = { late_posting: boolean; reasons: string[] };
type StatementEvidence = {
  account: string | null;
  account_name: string;
  amount: string | null;
  balance_after: string | null;
  currency: string;
  direction: "debit" | "credit";
  reference: string;
};

export type AgreeingEvidence = { label: string; value: string };

type ReportSource = { date: string | null; balance_after: string | null; value_date?: string | null };
type ComparableSource = ReportSource & { account: string | null; direction: string | null; amount: string | null };

/** Compare original reports without treating delayed statement posting as a false mismatch. */
export function compareSmsStatementReports(statement: ReportSource, sms: ReportSource, latePosting: boolean) {
  const date = !statement.date || !sms.date ? "unknown"
    : statement.date === sms.date ? "match"
    : statement.value_date && statement.value_date === sms.date ? "value_date_match"
    : "different";
  const balance = statement.balance_after === null || sms.balance_after === null ? "unknown"
    : Number(statement.balance_after) === Number(sms.balance_after) ? "match"
    : latePosting ? "different_reporting_times" : "different";
  return { date, balance } as const;
}

/** Short, source-based review prompts; these do not decide whether two sources match. */
export function sourceAttentionItems(statement: ComparableSource, sms: ComparableSource, latePosting: boolean) {
  const items: { key: string; text: string; tone: "warning" | "context" }[] = [];
  if (!sms.account) items.push({ key: "account", text: "SMS reporting account needs verification", tone: "warning" });
  else if (statement.account && statement.account !== sms.account) items.push({ key: "account", text: "Reporting accounts differ", tone: "warning" });
  if (!sms.direction) items.push({ key: "direction", text: "SMS debit / credit is unknown", tone: "warning" });
  else if (statement.direction && statement.direction !== sms.direction) items.push({ key: "direction", text: "Debit / credit differs", tone: "warning" });
  if (statement.amount === null || sms.amount === null) items.push({ key: "amount", text: "An amount is missing", tone: "warning" });
  else if (Number(statement.amount) !== Number(sms.amount)) items.push({ key: "amount", text: "Reported amounts differ", tone: "warning" });
  const reports = compareSmsStatementReports(statement, sms, latePosting);
  if (reports.date === "different") items.push({ key: "date", text: "Source dates differ", tone: "warning" });
  else if (reports.date === "value_date_match") items.push({ key: "date", text: "Posted later; value date matches SMS", tone: "context" });
  else if (reports.date === "unknown") items.push({ key: "date", text: "A source date is unavailable", tone: "context" });
  if (reports.balance === "different") items.push({ key: "balance", text: "Reported balances differ", tone: "warning" });
  else if (reports.balance === "different_reporting_times") items.push({ key: "balance", text: "Balances are from different reporting times", tone: "context" });
  else if (reports.balance === "unknown") items.push({ key: "balance", text: "A reported balance is unavailable", tone: "context" });
  return items;
}

/** Present only source details the server corroborated; never imply that a pair is confirmed. */
export function agreeingSmsStatementEvidence(
  statement: StatementEvidence,
  sms: { account: string | null; amount: string | null; source_direction: string | null },
  signals: MatchSignals,
): AgreeingEvidence[] {
  const evidence: AgreeingEvidence[] = [];
  if (sms.account && statement.account === sms.account) {
    evidence.push({ label: "Reporting account", value: statement.account_name });
  }
  if (sms.source_direction && sms.source_direction === statement.direction) {
    evidence.push({ label: "Direction", value: statement.direction });
  }
  if (sms.amount && statement.amount && Number(sms.amount) === Number(statement.amount)) {
    evidence.push({ label: "Exact amount", value: `${statement.currency} ${statement.amount}` });
  }
  if (!signals.late_posting && signals.reasons.includes("Reported balances agree.") && statement.balance_after) {
    evidence.push({ label: "Balance after", value: `${statement.currency} ${statement.balance_after}` });
  }
  if (signals.reasons.includes("Reference agrees.") && statement.reference) {
    evidence.push({ label: "Reference", value: statement.reference });
  }
  if (signals.reasons.includes("Counterparty wording agrees.")) {
    evidence.push({ label: "Counterparty", value: "Wording agrees" });
  }
  return evidence;
}
