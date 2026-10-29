"use client";

import { Calculator, ChatText, Clock, FileText, WarningCircle } from '@phosphor-icons/react';
import { balanceSourceBadges } from '@/lib/balance-source-badges';

type Props = Parameters<typeof balanceSourceBadges>[0] & { details?: boolean };

/** Card icons belong to the card button; full, non-hover-only explanations live in its inspector. */
export function TimelineBalanceStatus({ details = false, ...input }: Props) {
  const badges = balanceSourceBadges(input);
  if (!badges.length) return details ? <p className="timeline-source-checks__empty">{input.value === null ? 'No ledger balance is reported for this account.' : !input.sources?.complete ? 'Source checks are unavailable. Refresh to retry; no individual approval is needed.' : 'No attached source reports for this balance.'}</p> : null;
  if (details) return <section className="timeline-source-checks" aria-label="Balance source checks"><h4>Balance source checks</h4><ul>{badges.map(badge => <li key={badge.kind}><strong>{badge.label}</strong><p>{badge.detail}</p></li>)}</ul></section>;
  return <span className="timeline-source-icons">{badges.map(badge => {
    const Icon = badge.kind === 'sms' ? ChatText : badge.kind === 'statement' ? FileText : badge.kind === 'calculated' ? Calculator : WarningCircle;
    const tone = badge.balanceMismatch ? 'mismatch' : badge.clock || badge.tone === 'ok' ? 'agrees' : badge.tone;
    const label = `${badge.label}${badge.clock ? '; event timing unverified' : ''}. Open transaction details for explanation.`;
    return <span className={`timeline-source-icon timeline-source-icon--${tone}`} key={badge.kind} role="img" aria-label={label} title={label}><Icon size={15} aria-hidden="true" />{badge.clock ? <Clock className="timeline-source-icon__clock" size={12} aria-hidden="true" /> : null}</span>;
  })}</span>;
}
