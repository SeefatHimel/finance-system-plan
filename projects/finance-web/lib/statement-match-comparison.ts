/** Visual comparisons are distinct from whether an account report may replace another. */
export type StatementComparisonFacts = {
  amount: string | null; account: string | null; transferAccount?: string | null;
  date: string | null; time: string | null; type: string; category: string | null;
  balance: string | null; reference: string; description: string;
};

function moneyDifferent(left: string | null, right: string | null) {
  return left !== null && right !== null && left.trim() !== "" && right.trim() !== "" && Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Number(left) !== Number(right);
}
function clock(value: string) { return value.length === 5 ? `${value}:00` : value; }

export function statementComparisonDifferences(statement: StatementComparisonFacts, ledger: StatementComparisonFacts) {
  return {
    amount: moneyDifferent(statement.amount, ledger.amount),
    path: (statement.type === "transfer") !== (ledger.type === "transfer")
      || Boolean(statement.account && ledger.account && statement.account !== ledger.account)
      || Boolean(statement.transferAccount && ledger.transferAccount && statement.transferAccount !== ledger.transferAccount),
    date: Boolean(statement.date && ledger.date && statement.date !== ledger.date),
    time: Boolean(statement.time && ledger.time && clock(statement.time) !== clock(ledger.time)),
    classification: statement.type !== ledger.type || statement.category !== ledger.category,
    balance: moneyDifferent(statement.balance, ledger.balance),
    reference: Boolean(statement.reference.trim() && ledger.reference.trim() && statement.reference.trim().toLocaleLowerCase() !== ledger.reference.trim().toLocaleLowerCase()),
    descriptionNumbers: descriptionNumberDifferences(statement.description, ledger.description),
  };
}

/** Preserve whole printed values; a suffix or shared prefix is not an exact code match.
 * These are text differences only: unlabelled masks do not establish whose account it is.
 */
export function descriptionNumberDifferences(left: string, right: string) {
  const values = (text: string) => [...new Set(text.match(/\d{2,}(?:[*Xx•…]+\d*)+[*Xx•…]*|[*Xx•…]{2,}\d{3,}[*Xx•…]?|\d{6,}/g) ?? [])];
  const a = values(left), b = values(right);
  return { statement: a.filter(value => !b.includes(value)), ledger: b.filter(value => !a.includes(value)), hasDifference: a.length > 0 && b.length > 0 && (a.some(value => !b.includes(value)) || b.some(value => !a.includes(value))) };
}

export function descriptionDifferenceParts(text: string, differingValues: string[]) {
  const values = [...differingValues].sort((a, b) => b.length - a.length);
  const parts: { text: string; different: boolean }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let found = text.length, selected = "";
    for (const value of values) {
      const at = text.indexOf(value, cursor);
      if (at >= 0 && at < found) { found = at; selected = value; }
    }
    if (!selected) { parts.push({ text: text.slice(cursor), different: false }); break; }
    if (found > cursor) parts.push({ text: text.slice(cursor, found), different: false });
    parts.push({ text: selected, different: true }); cursor = found + selected.length;
  }
  return parts;
}
