"use client";

import { formatCalendarDate, formatClockTime } from '../../finance-contracts/presentation';
import type { Account, Transaction } from '@/lib/api';

export function TimelineTimingReview({ record, accounts, onEdit }: { record: Transaction; accounts: Account[]; onEdit: () => void }) {
  const sources = record.balance_sources?.observations ?? [];
  return <section className="timeline-timing-review" aria-label="Review balance and timing">
    <h3>Review balance &amp; timing</h3>
    <dl><div><dt>Ledger event date / time</dt><dd>{formatCalendarDate(record.date)} · {record.time ? formatClockTime(record.time) : 'Time unknown'}</dd></div>
      {sources.map((source, index) => <div key={index}><dt>{source.kind === 'sms' ? source.time_kind === 'received' ? 'SMS received (not verified event time)' : 'SMS reported event' : 'Statement reporting / posting date'} · {accounts.find(account => account.id === source.account)?.name ?? 'Account unverified'}</dt><dd>{source.date ? formatCalendarDate(source.date) : 'Date unknown'} · {source.time ? formatClockTime(source.time) : 'Time unknown'} · Balance {source.currency} {source.balance_after ?? 'not reported'}</dd></div>)}
    </dl>
    <p>Statements can post days after an event. Check the event date and time in the original SMS or statement before correcting the ledger. SMS receipt time alone does not establish the event time.</p>
    <button className="button button--ghost button--small" type="button" onClick={onEdit}>Review event date, time &amp; balance</button>
    <p>Corrections are saved through the ledger editor with History and Undo. Original SMS and statement values stay attached. If no time is known, keep it blank and use reviewed placement.</p>
  </section>;
}
