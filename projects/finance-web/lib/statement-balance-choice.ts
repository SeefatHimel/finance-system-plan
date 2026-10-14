import type { StatementDecision, StatementMatch } from "./api";

export type StatementBalanceSelection = NonNullable<StatementDecision["balance_choice"]> & { version: number };

/** A selection belongs to one match and the exact values/version the user reviewed. */
export function currentStatementBalanceChoice(
  selection: StatementBalanceSelection | undefined,
  match: Pick<StatementMatch, "effective_balance_after">,
  statementBalance: string | null,
  version: number,
): StatementDecision["balance_choice"] {
  if (!selection || selection.version !== version
    || selection.existing_balance_after !== match.effective_balance_after
    || selection.statement_balance_after !== statementBalance) return undefined;
  return { keep: selection.keep, existing_balance_after: selection.existing_balance_after, statement_balance_after: selection.statement_balance_after };
}
