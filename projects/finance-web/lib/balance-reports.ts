import type { Account, Transaction, TransactionSourceMessage, SavedStatementRow, SavedStatement } from './api';

export type BalanceReport = {
  id: string; sourceKey: string; label: string; account: string | null; currency: string | null;
  value: string | null; date: string | null; time: string | null; received?: boolean; original?: boolean; reference?: string;
};
export type BalanceGroup = {
  account: string | null; name: string; currency: string | null; primary: string | null;
  reports: BalanceReport[]; sourceCount: number; differs: boolean;
};
export function balanceValueKey(value: string | null) {
  if (value === null || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const normalized = `${whole.replace(/^(-?)0+(?=\d)/, '$1')}.${fraction.replace(/0+$/, '')}`;
  return normalized === '-0.' ? '0.' : normalized;
}

/** The selected ledger value stays primary, even when reports disagree or it was cleared. */
export function groupBalanceReports(
  selections: { account: string | null; name: string; currency: string | null; value: string | null }[], reports: BalanceReport[],
): BalanceGroup[] {
  return selections.map(selection => {
    const own = [...new Map(reports.filter(report => report.account === selection.account && report.currency === selection.currency).map(report => [report.id, report])).values()];
    const values = new Set(own.map(report => balanceValueKey(report.value)).filter((value): value is string => value !== null));
    const primary = balanceValueKey(selection.value);
    return { account: selection.account, name: selection.name, currency: selection.currency, primary: selection.value,
      reports: own, sourceCount: new Set(own.filter(report => report.original !== false).map(report => report.sourceKey)).size,
      differs: selection.currency !== null && (values.size > 1 || (primary !== null && [...values].some(value => value !== primary))) };
  });
}

export function transactionBalanceReports(record: Transaction, accounts: Account[], extra?: {
  messages: TransactionSourceMessage[] | null; rows: SavedStatementRow[] | null; batches: Record<string, SavedStatement>;
}): BalanceReport[] {
  const currency = (id: string | null) => accounts.find(account => account.id === id)?.currency ?? null;
  const evidence = record.transfer_evidence.filter(item => record.type !== 'transfer' ||
    (item.account === record.account && item.direction === 'debit') || (item.account === record.transfer_account && item.direction === 'credit'));
  const messages = extra?.messages;
  const rows = extra?.rows;
  const reports: BalanceReport[] = evidence.filter(item =>
    !(item.raw_message && messages?.some(message => message.id === item.raw_message)) && !(item.source === 'import' && rows?.length)
  ).map(item => ({ id: `evidence:${item.id}`, sourceKey: item.raw_message ? `sms:${item.raw_message}` : `evidence:${item.id}`,
    original: item.source === 'sms' || item.source === 'import', label: item.source === 'sms' ? 'SMS' : item.source === 'import' ? 'Saved statement report' : 'Saved ledger report',
    account: item.account, currency: currency(item.account), value: item.balance_after, date: item.date, time: item.time, reference: item.reference }));
  for (const message of messages ?? []) {
    const observation = evidence.find(item => item.raw_message === message.id);
    const account = observation?.account ?? message.parsed?.account ?? null;
    reports.push({ id: `sms:${message.id}`, sourceKey: `sms:${message.id}`, label: `SMS · ${message.sender}`,
      account, currency: observation ? currency(observation.account) : message.parsed?.currency ?? currency(account),
      value: message.parsed?.balance_after ?? observation?.balance_after ?? null,
      date: observation?.date ?? message.received_at, time: observation ? observation.time : null, received: !observation, reference: message.parsed?.reference ?? observation?.reference });
  }
  for (const row of rows ?? []) {
    const batch = extra?.batches[row.batch];
    reports.push({ id: `statement:${row.id}`, sourceKey: `statement:${row.batch}`, label: `Statement · page ${row.extracted.page}, row ${row.extracted.row}`,
      account: batch?.account ?? null, currency: batch?.currency ?? null, value: row.extracted.balance_after, date: row.extracted.date, time: row.extracted.time, reference: row.extracted.reference });
  }
  return reports;
}
