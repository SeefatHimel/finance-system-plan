"use client";

import { useEffect, useRef, useState } from 'react';
import { sourceChecksUnavailable } from '@/lib/balance-source-badges';
import type { Transaction } from '@/lib/api';

/** One automatic status for the loaded collection, never a task on every card. */
export function BalanceSourceStatus({ transactions, onRetry }: { transactions: Transaction[]; onRetry: () => Promise<unknown> }) {
  const count = sourceChecksUnavailable(transactions);
  const unavailable = count > 0;
  const [attempt, setAttempt] = useState(0);
  const retry = useRef(onRetry); retry.current = onRetry;
  useEffect(() => {
    if (!unavailable) { setAttempt(0); return; }
    if (attempt >= 2) return;
    let active = true;
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => retry.current()).catch(() => {}).finally(() => { if (active) setAttempt(value => value + 1); });
    }, attempt === 0 ? 1500 : 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [unavailable, attempt]);
  if (!unavailable) return null;
  return <p className="balance-source-status" role="status">{attempt < 2 ? 'Checking balance sources automatically…' : 'Some balance source checks are unavailable.'} <span>{count} loaded {count === 1 ? 'entry' : 'entries'}. This is an app check; no individual approval is needed. {attempt >= 2 ? 'The API may need updating, or source results may be incomplete.' : ''}</span>{attempt >= 2 ? <button type="button" className="text-button" onClick={() => setAttempt(0)}>Retry source checks</button> : null}</p>;
}
