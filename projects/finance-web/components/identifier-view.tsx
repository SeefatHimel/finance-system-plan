"use client";

import { useEffect, useState } from "react";
import type { PaymentMethod } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

type IdentifierView = "number" | "label" | "both";

function score(saved: string, observed: string) {
  const normalize = (value: string) => value.replace(/\s/g, "").toLowerCase().replaceAll("x", "*");
  const [a, b] = [normalize(saved), normalize(observed)];
  const [ad, bd] = [a.replace(/\D/g, ""), b.replace(/\D/g, "")];
  if (ad.length < 4 || bd.length < 4 || ad.slice(-4) !== bd.slice(-4)) return 0;
  if (a === b && ad.length > 4) return 100;
  const prefix = (value: string, digits: string) => value.match(/^\d+(?=[*•…])/)?.[0] ?? (/^\d+$/.test(value) && digits.length > 4 ? digits.slice(0, -4) : "");
  const ap = prefix(a, ad), bp = prefix(b, bd);
  if (ap && bp && !ap.startsWith(bp) && !bp.startsWith(ap)) return 0;
  return ap && bp ? 60 : 30;
}

export function identifierLabel(value: string, kind: "account" | "card", methods: PaymentMethod[], accountNames: Map<string, string>, account?: string) {
  let best = 0;
  let matches: { account: string; label: string }[] = [];
  for (const method of methods) {
    if (!method.is_active || (account && method.account !== account)) continue;
    const entries = [{ kind: method.identifier_kind, value: method.identifier, label: method.name }, ...method.additional_identifiers];
    for (const entry of entries) {
      if (entry.kind !== "any" && entry.kind !== kind) continue;
      const strength = score(entry.value, value);
      if (!strength || strength < best) continue;
      if (strength > best) { best = strength; matches = []; }
      matches.push({ account: method.account, label: entry.label || method.name });
    }
  }
  if (new Set(matches.map(match => match.account)).size !== 1) return null;
  const labels = new Set(matches.map(match => match.label));
  return labels.size === 1 ? matches[0].label : accountNames.get(matches[0].account) ?? null;
}

export function useIdentifierView() {
  const { session } = useAuth();
  const [view, setView] = useState<IdentifierView>("number");
  const key = session.status === "signed-in" ? `finance.identifiers.view.v1.${session.user.id}` : null;
  useEffect(() => {
    let next: IdentifierView = "number";
    try { const stored = key ? localStorage.getItem(key) : null; if (stored === "number" || stored === "label" || stored === "both") next = stored; } catch { /* Storage is optional. */ }
    setView(next);
  }, [key]);
  function change(value: IdentifierView) {
    setView(value);
    try { if (key) localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
  }
  const control = <label className="field"><span className="field__label">Identifier display</span><select className="field__control" value={view} onChange={event => change(event.target.value as IdentifierView)}><option value="number">Numbers</option><option value="label">Labels</option><option value="both">Both</option></select><span className="field__hint">Display only. Unmapped or ambiguous values keep their number.</span></label>;
  function format(value: string, label: string | null) {
    if (!value) return "—";
    if (!label || view === "number") return value;
    return view === "label" ? label : `${label} (${value})`;
  }
  return { control, format };
}
