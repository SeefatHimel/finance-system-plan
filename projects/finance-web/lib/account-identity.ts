import type { PaymentProvider } from "../../finance-contracts/generated/types";

export type AccountIdentityDraft = {
  enabled: boolean;
  provider: PaymentProvider;
  identifier: string;
  identifier_kind: "any" | "account" | "card";
  additional_identifiers: { kind: "account" | "card"; value: string; label: string }[];
  aliases: string;
};

export function emptyAccountIdentity(): AccountIdentityDraft {
  return { enabled: false, provider: "bank", identifier: "", identifier_kind: "account", additional_identifiers: [], aliases: "" };
}

/** Mirror API masking before transmission; never send an unmasked full number. */
export function safeAccountIdentifier(value: string): string {
  const compact = value.replace(/\s+/g, "").replace(/^[-:]+|[-:]+$/g, "");
  const digits = compact.replace(/[^0-9]/g, "");
  if (digits.length < 4) throw new Error("Enter a masked account/card number or at least four digits.");
  return digits.length <= 10 && /[*xX•…]/.test(compact) ? compact.slice(0, 120) : digits.slice(-4);
}

export function accountIdentityInput(draft: AccountIdentityDraft) {
  if (!draft.enabled) return null;
  const identifier = draft.identifier.trim() ? safeAccountIdentifier(draft.identifier) : "";
  const additional_identifiers = draft.additional_identifiers.map(entry => ({ ...entry, value: safeAccountIdentifier(entry.value) }));
  const aliases = [...new Set(draft.aliases.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
  if (!identifier && !additional_identifiers.length && !aliases.length) throw new Error("Add an account/card identifier or a text alias, or disable recognition.");
  return { provider: draft.provider, identifier, identifier_kind: draft.identifier_kind, additional_identifiers, aliases };
}
