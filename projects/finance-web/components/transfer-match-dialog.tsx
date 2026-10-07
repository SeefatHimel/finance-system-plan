"use client";

import { ModalDialog } from "@/components/modal-dialog";
import type { TransferMatch } from "@/lib/api";

export function TransferMatchDialog({ matches, busy, error, merging = false, onAccept, onSeparate, onCancel }: {
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
      <h2 id="transfer-match-title">Possible matching transfer found</h2>
      <p>Verify this is the same money movement. Linking shows it in both accounts and counts it once.</p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="transfer-match-list">
        {matches.map((match) => (
          <article className="transfer-match-card" key={`${match.kind}:${match.id}`}>
            <strong>{match.account_name} → {match.transfer_account_name}</strong>
            <p>BDT {match.amount} · {match.date}{match.time ? ` · ${match.time.slice(0, 5)}` : ""}</p>
            {match.reference ? <p>Reference: {match.reference}</p> : null}
            <p>{match.kind === "candidate" ? "Other account’s pending SMS" : "Already recorded transfer"}</p>
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
