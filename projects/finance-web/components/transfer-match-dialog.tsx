"use client";

import { useState } from "react";
import { transferBalanceConflicts } from "../../finance-contracts/transfer-comparison";
import { HelpTooltip } from "@/components/help-tooltip";
import { ModalDialog } from "@/components/modal-dialog";
import type { TransferMatch, TransferBalanceChoice } from "@/lib/api";
import type { transferComparison } from "../../finance-contracts/transfer-comparison";

export function TransferMatchDialog({ original, originalSource, matches, busy, error, merging = false, onAccept, onSeparate, onCancel }: {
  original: ReturnType<typeof transferComparison>;
  originalSource: string;
  matches: TransferMatch[];
  busy: boolean;
  error: string | null;
  merging?: boolean;
  onAccept: (match: TransferMatch, choices: TransferBalanceChoice[]) => void;
  onSeparate: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog initialFocus="#transfer-match-title" labelledBy="transfer-match-title" className="decision-modal transfer-match-dialog" busy={busy} onCancel={onCancel}>
      <header className="transfer-match-header">
<div className="inline-help"><h2 id="transfer-match-title" tabIndex={-1}>Match transfer</h2><HelpTooltip label="About matching transfers">Verify this is the same money movement. Linking shows it in both accounts and counts it once. You can keep separate entries instead.</HelpTooltip></div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <article aria-label="Entry being reviewed" className="transfer-match-card transfer-match-original">
          <h3>This entry</h3>
          <strong>{original.account_name} → {original.transfer_account_name}</strong>
          <p>BDT {original.amount} · {original.date} · {original.time ? original.time.slice(0, 5) : "Time not provided"}</p>
          {original.counterparty_text || original.note ? <p className="transfer-match-description" title={[original.counterparty_text, original.note].filter(Boolean).join(" · ")}>{[original.counterparty_text, original.note].filter(Boolean).join(" · ")}</p> : null}
          <p className="transfer-match-source">{originalSource}</p>
          <BalanceList reports={original.reported_balances} />
        </article>
      </header>
      <div className="transfer-match-list" aria-label="Possible matching entries">
        {matches.map(match => <MatchCard key={`${match.kind}:${match.id}`} match={match} original={original} busy={busy} merging={merging} onAccept={onAccept} />)}
      </div>
      <div className="decision-modal__actions">
        <button className="button button--ghost" disabled={busy} onClick={onCancel} type="button">Cancel</button>
        <button className="button button--ghost" disabled={busy} onClick={onSeparate} type="button">Keep separate</button>
      </div>
    </ModalDialog>
  );
}


function BalanceList({ reports }: { reports: { account: string; account_name: string; balance_after: string | null }[] }) {
  return <div aria-label="Reported balances after">
    <p className="inline-help">Balance after <HelpTooltip label="About reported balances">Balances reported by each account. Different accounts normally have different balances. Unknown balances do not overwrite saved values.</HelpTooltip></p>
    {reports.length ? reports.map(report => <p key={report.account}><strong>{report.account_name}</strong>: {report.balance_after == null ? "Not reported" : `BDT ${report.balance_after}`}</p>) : <p>Not reported</p>}
  </div>;
}

function MatchCard({ match, original, busy, merging, onAccept }: {
  match: TransferMatch; original: ReturnType<typeof transferComparison>; busy: boolean; merging: boolean;
  onAccept: (match: TransferMatch, choices: TransferBalanceChoice[]) => void;
}) {
  const [choices, setChoices] = useState<Record<string, "existing" | "incoming">>({});
  const conflicts = transferBalanceConflicts(match.reported_balances, original.reported_balances);
  const name = (account: string) => account === match.account ? match.account_name : match.transfer_account_name;
  return <article className="transfer-match-card">
<div className="inline-help"><h3>Suggested match</h3><HelpTooltip label="Why this match was suggested">{match.reason}</HelpTooltip></div>
    <strong>{match.account_name} → {match.transfer_account_name}</strong>
    <p>BDT {match.amount} · {match.date} · {match.time ? match.time.slice(0, 5) : "Time not provided"}</p>
    <p className="transfer-match-source">{match.kind === "candidate" ? "Other account’s pending SMS" : "Already recorded transfer"}</p>
    <BalanceList reports={match.reported_balances.map(report => ({ ...report, account_name: name(report.account) }))} />
    {conflicts.length ? <div className="form-warning" role="alert">
<p className="inline-help balance-conflict-title"><strong>Balances differ</strong><HelpTooltip warning label="About conflicting balances">Two reports disagree for the same account. They could be different movements. Choose the balance to keep or keep the entries separate. Original messages stay available; this choice sets the effective reported balance.</HelpTooltip></p>
      {conflicts.map(conflict => <fieldset key={conflict.account} disabled={busy}>
        <legend>Keep balance for {name(conflict.account)}</legend>
        {(["existing", "incoming"] as const).map(keep => <label className="field" key={keep}>
          <span><input type="radio" name={`balance-${match.id}-${conflict.account}`} checked={choices[conflict.account] === keep} onChange={() => setChoices(current => ({ ...current, [conflict.account]: keep }))} /> {keep === "existing" ? "Matching entry" : "This entry"} · BDT {keep === "existing" ? conflict.existing_balance_after : conflict.incoming_balance_after}</span>
        </label>)}
      </fieldset>)}
    </div> : null}
    <button className="button button--primary" disabled={busy || conflicts.some(conflict => !choices[conflict.account])} onClick={() => onAccept(match, conflicts.map(conflict => ({ ...conflict, keep: choices[conflict.account] })))} type="button">
      {busy ? "Linking…" : merging ? "Merge into this transfer" : match.kind === "candidate" ? "Confirm as one transfer" : "Link to existing transfer"}
    </button>
  </article>;
}
