"use client";

import { useState } from "react";
import type { Account, Category } from "@/lib/api";
import { displayLabel } from "../../finance-contracts/presentation";
import { emptyReportRules, setReportRuleChoice, type ReportRules } from "@/lib/report-rules";

function ScopePicker({ label, field, options, value, onChange }: {
  label: string; field: "accounts" | "categories";
  options: { id: string; name: string; detail?: string; disabled?: boolean }[];
  value: ReportRules; onChange: (rules: ReportRules) => void;
}) {
  const [search, setSearch] = useState("");
  const excluded = `excluded_${field}` as const;
  const includedNames = options.filter(row => value[field].includes(row.id)).map(row => row.name);
  const excludedNames = options.filter(row => value[excluded].includes(row.id)).map(row => row.name);
  const visible = options.filter(row => `${row.name} ${row.detail ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return <details className="report-scope-picker">
    <summary><strong>{label}</strong><span>{value[field].length ? `${value[field].length} included` : `All ${label.toLowerCase()}`} {value[excluded].length ? `· ${value[excluded].length} excluded` : ""}</span></summary>
    <div className="report-scope-picker__body">
      <p className="muted-text">{value[field].length ? `Include: ${includedNames.join(", ")}.` : `Include all ${label.toLowerCase()} unless excluded.`} {excludedNames.length ? `Exclude: ${excludedNames.join(", ")}.` : ""}</p>
      <label className="field"><span className="field__label">Search {label.toLowerCase()}</span><input className="field__control" type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="report-scope-picker__options">{visible.map(row => {
        const included = value[field].includes(row.id), isExcluded = value[excluded].includes(row.id);
        return <div className="report-scope-option" key={row.id}><span>{row.name}{row.detail ? <small className="report-comparison">{row.detail}</small> : null}</span><div>
          <label><input type="checkbox" aria-label={`Include ${field === "accounts" ? "account" : "category"} ${row.name}`} checked={included} disabled={row.disabled} onChange={() => onChange(setReportRuleChoice(value, field, row.id, included ? "any" : "include"))} /> Include</label>
          <label><input type="checkbox" aria-label={`Exclude ${field === "accounts" ? "account" : "category"} ${row.name}`} checked={isExcluded} disabled={row.disabled} onChange={() => onChange(setReportRuleChoice(value, field, row.id, isExcluded ? "any" : "exclude"))} /> Exclude</label>
        </div></div>;
      })}{!visible.length ? <p>No matching {label.toLowerCase()}.</p> : null}</div>
      <button type="button" className="button button--ghost" onClick={() => onChange({ ...value, [field]: [], [excluded]: [] })}>Clear {label.toLowerCase()} selection</button>
    </div>
  </details>;
}

function RuleChoices({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="report-choice-group"><legend>{label}</legend><div>{values.map(value => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onChange(selected.includes(value) ? selected.filter(row => row !== value) : [...selected, value])} /> {displayLabel(value)}</label>)}</div><small className="muted-text">No selection includes all.</small></fieldset>;
}

export function ReportRulesEditor({ value, onChange, currency, accounts, categories, accountsOnly = false }: { accountsOnly?: boolean; value: ReportRules; onChange: (rules: ReportRules) => void; currency: string; accounts: Account[]; categories: Category[] }) {
  return <div className="report-rules-editor">
    <p className="muted-text">{accountsOnly ? "Choose any number of accounts in this currency. Statements use every recorded movement in the selected dates; analysis-only filters and manual membership are kept separately." : "Match any included account and any included category, then apply exclusions. Manual additions override these rules; removed transactions stay excluded."}</p>
    <div className="report-scope-grid">
      <ScopePicker label="Accounts" field="accounts" value={value} onChange={onChange} options={accounts.map(row => ({ id: row.id, name: row.name, detail: row.currency === currency ? row.currency : `${row.currency} · switch report currency to select`, disabled: row.currency !== currency }))} />
      {!accountsOnly ? <ScopePicker label="Categories" field="categories" value={value} onChange={onChange} options={[{ id: "uncategorized", name: "Uncategorized" }, ...categories.map(row => ({ id: row.id, name: row.name, detail: `${row.parent ? `${categories.find(parent => parent.id === row.parent)?.name ?? "Parent category"} · ` : ""}${displayLabel(row.kind)}` }))]} /> : null}
    </div>
    {!accountsOnly ? <><p className="muted-text">Transfers match either selected account and count once. Excluding an account removes transactions involving it. Category selections use the exact category.</p>
    <label className="field"><span className="field__label">Search merchant, reference or notes</span><input className="field__control" value={value.search} maxLength={256} onChange={event => onChange({ ...value, search: event.target.value })} placeholder="e.g. groceries or a project reference" /></label>
    <details className="report-advanced-filters"><summary>Transaction filters and amount limits</summary><div className="report-advanced-filters__body">
      <RuleChoices label="Transaction types" values={["expense", "fee", "refund", "income", "transfer", "adjustment", "lend", "borrow", "repayment_received", "repayment_paid"]} selected={value.types} onChange={types => onChange({ ...value, types })} />
      <RuleChoices label="Sources" values={["web", "mobile", "sms", "import", "system"]} selected={value.sources} onChange={sources => onChange({ ...value, sources })} />
      <RuleChoices label="Directions" values={["debit", "credit"]} selected={value.directions} onChange={directions => onChange({ ...value, directions })} />
      <p className="muted-text">For selected accounts, transfer direction follows those accounts; an internal transfer can match either direction. Amount limits apply to each transaction.</p>
      <div className="transaction-form"><label className="field"><span className="field__label">Minimum amount ({currency})</span><input type="number" min="0" step="0.01" className="field__control" value={value.min_amount ?? ""} onChange={event => onChange({ ...value, min_amount: event.target.value || null })} /></label><label className="field"><span className="field__label">Maximum amount ({currency})</span><input type="number" min="0" step="0.01" className="field__control" value={value.max_amount ?? ""} onChange={event => onChange({ ...value, max_amount: event.target.value || null })} /></label></div>
    </div></details>
    <button className="button button--ghost" type="button" onClick={() => onChange(emptyReportRules())}>Clear all report rules</button></> : null}
  </div>;
}
