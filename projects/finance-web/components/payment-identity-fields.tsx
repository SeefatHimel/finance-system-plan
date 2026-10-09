"use client";

export type ExtraIdentifier = { kind: "account" | "card"; value: string; label: string };
export type IdentifierKind = "any" | "account" | "card";

export function PaymentIdentityFields({ kind, onKind, identifiers, onIdentifiers, aliases, onAliases, disabled = false }: {
  kind: IdentifierKind; onKind: (value: IdentifierKind) => void;
  identifiers: ExtraIdentifier[]; onIdentifiers: (value: ExtraIdentifier[]) => void;
  aliases: string; onAliases: (value: string) => void; disabled?: boolean;
}) {
  function update(index: number, values: Partial<ExtraIdentifier>) {
    onIdentifiers(identifiers.map((entry, i) => i === index ? { ...entry, ...values } : entry));
  }
  return <fieldset className="field--wide payment-identity-fields" disabled={disabled}>
    <legend>Identifiers &amp; optional labels</legend>
    <label className="field"><span className="field__label">Primary identifier type</span><select className="field__control" value={kind} onChange={event => onKind(event.target.value as IdentifierKind)}><option value="any">Unspecified</option><option value="account">Bank / wallet account</option><option value="card">Card</option></select></label>
    {identifiers.map((entry, index) => <div className="payment-identity-row" key={index}>
      <label className="field"><span className="field__label">Identifier {index + 1} type</span><select className="field__control" value={entry.kind} onChange={event => update(index, { kind: event.target.value as ExtraIdentifier["kind"] })}><option value="account">Account</option><option value="card">Card</option></select></label>
      <label className="field"><span className="field__label">Identifier {index + 1} number</span><input className="field__control" required maxLength={120} value={entry.value} placeholder="****1234" onChange={event => update(index, { value: event.target.value })} /></label>
      <label className="field"><span className="field__label">Identifier {index + 1} label</span><input className="field__control" maxLength={80} value={entry.label} placeholder="Everyday debit card" onChange={event => update(index, { label: event.target.value })} /></label>
      <button className="button" type="button" aria-label={`Remove identifier ${index + 1}`} onClick={() => onIdentifiers(identifiers.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <button className="button" type="button" disabled={identifiers.length >= 20} onClick={() => onIdentifiers([...identifiers, { kind: "account", value: "", label: "" }])}>Add another identifier</button>
    <label className="field"><span className="field__label">Text aliases</span><textarea className="field__control" value={aliases} onChange={event => onAliases(event.target.value)} placeholder={"PathaoPay\nPathao Pay"} /><span className="field__hint">One name per line, up to 20. Save numbers above. Mappings improve suggestions and display; existing transactions stay unchanged.</span></label>
  </fieldset>;
}
