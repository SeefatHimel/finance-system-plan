import type { StatementDetailChoice, StatementDetailSuggestion } from "./api";
import { safeAccountIdentifier } from "./account-identity";

export type DetailSelection = StatementDetailChoice & { selected: boolean; suggested_value: string };
export type DetailSelections = Partial<Record<StatementDetailChoice["field"], DetailSelection>>;

export function fillMissingStatementDetails(suggestions: StatementDetailSuggestion[], selections: DetailSelections): DetailSelections {
  const next = { ...selections };
  for (const detail of suggestions) {
    if (detail.existing_value.trim() || !detail.suggested_value.trim()) continue;
    const previous = selections[detail.field];
    next[detail.field] = { ...detail, value: previous?.value ?? detail.suggested_value, selected: true };
  }
  return next;
}

export function selectedStatementDetails(suggestions: StatementDetailSuggestion[], selections: DetailSelections): { choices: StatementDetailChoice[]; error: string | null } {
  const choices: StatementDetailChoice[] = [];
  for (const detail of suggestions) {
    const selection = selections[detail.field];
    if (!selection?.selected) continue;
    if (selection.existing_value !== detail.existing_value || selection.suggested_value !== detail.suggested_value) {
      return { choices: [], error: "Details changed. Review your selections again." };
    }
    if (!selection.value.trim()) return { choices: [], error: `Enter ${detail.label.toLowerCase()} or deselect it.` };
    let value = selection.value.trim();
    if (detail.field.endsWith("_identifier")) {
      try { value = safeAccountIdentifier(value); }
      catch (reason) { return { choices: [], error: reason instanceof Error ? reason.message : "Enter a masked identifier or safe suffix." }; }
    }
    choices.push({ field: detail.field, existing_value: detail.existing_value, value });
  }
  return { choices, error: null };
}
