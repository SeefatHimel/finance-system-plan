"use client";

import { ChatText, FileText, Calculator, Clock, WarningCircle, CheckCircle } from '@phosphor-icons/react';
import { HelpTooltip } from '@/components/help-tooltip';
import { balanceSourceBadges } from '@/lib/balance-source-badges';
export function BalanceSourceBadges(props: Parameters<typeof balanceSourceBadges>[0]) {
  const badges = balanceSourceBadges(props);
  if (!badges.length) return null;
  return <span className="balance-source-badges" aria-label="Balance source checks">{badges.map(badge => {
    const Icon = badge.kind === 'sms' ? ChatText : badge.kind === 'statement' ? FileText : badge.kind === 'calculated' ? Calculator : WarningCircle;
    return <HelpTooltip key={badge.kind} label={`Balance: ${badge.label}`} warning={badge.tone === 'warning'} textTrigger={
      <span className={`balance-source-badge balance-source-badge--${badge.tone}`}><Icon size={13} aria-hidden="true" />{badge.label}{badge.clock ? <Clock size={12} aria-hidden="true" /> : badge.tone === 'ok' ? <CheckCircle size={12} aria-hidden="true" /> : null}</span>
    }><strong>{badge.label}</strong><p>{badge.detail}</p></HelpTooltip>;
  })}</span>;
}
