import type { StatementDecision, StatementMatch } from "./api";
import { insignificantBdtBalanceDifference, suggestedBalanceSource } from "./statement-review";

export type StatementBalanceSelection = NonNullable<StatementDecision["balance_choice"]> & { version: number };

/** Keep explicit choices tied to reviewed values; use the higher report automatically for a sub-taka BDT difference. */
export function currentStatementBalanceChoice(
  selection: StatementBalanceSelection | undefined,
  match: Pick<StatementMatch, "effective_balance_after">,
  statementBalance: string | null,
  version: number,
  currency: string,
): StatementDecision["balance_choice"] {
  if (selection && (selection.version !== version
    || selection.existing_balance_after !== match.effective_balance_after
    || selection.statement_balance_after !== statementBalance)) return undefined;
  if (insignificantBdtBalanceDifference(statementBalance, match.effective_balance_after, currency)) {
    return {
      keep: suggestedBalanceSource(statementBalance, match.effective_balance_after) === "statement" ? "statement" : "existing",
      existing_balance_after: match.effective_balance_after,
      statement_balance_after: statementBalance,
    };
  }
  return selection ? { keep: selection.keep, existing_balance_after: selection.existing_balance_after, statement_balance_after: selection.statement_balance_after } : undefined;
}
