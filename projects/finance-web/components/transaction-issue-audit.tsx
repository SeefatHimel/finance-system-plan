"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowsClockwise, CheckCircle, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { formatCalendarDate } from "../../finance-contracts/presentation";
import { getAccessToken } from "@/lib/auth-storage";
import { refreshEvidenceDirections, scanTransactionIssues, type TransactionIssuePage } from "@/lib/api";

const BulkTransactionRevalidationDialog = dynamic(() => import("@/components/bulk-transaction-revalidation").then(module => module.BulkTransactionRevalidationDialog));
type Finding = TransactionIssuePage["results"][number];
type Phase = "idle" | "running" | "paused" | "complete" | "error";
type Refresh = { phase: Phase; sms: number; smsTotal: number; updated: number; smsKnown: number; smsUnknown: number; statements: number; statementTotal: number; statementKnown: number; statementUnknown: number; error: string };
type Check = { phase: Phase; scanned: number; total: number; error: string; stale: boolean };
const emptyRefresh: Refresh = { phase: "idle", sms: 0, smsTotal: 0, updated: 0, smsKnown: 0, smsUnknown: 0, statements: 0, statementTotal: 0, statementKnown: 0, statementUnknown: 0, error: "" };
const emptyCheck: Check = { phase: "idle", scanned: 0, total: 0, error: "", stale: false };
const directionCodes = new Set(["sms_source_direction_mismatch", "statement_source_direction_mismatch", "statement_draft_direction_mismatch"]);
const isDirection = (finding: Finding) => finding.issues.some(issue => directionCodes.has(issue.code));

function Progress({ done, total }: { done: number; total: number }) {
  return <div className="evidence-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-label={`${done} of ${total || "unknown"} checked`}><span style={{ width: `${total ? Math.min(100, done / total * 100) : 0}%` }} /></div>;
}

