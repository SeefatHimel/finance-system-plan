import { useEffect, useRef, useState } from "react";
import {
  confirmMessageCandidate, rejectMessageCandidate, getMessageCandidate, linkTransfer,
  type ParsedMessageCandidate, type ConfirmMessageCandidateInput, type RejectMessageCandidateInput,
  type TransferMatch, type TransferMatchInput, type TransferBalanceChoice,
} from "./api";
import type { ReviewDraft } from "./review-fields";

export type ReviewDecision =
  | { kind: "confirm"; candidate: string; input: ConfirmMessageCandidateInput }
  | { kind: "reject"; candidate: string; input: RejectMessageCandidateInput }
  | { kind: "link"; input: TransferMatchInput & { candidate: string }; match: TransferMatch; balances: TransferBalanceChoice[] };
export type ReviewSnapshot = {
  candidate: ParsedMessageCandidate; draft: ReviewDraft; index: number;
  before: string | null; after: string | null;
};
type Phase = "checking" | "saving" | "unknown" | "failed" | "resolved";
type Operation = {
  decision: ReviewDecision; ids: string[]; snapshots: ReviewSnapshot[]; phase: Phase;
  message: string; resultTransaction: string | null;
};
type Store = { scope: string | null; revision: number; dirty: boolean; hidden: Set<string>; settled: Set<string>; operation: Operation | null };
type Options = {
  scope: string | null; token: string;
  onBegin: (ids: string[]) => void;
  onRestore: (snapshots: ReviewSnapshot[]) => void;
  onSettled: () => void;
  onResolved: (result: { decision: ReviewDecision; observed: boolean; transaction: string | null }) => void;
};
function affectedIds(decision: ReviewDecision) {
  const ids = [decision.kind === "link" ? decision.input.candidate : decision.candidate];
  if (decision.kind === "link" && decision.match.kind === "candidate") ids.push(decision.match.id);
  return [...new Set(ids)];
}
function rejectedRequest(reason: unknown) {
  // A gateway timeout/5xx or unreadable/lost response may follow a committed write.
  return [400, 401, 403, 404, 409, 413, 422, 429].includes((reason as { status?: number })?.status ?? 0);
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : "Could not save this review decision."; }
function empty(scope: string | null): Store {
  return { scope, revision: 0, dirty: false, hidden: new Set(), settled: new Set(), operation: null };
}

export function reviewSnapshots(rows: ParsedMessageCandidate[], ids: string[], draft: (row: ParsedMessageCandidate) => ReviewDraft): ReviewSnapshot[] {
  return rows.flatMap((candidate, index) => ids.includes(candidate.id) ? [{ candidate,
    draft: { ...draft(candidate) }, index, before: rows[index - 1]?.id ?? null, after: rows[index + 1]?.id ?? null,
  }] : []);
}

/** Restore only the failed items, never roll back another item's newer edits/data. */
export function restoreReviewRows(rows: ParsedMessageCandidate[], snapshots: ReviewSnapshot[]) {
  const restored = [...rows];
  for (const snapshot of [...snapshots].sort((a, b) => a.index - b.index)) {
    if (restored.some(row => row.id === snapshot.candidate.id)) continue;
    const after = restored.findIndex(row => row.id === snapshot.after);
    const before = restored.findIndex(row => row.id === snapshot.before);
    const index = after >= 0 ? after : before >= 0 ? before + 1 : Math.min(snapshot.index, restored.length);
    restored.splice(index, 0, snapshot.candidate);
  }
  return restored;
}

