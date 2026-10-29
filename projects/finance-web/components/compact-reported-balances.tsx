"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/lib/auth-storage';
import { useToast } from '@/components/toast-provider';
import { listTransactionSourceMessages, listTransactionStatementEvidence, getStatementImport } from '@/lib/api';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { HelpTooltip } from '@/components/help-tooltip';
import { detailBalances } from '@/lib/transaction-detail';
import { groupBalanceReports, transactionBalanceReports, type BalanceReport } from '@/lib/balance-reports';
import type { Account, Transaction } from '@/lib/api';
import { formatCurrency, formatCalendarDate, formatClockTime, formatTimestamp } from '../../finance-contracts/presentation';

function valueLabel(value: string | null, currency: string | null) {
  return value === null ? 'Not reported' : currency ? formatCurrency(value, currency) : `${value} (currency unverified)`;
}
function reportTime(report: BalanceReport) {
  if (!report.date) return 'Date not reported';
  if (report.received) return `Received ${formatTimestamp(report.date)}`;
  return `${formatCalendarDate(report.date)} · ${report.time ? formatClockTime(report.time) : 'Time not reported'}`;
}

/** One primary value per account; source evidence is disclosed without changing it. */
export function CompactReportedBalances({ record, accounts, reports: provided, incomplete = false, onlyAccount, showNames = record.type === 'transfer' }: {
  record: Transaction; accounts: Account[]; reports?: BalanceReport[]; incomplete?: boolean; onlyAccount?: string; showNames?: boolean;
}) {
  const [loaded, setLoaded] = useState<{ reports: BalanceReport[]; incomplete: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  const { notify } = useToast();
  useEffect(() => { setLoaded(null); setLoading(false); request.current?.abort(); request.current = null; return () => request.current?.abort(); }, [record]);
  const loadReports = useCallback(() => {
    if (provided || (loaded && !loaded.incomplete) || request.current) return;
    const token = getAccessToken(); if (!token) return;
    const controller = new AbortController(); request.current = controller; setLoading(true);
    void (async () => {
      const [messages, rows] = await Promise.allSettled([listTransactionSourceMessages(token, record.id, controller.signal), listTransactionStatementEvidence(token, record.id, controller.signal)]);
      if (controller.signal.aborted) return;
      const sourceRows = rows.status === 'fulfilled' ? rows.value : null;
      const ids = [...new Set(sourceRows?.map(row => row.batch) ?? [])];
      const metadata = await Promise.allSettled(ids.map(id => getStatementImport(token, id, controller.signal)));
      if (controller.signal.aborted) return;
      const failed = messages.status === 'rejected' || rows.status === 'rejected' || metadata.some(item => item.status === 'rejected');
      const batches = Object.fromEntries(metadata.flatMap((item, index) => item.status === 'fulfilled' ? [[ids[index], item.value]] : []));
      setLoaded({ reports: transactionBalanceReports(record, accounts, { messages: messages.status === 'fulfilled' ? messages.value : null, rows: sourceRows, batches }), incomplete: failed });
      if (failed) notify('Some balance source details could not be checked. The selected ledger balance is unchanged.', 'error');
    })().catch(() => { if (!controller.signal.aborted) { setLoaded({ reports: transactionBalanceReports(record, accounts), incomplete: true }); notify('Balance sources are unavailable. The selected ledger balance is unchanged.', 'error'); } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); request.current = null; } });
  }, [provided, loaded, record, accounts, notify]);
  const selected = detailBalances(record);
  const ids = record.type === 'transfer' ? [...new Set([record.account, record.transfer_account].filter((id): id is string => Boolean(id)))] : [record.account];
  const reports = provided ?? loaded?.reports ?? transactionBalanceReports(record, accounts);
  const partial = incomplete || Boolean(loaded?.incomplete);
  const sourceHint = Boolean(record.raw_message || record.statement_evidence_count || record.transfer_evidence.length);
  const selections = ids.map(id => ({ account: id, name: accounts.find(account => account.id === id)?.name ?? 'Account unavailable', currency: accounts.find(account => account.id === id)?.currency ?? null, value: selected[id] ?? null }));
  const groups = groupBalanceReports(selections, reports);
  const unassigned = reports.filter(report => !selections.some(selection => report.account === selection.account && report.currency === selection.currency));
  return <span className="compact-reported-balances">
    {groups.filter(group => !onlyAccount || group.account === onlyAccount).map(group => <span className="compact-reported-balance" key={group.account}>
      {showNames ? <span className="compact-reported-balance__account" title={group.name}>{group.name}</span> : null}
      <span className="compact-reported-balance__value">{valueLabel(group.primary, group.currency)}
        {group.reports.length || sourceHint || partial ? <HelpTooltip onOpen={loadReports} warning={group.differs || partial} label={`${group.name}: ${group.differs ? 'reported balances differ' : 'balance source details'}${partial ? '; some sources unavailable' : ''}`} textTrigger={<span className="compact-reported-balance__indicator">{group.differs || partial ? <WarningCircle size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}{group.differs ? 'Reports differ' : partial ? 'Incomplete' : loading ? 'Checking…' : !loaded && !provided ? 'Sources' : group.sourceCount ? `${group.sourceCount} ${group.sourceCount === 1 ? 'source' : 'sources'}` : loaded || provided ? 'Saved reports' : 'Source details'}</span>}>
          <strong>{group.name} · balance reports</strong>
          <p>Selected ledger balance: {valueLabel(group.primary, group.currency)}</p>
          {group.differs ? <p>Values differ. Reports from different times can both be valid.</p> : null}
          {loading ? <p role="status">Checking original sources…</p> : null}
          {partial ? <p>Some source details could not be checked. Agreement is not established for unavailable reports.</p> : null}
          <ul className="balance-report-list">{group.reports.map(report => <li key={report.id}><strong>{report.label}</strong><span>{valueLabel(report.value, report.currency)}</span><small>{reportTime(report)}</small>{report.reference ? <small>Reference: {report.reference}</small> : null}</li>)}</ul>
          {!group.reports.length && !loading && !partial ? <p>No source reports are available for this account.</p> : null}
        </HelpTooltip> : null}
      </span>
    </span>)}
    {record.type === 'transfer' && record.balance_after !== null && !Object.keys(selected).length && !onlyAccount ? <span className="compact-reported-balance__unassigned">{valueLabel(record.balance_after, null)} · reporting account unverified</span> : null}
    {unassigned.length && !onlyAccount ? <HelpTooltip warning label="Reports with unverified account or currency" textTrigger={<span className="compact-reported-balance__indicator"><WarningCircle size={14} aria-hidden="true" />Unassigned reports</span>}><strong>Reporting account or currency is unverified</strong><ul className="balance-report-list">{unassigned.map(report => <li key={report.id}><strong>{report.label}</strong><span>{valueLabel(report.value, report.currency)}</span><small>{reportTime(report)}</small>{report.reference ? <small>Reference: {report.reference}</small> : null}</li>)}</ul></HelpTooltip> : null}
  </span>;
}
