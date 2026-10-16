import type { StatementDecision, StatementMatch } from "./api";
import { insignificantBdtBalanceDifference, suggestedBalanceSource } from "./statement-review";

export type StatementBalanceSelection = NonNullable<StatementDecision["balance_choice"]> & { version: number };

/** Keep explicit choices tied to reviewed values; suggest the higher report only for a sub-taka BDT difference. */
export function currentStatementBalanceChoice(
  selection: StatementBalanceSelection | undefined,
  match: Pick<StatementMatch, "effective_balance_after">,
  statementBalance: string | null,
  version: number,
  currency: string,
): StatementDecision["balance_choice"] {
  if (!selection) {
    if (!insignificantBdtBalanceDifference(statementBalance, match.effective_balance_after, currency)) return undefined;
    return {
      keep: suggestedBalanceSource(statementBalance, match.effective_balance_after) === "statement" ? "statement" : "existing",
      existing_balance_after: match.effective_balance_after,
      statement_balance_after: statementBalance,
    };
  }
  if (selection.version !== version
    || selection.existing_balance_after !== match.effective_balance_after
    || selection.statement_balance_after !== statementBalance) return undefined;
  return { keep: selection.keep, existing_balance_after: selection.existing_balance_after, statement_balance_after: selection.statement_balance_after };
}
