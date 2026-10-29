export type BalanceSource = { kind: 'sms' | 'statement'; account: string | null; balance_after: string | null; currency: string; direction: string; date: string | null; time: string | null; time_kind: 'reported' | 'received'; usable: boolean };
export type BalanceSources = { observations: BalanceSource[]; complete: boolean };
export type BalanceBadge = { kind: 'sms' | 'statement' | 'calculated' | 'unchecked'; label: string; tone: 'ok' | 'warning' | 'idle'; detail: string; clock?: boolean };
function cents(value: string | null) {
  if (value === null || !/^-?\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(result) ? negative ? -result : result : null;
}
const clock = (value: string | null) => value?.length === 5 ? `${value}:00` : value;
export function balanceSourceBadges(input: { value: string | null; account: string; currency: string; date: string; time: string | null; direction: string; sources?: BalanceSources | null; calculated?: boolean }): BalanceBadge[] {
  const badges: BalanceBadge[] = [];
  if (input.calculated) badges.push({kind:'calculated',label:'Calculated',tone:'idle',detail:'Calculated ledger balance; this is not an original source report.'});
  if (input.value === null) return badges;
  if (!input.sources || !input.sources.complete) return [...badges,{kind:'unchecked',label:'Sources unchecked',tone:'idle',detail:'Source balance checks are unavailable or incomplete. This is not a verified match.'}];
  const value = cents(input.value);
  for (const kind of ['sms','statement'] as const) {
    const name = kind === 'sms' ? 'SMS' : 'Statement';
    const sources = input.sources.observations.filter(item => item.kind === kind && (item.account === input.account || item.account === null));
    if (!sources.length) continue;
    const valid = sources.filter(item => item.account === input.account && item.usable && item.currency === input.currency && item.direction === input.direction && cents(item.balance_after) !== null);
    if (!valid.length || valid.length !== sources.length || value === null) {
      badges.push({kind,label:`${name} unverified`,tone:'warning',detail:'The balance, reporting account, currency or direction is unknown or incompatible. Check the original source.'});continue;
    }
    const agrees = valid.filter(item => cents(item.balance_after) === value);
    const detail = valid.map(item => `${name}: ${item.currency} ${item.balance_after}; ${item.date ?? 'date unknown'} ${item.time ?? 'time unknown'}${item.time_kind === 'received' ? ' (SMS receipt time)' : ''}`).join(' | ');
    if (agrees.length !== valid.length) {
      badges.push({kind,label:agrees.length ? `${name} conflicts` : `${name} differs`,tone:'warning',detail:`${detail}. Balance values differ; reporting times may differ too. This does not prove a missing movement.`});continue;
    }
    const sameMoment = valid.every(item => item.time_kind === 'reported' && item.date === input.date && item.time !== null && input.time !== null && clock(item.time) === clock(input.time));
    badges.push({kind,label:sameMoment ? `Matches ${name}` : `${name} value agrees`,tone:sameMoment ? 'ok' : 'warning',clock:!sameMoment,detail:`${detail}. ${sameMoment ? 'Exact balance agreement for this account, direction, currency and reported time; this does not verify every transaction detail.' : 'Numeric agreement only: source event time is missing, different, or based on SMS receipt time.'}`});
  }
  return badges;
}
