export type ReportRules = {
  accounts: string[]; excluded_accounts: string[]; categories: string[]; excluded_categories: string[];
  types: string[]; directions: string[]; sources: string[]; search: string;
  min_amount: string | null; max_amount: string | null;
};

export function emptyReportRules(): ReportRules {
  return { accounts: [], excluded_accounts: [], categories: [], excluded_categories: [], types: [], directions: [], sources: [], search: "", min_amount: null, max_amount: null };
}

export function canonicalReportRules(value: Partial<ReportRules> = {}): ReportRules {
  const result = { ...emptyReportRules(), ...value };
  for (const key of ["accounts", "excluded_accounts", "categories", "excluded_categories", "types", "directions", "sources"] as const) {
    result[key] = [...new Set((result[key] ?? []).filter(item => typeof item === "string"))].sort();
  }
  for (const key of ["min_amount", "max_amount"] as const) {
    const amount = result[key]?.trim();
    result[key] = amount && /^\d+(\.\d{1,2})?$/.test(amount) ? `${amount.split(".")[0].replace(/^0+(?=\d)/, "")}.${(amount.split(".")[1] ?? "").padEnd(2, "0")}` : amount || null;
  }
  result.search = result.search.trim();
  return result;
}

export function savedReportRules(report: { filters: Partial<ReportRules>; account: string | null }): ReportRules {
  const rules = canonicalReportRules(report.filters);
  if (!rules.accounts.length && report.account) rules.accounts = [report.account];
  return rules;
}

export function reportRulesEqual(left: Partial<ReportRules>, right: Partial<ReportRules>) {
  return JSON.stringify(canonicalReportRules(left)) === JSON.stringify(canonicalReportRules(right));
}

export function setReportRuleChoice(rules: ReportRules, field: "accounts" | "categories", id: string, choice: "any" | "include" | "exclude"): ReportRules {
  const excluded = `excluded_${field}` as const;
  return { ...rules, [field]: [...rules[field].filter(value => value !== id), ...(choice === "include" ? [id] : [])],
    [excluded]: [...rules[excluded].filter(value => value !== id), ...(choice === "exclude" ? [id] : [])] };
}