export function TransactionIssueAudit({ onEdit, onRevalidate }: { onEdit: (id: string) => void; onRevalidate: (id: string) => void }) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [refresh, setRefresh] = useState<Refresh>(emptyRefresh);
  const [check, setCheck] = useState<Check>(emptyCheck);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [filter, setFilter] = useState<"all" | "direction" | "other">("all");
  const [visibleCount, setVisibleCount] = useState(25);
  const refreshRequest = useRef<AbortController | null>(null);
  const checkRequest = useRef<AbortController | null>(null);
  const refreshNext = useRef(0);
  const checkNext = useRef(0);

  useEffect(() => {
    const changed = () => setCheck(current => ({ ...current, stale: current.phase !== "idle" }));
    window.addEventListener("finance:transactions-changed", changed);
    return () => { window.removeEventListener("finance:transactions-changed", changed); refreshRequest.current?.abort(); checkRequest.current?.abort(); };
  }, []);

  async function runRefresh(resume = false) {
    if (refreshRequest.current) return;
    const token = getAccessToken();
    if (!token) { setRefresh(current => ({ ...current, phase: "error", error: "Sign in before refreshing saved evidence." })); return; }
    const controller = new AbortController(); refreshRequest.current = controller;
    if (!resume) { refreshNext.current = 0; setRefresh({ ...emptyRefresh, phase: "running" }); }
    else setRefresh(current => ({ ...current, phase: "running", error: "" }));
    try {
      while (!controller.signal.aborted) {
        const page = await refreshEvidenceDirections(token, refreshNext.current, controller.signal);
        if (controller.signal.aborted) break;
        refreshNext.current = page.next_offset ?? 0;
        setRefresh(current => ({ ...current, phase: page.next_offset === null ? "complete" : "running", sms: current.sms + page.sms_scanned, smsTotal: page.sms_total, updated: current.updated + page.sms_updated, smsKnown: current.smsKnown + page.sms_known, smsUnknown: current.smsUnknown + page.sms_unknown, statements: current.statements + page.statement_scanned, statementTotal: page.statement_total, statementKnown: current.statementKnown + page.statement_known, statementUnknown: current.statementUnknown + page.statement_unknown, error: "" }));
        if (page.next_offset === null) { setCheck(current => ({ ...current, stale: current.phase !== "idle" })); break; }
      }
    } catch (error) { if (!controller.signal.aborted) setRefresh(current => ({ ...current, phase: "error", error: error instanceof Error ? error.message : "Could not refresh evidence." })); }
    finally { if (refreshRequest.current === controller) refreshRequest.current = null; }
  }

  async function runCheck(resume = false) {
    if (checkRequest.current) return;
    const token = getAccessToken();
    if (!token) { setCheck(current => ({ ...current, phase: "error", error: "Sign in before checking transactions." })); return; }
    const controller = new AbortController(); checkRequest.current = controller;
    if (!resume) { checkNext.current = 0; setFindings([]); setFilter("all"); setVisibleCount(25); setCheck({ ...emptyCheck, phase: "running" }); }
    else setCheck(current => ({ ...current, phase: "running", error: "" }));
    try {
      while (!controller.signal.aborted) {
        const page = await scanTransactionIssues(token, checkNext.current, controller.signal);
        if (controller.signal.aborted) break;
        checkNext.current = page.next_offset ?? 0;
        setFindings(current => [...current, ...page.results]);
        setCheck(current => ({ ...current, phase: page.next_offset === null ? "complete" : "running", scanned: current.scanned + page.scanned, total: page.total, error: "" }));
        if (page.next_offset === null) break;
      }
    } catch (error) { if (!controller.signal.aborted) setCheck(current => ({ ...current, phase: "error", error: error instanceof Error ? error.message : "Could not check transactions." })); }
    finally { if (checkRequest.current === controller) checkRequest.current = null; }
  }

  const directionCount = findings.filter(isDirection).length;
  const shown = findings.filter(finding => filter === "all" || (filter === "direction") === isDirection(finding)).sort((left, right) => Number(isDirection(right)) - Number(isDirection(left)));
  const visible = shown.slice(0, visibleCount);
  const refreshDone = refresh.sms + refresh.statements;
  const refreshTotal = refresh.smsTotal + refresh.statementTotal;
  return <div className="evidence-workflow">
    <section className="evidence-step" aria-labelledby="refresh-evidence-heading" aria-busy={refresh.phase === "running"}>
      <div className="evidence-step__header"><span className="evidence-step__number">01</span><div><h3 id="refresh-evidence-heading">Update saved source directions</h3><p>Recover missing SMS debit/credit observations from saved messages and verify the original direction stored with statement rows. Ledger entries and original sources stay unchanged.</p></div></div>
      <div className="evidence-step__actions"><button className="button" type="button" disabled={refresh.phase === "running" || check.phase === "running"} onClick={() => void runRefresh(refresh.phase === "paused" || refresh.phase === "error" && refreshDone > 0)}><ArrowsClockwise size={18} aria-hidden="true" />{refresh.phase === "paused" ? "Continue update" : refresh.phase === "running" ? "Updating…" : "Update saved evidence"}</button>{refresh.phase === "running" ? <button className="button button--ghost" type="button" onClick={() => { refreshRequest.current?.abort(); refreshRequest.current = null; setRefresh(current => ({ ...current, phase: "paused" })); }}>Pause</button> : null}</div>
      {refresh.phase !== "idle" ? <><div className="evidence-step__status" role="status">{refresh.phase === "running" ? <span className="evidence-spinner" aria-hidden="true" /> : refresh.phase === "complete" ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : null}<span>{refresh.phase === "complete" ? "Update complete" : refresh.phase === "running" ? "Updating saved evidence" : refresh.phase === "paused" ? "Update paused" : "Update interrupted"} · {refreshDone} of {refreshTotal || "…"} sources checked</span></div><Progress done={refreshDone} total={refreshTotal} /></> : null}
      {refresh.error ? <p className="evidence-error" role="alert">{refresh.error}</p> : null}
      {refresh.phase === "complete" ? <><div className="evidence-metrics"><div><strong>{refresh.updated}</strong><span>older SMS directions recovered</span></div><div><strong>{refresh.smsKnown}</strong><span>SMS directions stored</span></div><div><strong>{refresh.statementKnown}</strong><span>statement directions stored</span></div><div className={refresh.smsUnknown + refresh.statementUnknown ? "evidence-metrics__needs-review" : ""}><strong>{refresh.smsUnknown + refresh.statementUnknown}</strong><span>sources needing review</span></div></div>{refresh.smsUnknown + refresh.statementUnknown ? <p className="evidence-step__hint">{refresh.smsUnknown} SMS and {refresh.statementUnknown} statement rows still have no reliable source direction. Inspect their original evidence during review; the edited draft or ledger direction cannot safely replace it.</p> : null}</> : null}
    </section>

    <section className="evidence-step" aria-labelledby="check-evidence-heading" aria-busy={check.phase === "running"}>
      <div className="evidence-step__header"><span className="evidence-step__number">02</span><div><h3 id="check-evidence-heading">Check for mismatches</h3><p>Compare attached SMS and statement evidence with saved ledger entries. Findings are highlighted for review; the check changes nothing.</p></div></div>
      <div className="evidence-step__actions"><button className="button button--ghost" type="button" disabled={check.phase === "running" || refresh.phase === "running"} onClick={() => void runCheck(!check.stale && (check.phase === "paused" || check.phase === "error" && check.scanned > 0))}><MagnifyingGlass size={18} aria-hidden="true" />{check.stale ? "Run checks again" : check.phase === "paused" ? "Continue check" : check.phase === "running" ? "Checking…" : "Check all transactions"}</button>{check.phase === "running" ? <button className="button button--ghost" type="button" onClick={() => { checkRequest.current?.abort(); checkRequest.current = null; setCheck(current => ({ ...current, phase: "paused" })); }}>Pause</button> : null}</div>
      {check.phase !== "idle" ? <><div className="evidence-step__status" role="status">{check.phase === "running" ? <span className="evidence-spinner" aria-hidden="true" /> : check.phase === "complete" ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : null}<span>{check.phase === "complete" ? "Check complete" : check.phase === "running" ? "Checking transactions" : check.phase === "paused" ? "Check paused" : "Check interrupted"} · {check.scanned} of {check.total || "…"} reviewed</span></div><Progress done={check.scanned} total={check.total} /></> : null}
      {check.error ? <p className="evidence-error" role="alert">{check.error}</p> : null}
      {check.stale ? <p className="evidence-stale" role="status"><WarningCircle size={18} aria-hidden="true" />Saved data changed after this check. Run it again for current findings.</p> : null}
      {check.phase !== "idle" ? <div className="evidence-results"><div className="evidence-results__heading"><div><h4>Findings</h4><p>{findings.length} entries need attention{check.phase === "running" ? " so far" : ""}</p></div><div className="evidence-results__filters" role="group" aria-label="Filter findings"><button type="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setVisibleCount(25); }}>All <span>{findings.length}</span></button><button type="button" aria-pressed={filter === "direction"} onClick={() => { setFilter("direction"); setVisibleCount(25); }}>Direction <span>{directionCount}</span></button><button type="button" aria-pressed={filter === "other"} onClick={() => { setFilter("other"); setVisibleCount(25); }}>Other <span>{findings.length - directionCount}</span></button></div></div>
        {shown.length ? <><div className="evidence-results__list">{visible.map(finding => { const direction = isDirection(finding); return <article className={`evidence-finding${direction ? " evidence-finding--direction" : ""}`} key={finding.transaction}><div className="evidence-finding__top"><div><span className="evidence-finding__kind">{direction ? <WarningCircle size={16} weight="fill" aria-hidden="true" /> : null}{direction ? "Direction conflict" : "Needs review"}</span><h5>{finding.account} · BDT {finding.amount}</h5><span>{formatCalendarDate(finding.date)}</span></div><div className="evidence-finding__actions"><button className="button button--ghost button--small" onClick={() => onEdit(finding.transaction)} type="button">Review entry</button><button className="button button--ghost button--small" onClick={() => onRevalidate(finding.transaction)} type="button">Preview corrections</button></div></div><ul>{finding.issues.map(issue => <li key={issue.code}><strong>{issue.level === "suggestion" ? "Suggestion" : "Check"}</strong>{issue.text}</li>)}</ul></article>; })}</div>{shown.length > visibleCount ? <button className="button button--ghost evidence-results__more" type="button" onClick={() => setVisibleCount(count => count + 25)}>Show 25 more · {shown.length - visibleCount} remaining</button> : null}</> : <p className="evidence-results__empty">{check.phase === "running" ? "No findings in the pages checked so far." : "No findings in this view. These checks do not verify every transaction detail."}</p>}
      </div> : null}
    </section>

    <details className="evidence-checks-tools"><summary>Advanced: bulk ledger corrections</summary><p>Review eligible corrections individually before applying them to confirmed transactions. Source evidence is never replaced.</p><button className="button button--ghost" onClick={() => setBulkOpen(true)} type="button">Open bulk revalidation</button></details>
    {bulkOpen ? <BulkTransactionRevalidationDialog onClose={() => setBulkOpen(false)} /> : null}
  </div>;
}
