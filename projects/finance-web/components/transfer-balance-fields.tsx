"use client";

/** Keep the original reporting account visible; a second report is optional. */
export function TransferBalanceFields({ accounts, primaryAccount, names, values, onChange }: {
  accounts: string[];
  primaryAccount: string;
  names: Map<string, string>;
  values: Record<string, string>;
  onChange: (account: string, value: string) => void;
}) {
  const ordered = primaryAccount === accounts[1] ? [...accounts].reverse() : accounts;
  const field = (account: string) => <label className="field">
    <span className="field__label">Reported balance after — {names.get(account) ?? "Select account"} (optional)</span>
    <input className="field__control" aria-label={`Reported balance after — ${names.get(account) ?? "Select account"}`} inputMode="decimal" type="text" disabled={!account} value={values[account] ?? ""} onChange={event => onChange(account, event.target.value)} />
    <small className="field__hint">This balance stays with this account when direction changes. Leave blank if unknown.</small>
  </label>;
  return <>
    {field(ordered[0])}
    <details className="raw-message" key={ordered[1] || "other-account"}>
      <summary>Other account’s reported balance (optional){values[ordered[1]] ? " · Saved" : ""}</summary>
      {field(ordered[1])}
    </details>
  </>;
}