/** One review write at a time. Uncertain writes are retried only by explicit action. */
export function useReviewMutation(options: Options) {
  const latest = useRef(options); latest.current = options;
  const store = useRef<Store>(empty(options.scope));
  if (store.current.scope !== options.scope) store.current = empty(options.scope);
  const [, rerender] = useState(0);
  const alive = useRef(true), running = useRef<object | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const owned = (owner: Store) => alive.current && store.current === owner && latest.current.scope === owner.scope;
  const emit = (owner: Store) => { if (owned(owner)) rerender(value => value + 1); };

  async function perform(owner: Store, operation: Operation, retry: boolean, checkOnly = false) {
    const flight = {}; running.current = flight;
    const uncertainBefore = operation.phase === "unknown";
    let attempted = false;
    const valid = () => owned(owner) && owner.operation === operation;
    const restore = (reason: string, statuses: ParsedMessageCandidate[] = []) => {
      if (!valid()) return;
      const resolved = new Set(statuses.filter(row => row.status !== "needs_review").map(row => row.id));
      operation.ids.forEach(id => {
        if (resolved.has(id)) { owner.hidden.add(id); owner.settled.add(id); }
        else owner.hidden.delete(id);
      });
      const snapshots = operation.snapshots.filter(item => !resolved.has(item.candidate.id)).map(item => ({ ...item,
        candidate: statuses.find(row => row.id === item.candidate.id) ?? item.candidate,
      }));
      operation.phase = "failed";
      operation.snapshots = snapshots;
      operation.resultTransaction = statuses.find(row => row.status === "confirmed")?.transaction ?? null;
      operation.message = `${reason}\n${snapshots.length ? "Entry and edits restored." : "Review the current sources before continuing."}`;
      owner.revision++;
      latest.current.onRestore(snapshots);
      latest.current.onSettled();
      emit(owner);
    };
    const resolved = (statuses: ParsedMessageCandidate[], observed: boolean, transaction: string | null) => {
      if (!valid()) return;
      // Partial or different decisions by another device must not consume a pending counterpart.
      if (statuses.some(row => row.status === "needs_review")) {
        restore("These sources changed elsewhere. Review the remaining message before linking.", statuses);
        return;
      }
      operation.phase = "resolved";
      operation.resultTransaction = transaction;
      operation.message = observed ? "Server status checked. These messages have already been reviewed."
        : operation.decision.kind === "reject" ? "Message rejected." : operation.decision.kind === "link" ? "Transfer linked." : "Transaction added.";
      operation.ids.forEach(id => { owner.hidden.add(id); owner.settled.add(id); });
      owner.revision++;
      latest.current.onSettled();
      emit(owner);
      // Reporting/Undo refresh failures must never roll back an accepted financial write.
      try { latest.current.onResolved({ decision: operation.decision, observed, transaction }); }
      catch { operation.message += " Refresh the inbox to update its status."; emit(owner); }
    };
    const read = async () => {
      const rows = await Promise.all(operation.ids.map(id => getMessageCandidate(latest.current.token, id)));
      if (!valid()) return null;
      return rows;
    };
    try {
      operation.phase = "checking";
      operation.message = retry ? "Checking the previous decision before retrying…" : "Checking review status…";
      emit(owner);
      const statuses = await read();
      if (!statuses) return;
      if (statuses.some(row => row.status !== "needs_review")) {
        resolved(statuses, true, statuses.find(row => row.status === "confirmed")?.transaction ?? null);
        return;
      }
      if (checkOnly) {
        operation.phase = "unknown";
        operation.message = "The messages are still pending. The earlier save is not confirmed. Retry the same decision when ready.";
        emit(owner); return;
      }
      operation.phase = "saving";
      operation.message = operation.decision.kind === "reject" ? "Rejecting message…" : "Saving review decision…";
      emit(owner);
      attempted = true;
      const decision = operation.decision;
      let transaction: string | null = null;
      if (decision.kind === "link") {
        const result = await linkTransfer(latest.current.token, decision.input, decision.match, decision.balances);
        if (!result?.id) throw new Error("The save response could not be verified.");
        transaction = result.id;
      } else {
        const result = decision.kind === "confirm"
          ? await confirmMessageCandidate(latest.current.token, decision.candidate, decision.input)
          : await rejectMessageCandidate(latest.current.token, decision.candidate, decision.input);
        if (result?.id !== decision.candidate || result.status !== (decision.kind === "confirm" ? "confirmed" : "ignored")
          || (decision.kind === "confirm" && !result.transaction)) throw new Error("The save response could not be verified.");
        transaction = result.transaction;
      }
      resolved([], false, transaction);
    } catch (reason) {
      if (!valid()) return;
      // A read failed before any write: nothing was sent by this attempt. An
      // earlier uncertain attempt remains uncertain until checked successfully.
      if (!attempted && !uncertainBefore) { restore(message(reason)); return; }
      operation.phase = "checking";
      operation.message = "Checking whether the server saved the decision…";
      emit(owner);
      let statuses: ParsedMessageCandidate[] | null = null;
      try { statuses = await read(); } catch { /* Keep uncertainty visible; do not write again. */ }
      if (!valid()) return;
      if (statuses?.some(row => row.status !== "needs_review")) {
        resolved(statuses, true, statuses.find(row => row.status === "confirmed")?.transaction ?? null);
      } else if (attempted && rejectedRequest(reason)) {
        restore(message(reason), statuses ?? []);
      } else {
        operation.phase = "unknown";
        operation.message = `${message(reason)}\nSave not confirmed. Check status or retry the same decision. Your edits are kept.`;
        emit(owner);
      }
    } finally {
      if (running.current === flight) running.current = null;
      emit(owner);
    }
  }

  function start(decision: ReviewDecision, snapshots: ReviewSnapshot[]) {
    const owner = store.current;
    if (!owner.scope || (running.current && owner.operation && ["checking", "saving"].includes(owner.operation.phase))
      || owner.operation?.phase === "unknown") return Promise.resolve();
    // Retries capture the exact payload, match and balance choices, never a newer form.
    const captured = JSON.parse(JSON.stringify(decision)) as ReviewDecision;
    const ids = affectedIds(captured);
    const operation: Operation = { decision: captured, snapshots, ids, phase: "checking", message: "Checking review status…", resultTransaction: null };
    owner.operation = operation; owner.dirty = true; owner.revision++;
    ids.forEach(id => owner.hidden.add(id));
    latest.current.onBegin(ids);
    emit(owner);
    return perform(owner, operation, false);
  }
  function retry(checkOnly = false) {
    const owner = store.current, operation = owner.operation;
    if (!operation || running.current || !["unknown", "failed"].includes(operation.phase)) return Promise.resolve();
    // A definite failure is edited/reviewed through the form. Its retry button
    // still repeats the original decision, after this read-only preflight.
    owner.dirty = true; owner.revision++;
    operation.ids.forEach(id => owner.hidden.add(id));
    latest.current.onBegin(operation.ids);
    return perform(owner, operation, true, checkOnly);
  }
  const owner = store.current, operation = owner.operation;
  useEffect(() => {
    if (operation?.phase !== "resolved") return;
    const timer = setTimeout(() => {
      if (owned(owner) && owner.operation === operation && operation.phase === "resolved") {
        owner.operation = null; emit(owner);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [operation, operation?.phase]);
  return {
    operation,
    busy: Boolean(operation && ["checking", "saving"].includes(operation.phase)),
    blocked: Boolean(operation && ["checking", "saving", "unknown"].includes(operation.phase)),
    paginationDirty: owner.dirty,
    start, retry: () => retry(false), check: () => retry(true),
    hidden: (id: string) => owner.hidden.has(id),
    visible: (rows: ParsedMessageCandidate[]) => rows.filter(row => !owner.hidden.has(row.id)),
    // A matched pending SMS can be outside the loaded page. Inbox refreshes
    // cannot replace this pre-decision baseline while saving/uncertain.
    count: (count: number) => Math.max(0, count - owner.hidden.size),
    refreshMarker: () => ({ owner, revision: owner.revision, settled: [...owner.settled] }),
    acceptRefresh: (marker: { owner: Store; revision: number; settled: string[] }) => {
      if (store.current !== marker.owner || marker.revision !== owner.revision) return false;
      if (owner.operation && ["checking", "saving", "unknown"].includes(owner.operation.phase)) return false;
      marker.settled.forEach(id => { owner.hidden.delete(id); owner.settled.delete(id); });
      if (!owner.operation || !["checking", "saving", "unknown"].includes(owner.operation.phase)) owner.dirty = false;
      emit(owner); return true;
    },
    dismiss: () => {
      const current = store.current;
      if (current !== owner || !current.operation || ["checking", "saving", "unknown"].includes(current.operation.phase)) return;
      current.operation = null; emit(current);
    },
  };
}
