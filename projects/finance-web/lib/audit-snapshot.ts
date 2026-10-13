export type AuditFieldChange = {
  key: string;
  field: string;
  before: string;
  after: string;
};

const fieldLabels: Record<string, string> = {
  balance_after: "Reported balance after",
  counterparty_text: "Counterparty",
  raw_message: "Source SMS",
  transfer_account: "Other transfer account",
  transfer_evidence: "Linked observations"
};

function fieldLabel(field: string) {
  return fieldLabels[field] ?? field.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown, field: string): string {
  if (value === undefined) return "Not recorded";
  if (value === null) return "Not set";
  if (value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const noun = field === "transfer_evidence" ? "observation" : "item";
    return `${value.length} ${noun}${value.length === 1 ? "" : "s"}`;
  }
  return "Structured value (see full snapshots)";
}

export function auditFieldChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): AuditFieldChange[] {
  if (!before || !after) return [];

  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => {
      const previous = displayValue(before[field], field);
      const next = displayValue(after[field], field);
      return {
        key: field,
        field: fieldLabel(field),
        before: previous,
        after: previous === next && typeof after[field] === "object" && after[field] !== null
          ? `${next} (contents changed)`
          : next
      };
    });
}
