"use client";

import { statementBalanceDifference, statementLinkBlockReason } from "@/lib/statement-review";
import type { Account, Category, SavedStatement, SavedStatementRow, StatementMatch } from "@/lib/api";

export function StatementMatchComparison({ row, batch, match, accounts, categories, busy, dirty, issuesAcknowledged, conflictAcknowledged, onAcknowledge, onAccept }: {
  row: SavedStatementRow; batch: SavedStatement; match: StatementMatch; accounts: Account[]; categories: Category[];
  busy: boolean; dirty: boolean; issuesAcknowledged: boolean; conflictAcknowledged: boolean;
  onAcknowledge: (checked: boolean) => void; onAccept: () => void;
}) {
  const blocked = statementLinkBlockReason({ dirty, canLink: match.can_link, requiresAcknowledgement: row.review.requires_acknowledgement, issuesAcknowledged, conflict: match.conflict, conflictAcknowledged });
  const difference = statementBalanceDifference(row.balance_after, match.balance_after);
  const other = accounts.find((account) => account.id === row.other_account)?.name ?? "Other account";
  const path = row.type === "transfer" ? (row.direction === "credit" ? `${other} → ${batch.account_name}` : `${batch.account_name} → ${other}`) : batch.account_name;
  const comparison = [
    { label: "Account / path", statement: path, ledger: `${match.account_name}${match.transfer_account_name ? ` → ${match.transfer_account_name}` : ""}` },
    { label: "Date / time", statement: `${row.date ?? "Unknown date"}${row.time ? ` · ${row.time}` : ""}`, ledger: `${match.date}${match.time ? ` · ${match.time}` : ""}` },
    { label: "Type / category", statement: `${row.type.replaceAll("_", " ")} · ${categories.find((category) => category.id === row.category)?.name ?? "Uncategorized"}`, ledger: `${match.type.replaceAll("_", " ")} · ${match.category_name ?? "Uncategorized"}` },
    { label: "Reported balance after", statement: row.balance_after === null ? "Not reported" : `${batch.currency} ${row.balance_after}`, ledger: match.balance_after === null ? "Not reported" : `${batch.currency} ${match.balance_after}`, balance: true },
    { label: "Reference", statement: row.reference || "Not reported", ledger: match.reference || "Not reported" },
    { label: "Description", statement: row.counterparty_text || row.note || row.extracted.description, ledger: match.note || "No note" },
  ];
  const hintId = `statement-match-hint-${match.id}`;
  return <article className="statement-match-card">
    <header className="statement-match-heading"><h4>{match.strength === "strong" ? "Strong match" : "Possible match"}</h4><span>{batch.currency} {match.amount}</span></header>
    <div className="statement-match-comparison">
      <section aria-label="Statement saved draft"><h5>Statement <small>Saved draft · {batch.currency} {row.amount}</small></h5><dl>{comparison.map((item) => <div key={item.label} className={item.balance && match.conflict ? "statement-balance-value--conflict" : undefined}><dt>{item.label}</dt><dd>{item.statement}</dd></div>)}</dl></section>
      <section aria-label="Existing ledger entry"><h5>Existing transaction <small>{match.source} · {batch.currency} {match.amount}</small></h5><dl>{comparison.map((item) => <div key={item.label} className={item.balance && match.conflict ? "statement-balance-value--conflict" : undefined}><dt>{item.label}</dt><dd>{item.ledger}</dd></div>)}</dl></section>
    </div>
    {match.conflict ? <div className="statement-match-conflict"><strong>Balance difference{difference !== null ? `: ${batch.currency} ${difference}` : " · review required"}</strong>
      <p>Linking keeps the existing ledger balance and retains both reported observations.</p>
      <label className="review-remember"><input type="checkbox" checked={conflictAcknowledged} disabled={busy || dirty || !match.can_link} onChange={(event) => onAcknowledge(event.target.checked)} /><span>I reviewed this balance difference.</span></label>
    </div> : null}
    <details className="statement-match-reasons"><summary>Why this match was suggested</summary><ul>{match.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
    <div className="statement-match-decision"><button className="button button--primary" type="button" disabled={busy || Boolean(blocked)} aria-describedby={blocked ? hintId : undefined} onClick={onAccept}>Accept match · count once</button>
      {blocked ? <p className="inline-note" id={hintId}>{blocked}</p> : null}
    </div>
  </article>;
}
