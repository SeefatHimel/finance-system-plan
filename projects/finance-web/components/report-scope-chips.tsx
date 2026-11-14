import type { Account, Category } from "@/lib/api";
import { displayLabel } from "../../finance-contracts/presentation";
import type { ReportRules } from "@/lib/report-rules";
import { X } from "@phosphor-icons/react";

export function ReportScopeChips({ rules, accounts, categories, onChange, accountsOnly = false }: {
  rules: ReportRules; accounts: Account[]; categories: Category[]; onChange?: (rules: ReportRules) => void; accountsOnly?: boolean;
}) {
  const chips: { key: string; label: string; excluded?: boolean; remove: () => ReportRules }[] = [];
  for (const field of ["accounts", "excluded_accounts", "categories", "excluded_categories", "types", "sources", "directions"] as const) {
    for (const id of rules[field]) {
      const account = field.includes("accounts"), category = field.includes("categories"), excluded = field.startsWith("excluded_");
      const name = account ? accounts.find(row => row.id === id)?.name ?? "Unavailable account" : category ? id === "uncategorized" ? "Uncategorized" : categories.find(row => row.id === id)?.name ?? "Unavailable category" : displayLabel(id);
      chips.push({ key: `${field}-${id}`, label: `${excluded ? "Exclude: " : ""}${name}`, excluded, remove: () => ({ ...rules, [field]: rules[field].filter(value => value !== id) }) });
    }
  }
  if (rules.search) chips.push({ key: "search", label: `Search: ${rules.search}`, remove: () => ({ ...rules, search: "" }) });
  if (rules.min_amount || rules.max_amount) chips.push({ key: "amount", label: `Amount: ${rules.min_amount ?? "0"}–${rules.max_amount ?? "any"}`, remove: () => ({ ...rules, min_amount: null, max_amount: null }) });
  return <div className="report-scope-chips" aria-label={onChange ? "Selected report filters" : "Saved report scope"}>
    {!rules.accounts.length ? <span className="report-scope-chip">All accounts in report currency</span> : null}
    {!accountsOnly && !rules.categories.length ? <span className="report-scope-chip">All categories</span> : null}
    {chips.map(chip => onChange ? <button type="button" className={`report-scope-chip${chip.excluded ? " report-scope-chip--excluded" : ""}`} key={chip.key} onClick={() => onChange(chip.remove())} aria-label={`Remove filter ${chip.label}`}><span>{chip.label}</span><X size={13} aria-hidden="true" /></button> : <span className={`report-scope-chip${chip.excluded ? " report-scope-chip--excluded" : ""}`} key={chip.key}>{chip.label}</span>)}
  </div>;
}
