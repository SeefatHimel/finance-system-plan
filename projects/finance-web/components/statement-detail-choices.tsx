"use client";

import type { StatementDetailSuggestion } from "@/lib/api";
import { fillMissingStatementDetails, type DetailSelections } from "@/lib/statement-details";

export function StatementDetailChoices({ matchId, suggestions, selections, disabled, onChange }: {
  matchId: string; suggestions: StatementDetailSuggestion[]; selections: DetailSelections;
  disabled: boolean; onChange: (next: DetailSelections) => void;
}) {
  const missing = suggestions.filter(d => !d.existing_value.trim() && d.suggested_value.trim()).length;
  return <details className="statement-detail-choices">
    <summary>Fill missing details / review suggested updates</summary>
    <p className="inline-note">Only selected fields change when you accept this match. Date, time, amount and account direction stay unchanged.</p>
    <button className="button button--small" type="button" disabled={disabled || !missing} onClick={() => onChange(fillMissingStatementDetails(suggestions, selections))}>Fill missing details from statement ({missing})</button>
    <div className="statement-detail-grid">{suggestions.map(detail => {
      const selection = selections[detail.field];
      const value = selection?.value ?? detail.suggested_value;
      const update = (patch: { value?: string; selected?: boolean }) => onChange({ ...selections, [detail.field]: { ...detail, selected: selection?.selected ?? false, value, ...patch } });
      const id = `detail-${matchId}-${detail.field}`;
      return <div className="statement-detail-item" key={detail.field}>
        <label className="statement-detail-toggle"><input type="checkbox" disabled={disabled} checked={selection?.selected ?? false} onChange={event => update({ selected: event.target.checked })} /><span>{detail.label}{detail.existing_value.trim() ? " · replace existing" : " · fill empty"}</span></label>
        <p className="inline-note statement-existing-value">Existing: {detail.existing_value || "Empty"}</p>
        <label className="field" htmlFor={id}><span className="field__label">Proposed value</span>{detail.field === "note" ? <textarea id={id} className="field__control" rows={3} disabled={disabled} maxLength={4000} value={value} onChange={event => update({ value: event.target.value })} /> : <input id={id} className="field__control" disabled={disabled} maxLength={detail.field === "counterparty_text" ? 255 : 120} value={value} placeholder={detail.field.endsWith("_identifier") ? "Masked value or ending digits" : "No statement suggestion · enter manually"} onChange={event => update({ value: event.target.value })} />}</label>
        {detail.field.endsWith("_identifier") ? <span className="inline-note">Stored only as a masked value or safe suffix.</span> : null}
      </div>;
    })}</div>
  </details>;
}
