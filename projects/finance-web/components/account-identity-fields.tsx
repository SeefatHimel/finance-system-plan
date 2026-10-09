"use client";

import { PaymentIdentityFields } from "@/components/payment-identity-fields";
import type { AccountIdentityDraft } from "@/lib/account-identity";

const providers: Record<AccountIdentityDraft["provider"], string> = {
  bank: "Bank", ebl: "EBL", city_bank: "City Bank", card: "Other card issuer",
  bkash: "bKash", nagad: "Nagad", rocket: "Rocket", pathao_pay: "Pathao Pay",
  cash: "Cash", manual: "Manual", other: "Other"
};

export function AccountIdentityFields({ value, onChange, disabled }: {
  value: AccountIdentityDraft; onChange: (value: AccountIdentityDraft) => void; disabled: boolean;
}) {
  function update(fields: Partial<AccountIdentityDraft>) { onChange({ ...value, ...fields }); }
  return <div className="field--wide">
    <label className="checkbox-field"><input type="checkbox" checked={value.enabled} disabled={disabled} onChange={event => update({ enabled: event.target.checked })} /> Recognize this account from messages and statements</label>
    <p className="field__hint">Other payment methods saved in SMS settings can also identify this account. Turning this profile off leaves those other mappings available.</p>
    {value.enabled ? <fieldset className="payment-identity-fields" disabled={disabled}>
      <legend>Account recognition</legend>
      <p className="inline-note">Save a masked number or last four digits. Full numbers are reduced to the last four before sending. Multiple cards can belong to the same bank account. Shared suffixes require review.</p>
      <label className="field"><span className="field__label">Bank / wallet provider</span><select aria-label="Bank / wallet provider" className="field__control" value={value.provider} onChange={event => update({ provider: event.target.value as AccountIdentityDraft["provider"] })}>{Object.entries(providers).map(([provider, label]) => <option key={provider} value={provider}>{label}</option>)}</select></label>
      <label className="field"><span className="field__label">Account / card number</span><input aria-label="Account / card number" className="field__control" maxLength={120} autoComplete="off" value={value.identifier} placeholder="****1234 or 1234" onChange={event => update({ identifier: event.target.value })} /></label>
      <PaymentIdentityFields kind={value.identifier_kind} onKind={identifier_kind => update({ identifier_kind })} identifiers={value.additional_identifiers} onIdentifiers={additional_identifiers => update({ additional_identifiers })} aliases={value.aliases} onAliases={aliases => update({ aliases })} disabled={disabled} />
      <p className="field__hint">These mappings are shared with payment methods in SMS settings. They improve future matching; existing transactions and balances stay unchanged.</p>
    </fieldset> : null}
  </div>;
}
