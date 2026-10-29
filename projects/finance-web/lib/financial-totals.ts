/** Exact minor-unit totals for every loaded filtered record, never just the current page. */
export function filteredFinancialTotals(records: readonly { account: string; type: string; direction: string; amount: string; transfer_account?: string | null }[], currencies: ReadonlyMap<string, string>, selectedAccount = "") {
  const totals = new Map<string, { currency: string; income: bigint; spending: bigint; refunds: bigint; financingIn: bigint; financingOut: bigint; moneyIn: bigint; moneyOut: bigint; transfers: bigint }>();
  for (const row of records) {
    const currency = currencies.get(row.account) ?? "Unknown currency";
    let result = totals.get(currency);
    if (!result) { result = { currency, income: BigInt(0), spending: BigInt(0), refunds: BigInt(0), financingIn: BigInt(0), financingOut: BigInt(0), moneyIn: BigInt(0), moneyOut: BigInt(0), transfers: BigInt(0) }; totals.set(currency, result); }
    const [units, decimals = ""] = row.amount.split(".");
    const amount = BigInt(units) * BigInt(100) + BigInt(decimals.padEnd(2, "0"));
    if (row.type === "transfer") {
      result.transfers += amount;
      if (selectedAccount) { if (row.transfer_account === selectedAccount) result.moneyIn += amount; else result.moneyOut += amount; }
      continue;
    }
    const credit = row.direction === "credit";
    if (credit) result.moneyIn += amount; else result.moneyOut += amount;
    if (row.type === "income") result.income += amount;
    if (row.type === "expense" || row.type === "fee") result.spending += amount;
    if (row.type === "refund") { result.spending -= amount; result.refunds += amount; }
    if (["borrow", "repayment_received"].includes(row.type)) result.financingIn += amount;
    if (["lend", "repayment_paid"].includes(row.type)) result.financingOut += amount;
  }
  const decimal = (value: bigint) => `${value < BigInt(0) ? "-" : ""}${(value < BigInt(0) ? -value : value) / BigInt(100)}.${((value < BigInt(0) ? -value : value) % BigInt(100)).toString().padStart(2, "0")}`;
  return Array.from(totals.values()).map(row => ({ currency: row.currency, income: decimal(row.income), spending: decimal(row.spending), refunds: decimal(row.refunds), financingIn: decimal(row.financingIn), financingOut: decimal(row.financingOut), moneyIn: decimal(row.moneyIn), moneyOut: decimal(row.moneyOut), transfers: decimal(row.transfers), net: decimal(row.moneyIn - row.moneyOut) }));
}

function minorAmount(value: string): bigint {
  const negative = value.startsWith("-");
  const [units, decimals = ""] = (negative ? value.slice(1) : value).split(".");
  const amount = BigInt(units) * BigInt(100) + BigInt(decimals.padEnd(2, "0"));
  return negative ? -amount : amount;
}
function amountString(value: bigint): string {
  const magnitude = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${magnitude / BigInt(100)}.${(magnitude % BigInt(100)).toString().padStart(2, "0")}`;
}
export function sumMoneyByCurrency(rows: { currency: string; amount: string }[]) {
  const totals = new Map<string, bigint>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? BigInt(0)) + minorAmount(row.amount));
  return Array.from(totals, ([currency, amount]) => ({ currency, amount: amountString(amount) }));
}
/** Annualized schedule estimate, rounded once per currency; never a ledger posting. */
export function monthlyCommitments(rows: { currency: string; amount: string; frequency: string }[]) {
  const annual = new Map<string, bigint>();
  for (const row of rows) {
    const multiplier = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }[row.frequency] ?? 0;
    annual.set(row.currency, (annual.get(row.currency) ?? BigInt(0)) + minorAmount(row.amount) * BigInt(multiplier));
  }
  return Array.from(annual, ([currency, amount]) => ({ currency, amount: amountString((amount + BigInt(6)) / BigInt(12)) }));
}
