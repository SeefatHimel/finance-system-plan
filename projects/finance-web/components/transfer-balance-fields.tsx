"use client";

import { useId } from "react";
import { HelpTooltip } from "@/components/help-tooltip";

/** Keep the original reporting account visible; a second report is optional. */
export function TransferBalanceFields({ accounts, primaryAccount, names, values, onChange, error }: {
  error?: string;
  accounts: string[];
  primaryAccount: string;
  names: Map<string, string>;
  values: Record<string, string>;
  onChange: (account: string, value: string) => void;
}) {
  const id = useId();
  const ordered = primaryAccount === accounts[1] ? [...accounts].reverse() : accounts;
  const field = (account: string, index: number) => <div className="field">
    <div className="inline-help"><label className="field__label" htmlFor={`${id}-${index}`}>Balance after · {names.get(account) ?? "Select account"}</label>
      <HelpTooltip label={`About reported balance for ${names.get(account) ?? "this account"}`}>Optional balance reported by this account, rather than the calculated ledger balance. It stays with this account when direction changes. Leave blank if unknown.</HelpTooltip>
    </div>
    <input name="reported_balances" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} id={`${id}-${index}`} className="field__control" aria-label={`Reported balance after — ${names.get(account) ?? "Select account"}`} inputMode="decimal" type="text" disabled={!account} value={values[account] ?? ""} onChange={event => onChange(account, event.target.value)} />
  </div>;
  return <>
    <div>{field(ordered[0], 0)}{error ? <small className="field-error" id={`${id}-error`}>{error}</small> : null}</div>
    <details className="raw-message" key={ordered[1] || "other-account"}>
      <summary>Other account balance{values[ordered[1]] ? " · Saved" : ""}</summary>
      {field(ordered[1], 1)}
    </details>
  </>;
}
