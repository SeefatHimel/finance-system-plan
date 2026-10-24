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
