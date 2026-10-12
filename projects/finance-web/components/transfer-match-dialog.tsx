"use client";

import { ModalDialog } from "@/components/modal-dialog";
import type { TransferMatch } from "@/lib/api";
import type { transferComparison } from "../../finance-contracts/transfer-comparison";

export function TransferMatchDialog({ original, originalSource, matches, busy, error, merging = false, onAccept, onSeparate, onCancel }: {
  original: ReturnType<typeof transferComparison>;
  originalSource: string;
  matches: TransferMatch[];
  busy: boolean;
  error: string | null;
  merging?: boolean;
  onAccept: (match: TransferMatch) => void;
  onSeparate: () => void;
  onCancel: () => void;
}) {
  return (
    <ModalDialog labelledBy="transfer-match-title" className="decision-modal transfer-match-dialog" busy={busy} onCancel={onCancel}>
      <header className="transfer-match-header">
        <h2 id="transfer-match-title">Possible matching transfer found</h2>
        <p className="transfer-match-warning">Verify this is the same money movement. Linking shows it in both accounts and counts it once.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <article aria-label="Entry being reviewed" className="transfer-match-card transfer-match-original">
          <h3>Entry being reviewed</h3>
          <strong>{original.account_name} → {original.transfer_account_name}</strong>
          <p>BDT {original.amount} · {original.date} · {original.time ? original.time.slice(0, 5) : "Time not provided"}</p>
          {original.counterparty_text || original.note ? <p className="transfer-match-description" title={[original.counterparty_text, original.note].filter(Boolean).join(" · ")}>{[original.counterparty_text, original.note].filter(Boolean).join(" · ")}</p> : null}
          <p className="transfer-match-source">{originalSource}</p>
        </article>
      </header>
      <div className="transfer-match-list" aria-label="Possible matching entries">
        {matches.map((match) => (
          <article className="transfer-match-card" key={`${match.kind}:${match.id}`}>
            <h3>Possible match</h3>
            <strong>{match.account_name} → {match.transfer_account_name}</strong>
            <p>BDT {match.amount} · {match.date} · {match.time ? match.time.slice(0, 5) : "Time not provided"}</p>
            <p className="transfer-match-source">{match.kind === "candidate" ? "Other account’s pending SMS" : "Already recorded transfer"}</p>
            <p>{match.reason}</p>
            <button className="button button--primary" disabled={busy} onClick={() => onAccept(match)} type="button">
              {busy ? "Linking…" : merging ? "Merge into this transfer" : match.kind === "candidate" ? "Confirm as one transfer" : "Link to existing transfer"}
            </button>
          </article>
        ))}
      </div>
      <div className="decision-modal__actions">
        <button className="button button--ghost" disabled={busy} onClick={onCancel} type="button">Cancel</button>
        <button className="button button--ghost" disabled={busy} onClick={onSeparate} type="button">Keep separate</button>
      </div>
    </ModalDialog>
  );
}
