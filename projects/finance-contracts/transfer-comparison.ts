/** Present the reviewed draft in the same money-flow direction as API matches. */
export function transferComparison(draft: {
  account?: string | null;
  transfer_account?: string | null;
  direction?: string;
  amount?: string;
  date?: string;
  time?: string | null;
  reference?: string;
  counterparty_text?: string;
  note?: string;
  balance_after?: string | null;
  reported_balances?: { account: string; balance_after: string | null }[];
}, accountName: (id: string) => string | undefined) {
  const incoming = draft.direction === "credit";
  const sender = incoming ? draft.transfer_account : draft.account;
  const receiver = incoming ? draft.account : draft.transfer_account;
  return {
    reported_balances: (draft.reported_balances ?? (draft.account && draft.balance_after != null ? [{ account: draft.account, balance_after: draft.balance_after }] : [])).map(item => ({ ...item, account_name: accountName(item.account) ?? "Unknown account" })),
    account_name: sender ? accountName(sender) ?? "Unknown sender" : "Unknown sender",
    transfer_account_name: receiver ? accountName(receiver) ?? "Unknown destination" : "Unknown destination",
    amount: draft.amount ?? "",
    date: draft.date ?? "",
    time: draft.time ?? null,
    reference: draft.reference ?? "",
    counterparty_text: draft.counterparty_text ?? "",
    note: draft.note ?? "",
  };
}


/** Only reports for the same account can disagree; unknown is never a conflict. */
export function transferBalanceConflicts(existing: { account: string; balance_after: string | null }[], incoming: { account: string; balance_after: string | null }[]) {
  return incoming.flatMap(report => {
    const previous = existing.find(item => item.account === report.account);
    if (previous?.balance_after == null || report.balance_after == null || Number(previous.balance_after.replaceAll(",", "")) === Number(report.balance_after.replaceAll(",", ""))) return [];
    return [{ account: report.account, existing_balance_after: previous.balance_after, incoming_balance_after: report.balance_after.replaceAll(",", "") }];
  });
}
