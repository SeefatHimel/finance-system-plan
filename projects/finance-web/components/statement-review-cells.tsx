import type { SavedStatementRow } from "@/lib/api";
import { displayedStatementText } from "@/lib/statement-citytouch";
import { distinctStatementNote, statementRowSummary, type StatementReviewSection } from "@/lib/statement-row-summary";

type Props = { row: SavedStatementRow; disabled: boolean; onOpen: (section: StatementReviewSection) => void };

export function StatementDescriptionCell({ row, disabled, onOpen }: Props) {
  const source = row.extracted.description;
  const primary = displayedStatementText(row.counterparty_text || row.extracted.provider_type || "Statement movement", source, row.citytouch_printed_code);
  const note = distinctStatementNote(primary, displayedStatementText(row.note, source, row.citytouch_printed_code));
  return <td className="statement-cell-description">
    <button className="statement-description-button" type="button" disabled={disabled} onClick={() => onOpen("description")} aria-label={`View description for source row ${row.position}`} aria-describedby={`statement-description-${row.id}`}><span id={`statement-description-${row.id}`}>{primary}</span></button>
    {note ? <span className="statement-cell-secondary">{note}</span> : null}
  </td>;
}

export function StatementReviewCell({ row, disabled, onOpen }: Props) {
  const summary = statementRowSummary(row);
  return <td className="statement-cell-review">
    <span className={`status-badge status-badge--${summary.tone}`}>{summary.status}</span>
    {row.transaction && summary.status !== "Already linked" ? <small>Already linked</small> : null}
    {row.state === "skipped" && summary.status !== "Skipped" ? <small>Skipped</small> : null}
    <div className="statement-row-flags">{summary.flags.map(flag => <span key={flag}>{flag}</span>)}</div>
    {summary.hasMatches ? <button className="button button--ghost button--small" type="button" disabled={disabled} onClick={() => onOpen("matches")} aria-label={`${summary.matchLabel} for source row ${row.position}`}>{summary.matchLabel}</button> : summary.status === "Needs review" ? <button className="statement-details-button" type="button" disabled={disabled} onClick={() => onOpen("review")}>Review issues</button> : null}
  </td>;
}
