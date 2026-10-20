"use client";

import { formatCalendarDate } from "../../finance-contracts/presentation";
import { StatementDetailChoices } from "@/components/statement-detail-choices";
import { calendarDayDifference, insignificantBdtBalanceDifference, statementBalanceDifference, statementLinkBlockReason } from "@/lib/statement-review";
import { selectedStatementDetails, type DetailSelections } from "@/lib/statement-details";
import { displayedStatementText } from "@/lib/statement-citytouch";
import { categoryTypeProposal } from "@/lib/category-type";
import type { Account, Category, SavedStatement, SavedStatementRow, StatementCategoryChoice, StatementDecision, StatementMatch, TransactionType } from "@/lib/api";

export function StatementMatchComparison({ row, batch, match, accounts, categories, busy, dirty, issuesAcknowledged, balanceChoice, balanceAutoSelected, categoryChoice, detailSelections, onBalanceChoice, onCategoryChoice, onDetailChange, onAccept }: {
  row: SavedStatementRow; batch: SavedStatement; match: StatementMatch; accounts: Account[]; categories: Category[];
  busy: boolean; dirty: boolean; issuesAcknowledged: boolean;
  balanceChoice: StatementDecision["balance_choice"];
  balanceAutoSelected: boolean;
  categoryChoice: StatementCategoryChoice | undefined;
  detailSelections: DetailSelections;
  onBalanceChoice: (keep: "existing" | "statement") => void;
  onCategoryChoice: (choice: StatementCategoryChoice) => void;
  onDetailChange: (values: DetailSelections) => void;
  onAccept: () => void;
}) {
  const rounding = match.rounding_correction;
  const canAccept = match.can_link || Boolean(rounding?.can_correct);
  const details = selectedStatementDetails(match.detail_suggestions, detailSelections);
  const categoryConflict = row.category !== null && row.category !== match.category_id;
  const statementCategory = categories.find((category) => category.id === row.category);
  const statementCategoryAllowed = Boolean(statementCategory?.is_active && !categoryTypeProposal(statementCategory, match.type as TransactionType));
  const customCategories = categories.filter((category) => category.is_active && !categoryTypeProposal(category, match.type as TransactionType));
  const categoryChosen = Boolean(categoryChoice && (categoryChoice.keep !== "custom" || categoryChoice.category !== undefined));
  const categoryName = (id: string | null | undefined) => id ? categories.find((category) => category.id === id)?.name ?? (id === match.category_id ? match.category_name : null) ?? "Unavailable category" : "Uncategorized";
  const finalCategory = categoryChoice?.keep === "statement" ? categoryName(row.category)
    : categoryChoice?.keep === "custom" ? categoryChoice.category === undefined ? null : categoryName(categoryChoice.category)
    : categoryName(match.category_id);
  const blocked = details.error ?? statementLinkBlockReason({
    dirty, canLink: canAccept, requiresAcknowledgement: row.review.requires_acknowledgement,
    issuesAcknowledged, conflict: match.conflict, balanceChosen: Boolean(balanceChoice), categoryConflict, categoryChosen,
  });
  const difference = statementBalanceDifference(row.balance_after, match.effective_balance_after);
  const dateDifference = calendarDayDifference(row.date, match.date);
  const smallDifference = insignificantBdtBalanceDifference(row.balance_after, match.effective_balance_after, batch.currency);
  const other = accounts.find((account) => account.id === row.other_account)?.name ?? "Other account";
  const path = row.type === "transfer" ? (row.direction === "credit" ? `${other} → ${batch.account_name}` : `${batch.account_name} → ${other}`) : batch.account_name;
  const balanceText = (value: string | null) => value === null ? "Not reported" : `${batch.currency} ${value}`;
  const comparison = [
    { label: "Amount", statement: balanceText(row.amount), ledger: balanceText(match.amount) },
    { label: "Account / path", statement: path, ledger: `${match.account_name}${match.transfer_account_name ? ` → ${match.transfer_account_name}` : ""}` },
    { label: "Date / time", statement: `${formatCalendarDate(row.date)}${row.time ? ` · ${row.time}` : ""}`, ledger: `${formatCalendarDate(match.date)}${match.time ? ` · ${match.time}` : ""}` },
    { label: "Type / category", statement: `${row.type.replaceAll("_", " ")} · ${categoryName(row.category)}`, ledger: `${match.type.replaceAll("_", " ")} · ${match.category_name ?? "Uncategorized"}` },
    { label: "Reported balance after", statement: balanceText(row.balance_after), ledger: balanceText(match.effective_balance_after), balance: true },
    { label: "Reference", statement: row.reference || "Not reported", ledger: match.reference || "Not reported" },
    { label: "Description", statement: displayedStatementText(row.counterparty_text || row.note || row.extracted.description, row.extracted.description, row.citytouch_printed_code), ledger: match.note || "No note" },
  ];
  const hintId = `statement-match-hint-${match.id}`;
  return <article className="statement-match-card">
    <header className="statement-match-heading"><h4>{rounding ? "Possible rounding match" : match.strength === "strong" ? "Strong match" : "Possible match"}{categoryConflict ? <span className="status-badge status-badge--warning">Categories differ</span> : null}</h4><span>{batch.currency} {match.amount}</span></header>
    {rounding || Boolean(dateDifference) || (difference !== null && difference !== "0.00") ? <div className="source-differences" aria-label="Statement and ledger differences">
      {rounding ? <p>Amount difference: {batch.currency} {rounding.difference} (statement minus ledger). These amounts are different; confirmation is required to correct the saved transaction and link this source.</p> : null}
      {dateDifference ? <p>Dates differ by {Math.abs(dateDifference)} calendar day{Math.abs(dateDifference) === 1 ? "" : "s"}.</p> : null}
      {difference !== null && difference !== "0.00" ? <p className={smallDifference ? "inline-note" : "form-error"}>Reported balance difference: {batch.currency} {difference} (statement minus ledger).{smallDifference ? " Small difference under BDT 1; both exact reports remain saved." : " Review the balance choice below."}</p> : null}
    </div> : null}
    <div className="statement-match-comparison">
      <section aria-label="Statement saved draft"><h5>Statement <small>Saved draft · {batch.currency} {row.amount}</small></h5><dl>{comparison.map((item) => <div key={item.label} className={(item.balance && match.conflict) || (item.label === "Type / category" && categoryConflict) ? "statement-balance-value--conflict" : undefined}><dt>{item.label}</dt><dd>{item.statement}</dd></div>)}</dl></section>
      <section aria-label="Existing ledger entry"><h5>Existing transaction <small>{match.source} · {batch.currency} {match.amount}</small></h5><dl>{comparison.map((item) => <div key={item.label} className={(item.balance && match.conflict) || (item.label === "Type / category" && categoryConflict) ? "statement-balance-value--conflict" : undefined}><dt>{item.label}</dt><dd>{item.ledger}</dd></div>)}</dl></section>
    </div>
    {categoryConflict ? <fieldset className="statement-match-conflict statement-match-category" disabled={busy || dirty || !canAccept}>
      <legend>Which category should the ledger use?</legend>
      <p>The statement draft and existing transaction disagree. Choose one category for the linked transaction; both sources remain available.</p>
      <div className="statement-balance-options statement-category-options">
        <label><input type="radio" name={`category-${row.id}-${match.id}`} checked={categoryChoice?.keep === "existing"} onChange={() => onCategoryChoice({ keep: "existing", existing_category: match.category_id, statement_category: row.category })} /><span>Keep ledger category<strong>{categoryName(match.category_id)}</strong></span></label>
        <label><input type="radio" name={`category-${row.id}-${match.id}`} checked={categoryChoice?.keep === "statement"} disabled={!statementCategoryAllowed} onChange={() => onCategoryChoice({ keep: "statement", existing_category: match.category_id, statement_category: row.category })} /><span>Use statement category<strong>{categoryName(row.category)}</strong></span></label>
        <label><input type="radio" name={`category-${row.id}-${match.id}`} checked={categoryChoice?.keep === "custom"} onChange={() => onCategoryChoice({ keep: "custom", existing_category: match.category_id, statement_category: row.category })} /><span>Choose another category</span></label>
      </div>
      {!statementCategoryAllowed ? <p className="inline-note">The statement category is inactive or does not fit the existing transaction type. Choose another compatible category or keep the ledger category.</p> : null}
      {categoryChoice?.keep === "custom" ? <label className="field statement-category-select" htmlFor={`category-other-${match.id}`}><span className="field__label">Category to save</span><select id={`category-other-${match.id}`} className="field__control" value={categoryChoice.category === undefined ? "" : categoryChoice.category ?? "uncategorized"} onChange={(event) => onCategoryChoice({ ...categoryChoice, category: event.target.value === "uncategorized" ? null : event.target.value })}>
        <option value="" disabled>Choose a category</option><option value="uncategorized">Uncategorized</option>
        {customCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select></label> : null}
    </fieldset> : null}
    {match.conflict ? <fieldset className="statement-match-conflict" disabled={busy || dirty || !canAccept}>
      <legend>Which reported balance should the ledger use?</legend>
      <p>Difference{difference !== null ? `: ${batch.currency} ${difference}` : " requires review"}. The original statement and prior ledger value stay in the audit history.</p>
      {balanceChoice && balanceAutoSelected ? <p>Small difference under BDT 1. The higher report is suggested; you can choose either. This does not alter either original source.</p> : null}
      {match.balance_after !== match.effective_balance_after ? <p>The matched source observation reports {balanceText(match.balance_after)}; the current ledger report is shown above.</p> : null}
      <div className="statement-balance-options">
        <label><input type="radio" name={`balance-${row.id}-${match.id}`} checked={balanceChoice?.keep === "existing"} onChange={() => onBalanceChoice("existing")} /><span>Keep existing ledger balance<strong>{balanceText(match.effective_balance_after)}</strong></span></label>
        <label><input type="radio" name={`balance-${row.id}-${match.id}`} checked={balanceChoice?.keep === "statement"} disabled={row.balance_after === null} onChange={() => onBalanceChoice("statement")} /><span>Use statement balance<strong>{balanceText(row.balance_after)}</strong></span></label>
      </div>
    </fieldset> : null}
    <StatementDetailChoices matchId={match.id} suggestions={match.detail_suggestions} selections={detailSelections} disabled={busy || dirty || !canAccept} onChange={onDetailChange} />
    <details className="statement-match-reasons"><summary>Why this match was suggested</summary><ul>{match.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
    <div className="statement-match-decision"><button className="button button--primary" type="button" disabled={busy || Boolean(blocked)} aria-describedby={hintId} onClick={onAccept}>{rounding ? "Review correction & link" : categoryConflict && finalCategory && categoryChosen ? `Link once · use ${finalCategory}` : "Accept match · count once"}</button>
      {rounding?.blocked_reason ? <p className="form-error">{rounding.blocked_reason}</p> : null}
      <p className="inline-note" id={hintId}>{blocked ?? `One ledger transaction. Category: ${finalCategory ?? categoryName(match.category_id)}.${balanceChoice ? ` Reported balance: ${balanceText(balanceChoice.keep === "statement" ? row.balance_after : match.effective_balance_after)}.` : ""}`}</p>
    </div>
  </article>;
}
