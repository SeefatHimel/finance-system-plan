"use client";

import { formatCalendarDate } from "../../finance-contracts/presentation";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast-provider";
import { getAccessToken } from "@/lib/auth-storage";
import { directionForType, transactionTypes } from "@/lib/category-type";
import {
  forgetStatementCounterpartyCode, listAccounts, listCategories,
  listStatementCounterpartyCodes, listStatementImports,
  refreshStatementIdentifiers, saveStatementCounterpartyCode,
  type Account, type Category, type SavedStatement, type StatementCounterpartyCode,
  type StatementCounterpartyCodeInput,
} from "@/lib/api";

function initialChoice(row: StatementCounterpartyCode): StatementCounterpartyCodeInput {
  return {
    account: row.account, profile: row.profile, code: row.code, direction: row.direction,
    party_kind: row.mapping?.party_kind ?? "external",
    label: row.mapping?.label ?? "",
    other_account: row.mapping?.other_account ?? null,
    suggested_type: row.mapping?.suggested_type ?? "",
    category: row.mapping?.category ?? null,
    note_template: row.mapping?.note_template ?? "",
  };
}

function codeLabel(row: StatementCounterpartyCode) {
  if (row.profile === "city_bank") return row.code;
  if (row.profile === "ebl_bank") return `EBL NPSB · ${row.code.replace(/^npsb:code:/, "")} (printed identifier)`;
  const [kind, valueKind, ...value] = row.code.split(":");
  const title: Record<string, string> = { recharge: "Mobile recharge", send: "Send money", payment: "Payment", bill: "Pay bill" };
  return `${title[kind] ?? "bKash"} · ${value.join(":")}${valueKind === "phone" ? " (number)" : ""}`;
}

function compatibleCategory(category: Category, type: string) {
  const kinds: Record<string, string[]> = {
    expense: ["expense", "fee"], income: ["income", "refund"],
    transfer: ["transfer"], debt: ["lend", "borrow", "repayment_received", "repayment_paid"],
  };
  return category.kind === "system" || (kinds[category.kind] ?? []).includes(type);
}

export function StatementCounterpartyDirectory() {
  const { notify } = useToast();
  const [rows, setRows] = useState<StatementCounterpartyCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<StatementCounterpartyCodeInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [profileFilter, setProfileFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [shown, setShown] = useState(50);
  const [refresh, setRefresh] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<{
    found: number; scanned: number; updated: number; issues: { id: string; label: string; reason: string }[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    if (!token) { setError("Sign in to review statement codes."); setLoading(false); return; }
    setLoading(true); setError(null);
    void Promise.all([
      listStatementCounterpartyCodes(token, controller.signal),
      listAccounts(token, controller.signal),
      listCategories(token, controller.signal),
    ]).then(([codes, ownedAccounts, allCategories]) => {
      if (!controller.signal.aborted) { setRows(codes); setAccounts(ownedAccounts); setCategories(allCategories); }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load statement codes.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const visible = useMemo(() => rows.filter((row) =>
    (!accountFilter || row.account === accountFilter)
    && (!profileFilter || row.profile === profileFilter)
    && (!statusFilter || (statusFilter === "mapped" ? Boolean(row.mapping) : !row.mapping))
    && (!query || `${row.code} ${row.account_name} ${row.mapping?.label ?? ""}`.toLowerCase().includes(query.toLowerCase().trim()))
  ), [rows, accountFilter, profileFilter, statusFilter, query]);
  const shownRows = visible.slice(0, shown);

  async function recoverIdentifiers() {
    const token = getAccessToken();
    if (!token || recovering) return;
    setRecovering(true); setRecoveryResult(null); setError(null);
    try {
      let offset = 0;
      const imports: SavedStatement[] = [];
      while (true) {
        const page = await listStatementImports(token, offset);
        imports.push(...page.results.filter((item) => ["bkash", "ebl_bank"].includes(item.profile)));
        offset += page.results.length;
        if (!page.next || !page.results.length) break;
      }
      let scanned = 0;
      let updated = 0;
      const issues: { id: string; label: string; reason: string }[] = [];
      for (const item of imports) {
        const label = `${item.account_name} · ${item.period_start ? formatCalendarDate(item.period_start) : "unknown"}–${item.period_end ? formatCalendarDate(item.period_end) : "unknown"}`;
        if (!item.has_original_file) {
          issues.push({ id: item.id, label, reason: "Saved PDF unavailable. Re-upload the identical statement." });
          continue;
        }
        try {
          updated += await refreshStatementIdentifiers(token, item.id);
          scanned += 1;
        } catch (reason) {
          issues.push({ id: item.id, label, reason: reason instanceof Error ? reason.message : "Could not read this saved PDF. Open it to enter a PDF password if needed." });
        }
      }
      setRecoveryResult({ found: imports.length, scanned, updated, issues });
      setQuery(""); setAccountFilter(""); setStatusFilter(""); setProfileFilter(""); setShown(50);
      setRefresh((value) => value + 1);
      notify(imports.length ? `Scanned ${scanned} saved EBL/bKash statement${scanned === 1 ? "" : "s"}; found ${updated} new identifier${updated === 1 ? "" : "s"}.` : "No saved EBL/bKash statements were found.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not list saved statements.");
    } finally {
      setRecovering(false);
    }
  }

  function open(row: StatementCounterpartyCode) {
    setEditing(`${row.account}:${row.profile}:${row.code}:${row.direction}`);
    setDraft(initialChoice(row));
    setError(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = getAccessToken();
    if (!token || !draft || busy) return;
    setBusy(true); setError(null);
    try {
      await saveStatementCounterpartyCode(token, draft);
      setEditing(null); setDraft(null); setRefresh((value) => value + 1);
      notify("Code saved. Pending statement rows can now show this suggestion; posted transactions stay unchanged.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not save this code.";
      setError(message); notify(message, "error");
    } finally { setBusy(false); }
  }

  async function forget(row: StatementCounterpartyCode) {
    const token = getAccessToken();
    if (!token || !row.mapping || busy) return;
    setBusy(true); setError(null);
    try {
      await forgetStatementCounterpartyCode(token, row.mapping.id);
      setEditing(null); setDraft(null); setRefresh((value) => value + 1);
      notify("Mapping removed. The observed code remains in the directory.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not remove this mapping.";
      setError(message); notify(message, "error");
    } finally { setBusy(false); }
  }

  return <div className="panel"><div className="panel__body statement-code-page">
    <h2 className="section-title">Statement identifiers</h2>
    <p className="section-subtitle">Identify printed EBL NPSB identifiers and repeatable Citytouch/bKash clues. Each mapping belongs to one reporting account and debit or credit direction. Verify the original PDF before naming a party.</p>
    <details className="statement-code-help"><summary>How to read statement identifiers</summary>
    <p className="inline-note">In <strong>CT-FT-***1234-***5678</strong>, the first part identifies a movement. We use every visible digit of the second part as a possible party clue. When only four digits are available, different parties can share that suffix. Verify it against your records before saving. Debit means money left the reporting account; credit means money arrived.</p>
    <p className="inline-note">Bank operation and ledger purpose are separate. A Citytouch fund transfer can be an internal transfer, a payment, or another type. Your choice suggests details for pending rows; it never posts or changes a transaction automatically.</p>
    <p className="inline-note">EBL NPSB identifiers are printed clues, not verified recipients. The masked card may identify your own reporting card. A // movement reference can connect a transfer and a possible charge; it is never a recurring party code. Verify who the numeric identifier represents before naming or mapping it. Possible fee rows stay separate and do not inherit transfer mappings.</p>
    <p className="inline-note">For bKash, recipient/recharge numbers and merchant or biller labels can repeat. A TRX ID identifies just one movement, so it is never used as a recurring code. Verify any suggestion before recording.</p>
    </details>
    <p><Link href="/statements">Back to statement reviews</Link></p>
    <div className="statement-code-recovery">
      <p>Missing EBL or bKash identifiers? Older imports may need their saved PDFs scanned again. Reloading the import list does not extract identifiers. A password-protected PDF must be refreshed from its own statement review.</p>
      <button className="button" type="button" disabled={recovering} onClick={() => void recoverIdentifiers()}>{recovering ? "Scanning saved EBL/bKash PDFs…" : "Find identifiers in saved EBL/bKash PDFs"}</button>
      {recoveryResult ? <div role="status"><p>{recoveryResult.found ? `Scanned ${recoveryResult.scanned} saved EBL/bKash PDFs and added identifiers to ${recoveryResult.updated} rows. If none were added, the rows may already have identifiers or lack a repeatable clue.` : "No saved EBL/bKash statements were found."}</p>{recoveryResult.issues.length ? <ul>{recoveryResult.issues.map((issue) => <li key={issue.id}><Link href={`/statements?import=${encodeURIComponent(issue.id)}`}>{issue.label}</Link>: {issue.reason}</li>)}</ul> : null}</div> : null}
    </div>
    <div className="statement-code-filters">
      <label className="field"><span className="field__label">Search code or name</span><input className="field__control" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setShown(50); }} /></label>
      <label className="field"><span className="field__label">Statement type</span><select className="field__control" value={profileFilter} onChange={(event) => { setProfileFilter(event.target.value); setShown(50); }}><option value="">All statements</option><option value="city_bank">City Bank ({rows.filter((row) => row.profile === "city_bank").length})</option><option value="bkash">bKash ({rows.filter((row) => row.profile === "bkash").length})</option><option value="ebl_bank">EBL bank ({rows.filter((row) => row.profile === "ebl_bank").length})</option></select></label>
      <label className="field"><span className="field__label">Reporting account</span><select className="field__control" value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value); setShown(50); }}><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label className="field"><span className="field__label">Mapping</span><select className="field__control" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setShown(50); }}><option value="">All</option><option value="unmapped">Needs identification</option><option value="mapped">Saved</option></select></label>
    </div>
    {loading ? <p role="status">Loading statement codes…</p> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {!loading && !visible.length ? <p>No statement identifiers match these filters. Import an EBL bank, City Bank or bKash statement to discover them.</p> : null}
    <div className="statement-code-list">{shownRows.map((row) => {
      const key = `${row.account}:${row.profile}:${row.code}:${row.direction}`;
      const isEditing = editing === key && draft;
      const otherOptions = accounts.filter((account) => account.id !== row.account && account.is_active && account.currency === accounts.find((value) => value.id === row.account)?.currency);
      return <article className="statement-code-card" key={key}>
        <div className="statement-code-card__heading"><div><h3>{row.account_name} · {codeLabel(row)}</h3><p>{row.direction === "debit" ? "Money out" : "Money in"} · {row.count} observed · {row.pending_count} pending{row.last_seen ? ` · last seen ${row.last_seen}` : ""}{row.profile === "city_bank" && row.code.length === 4 ? " · only four digits available" : ""}</p></div><span className={row.mapping ? "status-badge status-badge--ok" : "status-badge status-badge--warning"}>{row.mapping ? "Saved" : "Unidentified"}</span></div>
        {row.examples.length ? <details className="statement-code-examples"><summary>Recent masked statement rows</summary><ul>{row.examples.map((example, index) => <li key={`${example.date}-${index}`}>{formatCalendarDate(example.date)} · {example.amount ?? "Amount unknown"} · {example.description}</li>)}</ul></details> : null}
        {!isEditing ? <><p>{row.mapping ? `${row.mapping.label} · ${row.mapping.party_kind === "owned" ? "My account" : "External party"}${row.mapping.suggested_type ? ` · ${row.mapping.suggested_type.replaceAll("_", " ")}` : " · no type suggestion"}` : "Check who or what this identifier represents."}</p><button className="button" type="button" onClick={() => open(row)}>{row.mapping ? "Edit mapping" : "Identify"}</button></> :
          <form className="statement-code-form" onSubmit={save}>
            <label className="field"><span className="field__label">Who is this?</span><select className="field__control" value={draft.party_kind} onChange={(event) => setDraft({ ...draft, party_kind: event.target.value as "owned" | "external", other_account: null, suggested_type: "", category: null })}><option value="external">External person, business, or bank</option><option value="owned">Another account I track</option></select></label>
            <label className="field"><span className="field__label">Display name</span><input className="field__control" required maxLength={120} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="e.g. Rent recipient" /></label>
            {draft.party_kind === "owned" ? <label className="field"><span className="field__label">Other owned account</span><select className="field__control" required value={draft.other_account ?? ""} onChange={(event) => setDraft({ ...draft, other_account: event.target.value || null })}><option value="">Choose account</option>{otherOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : null}
            <label className="field"><span className="field__label">Suggest transaction type</span><select className="field__control" value={draft.suggested_type} onChange={(event) => setDraft({ ...draft, suggested_type: event.target.value, category: null })}><option value="">No type suggestion</option>{transactionTypes.filter((type) => (type !== "transfer" || draft.party_kind === "owned") && (type === "transfer" || type === "adjustment" || directionForType(type) === row.direction)).map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
            {draft.suggested_type ? <label className="field"><span className="field__label">Suggest category</span><select className="field__control" value={draft.category ?? ""} onChange={(event) => setDraft({ ...draft, category: event.target.value || null })}><option value="">No category suggestion</option>{categories.filter((category) => category.is_active && compatibleCategory(category, draft.suggested_type)).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label> : null}
            <label className="field"><span className="field__label">Suggest note</span><input className="field__control" maxLength={500} value={draft.note_template} onChange={(event) => setDraft({ ...draft, note_template: event.target.value })} placeholder="Optional note for this recipient" /><small className="field__hint">For bKash numbers, leaving this blank suggests the verified name in a short note. Existing edited notes are preserved.</small></label>
            <div className="statement-code-actions"><button className="button button--primary" type="submit" disabled={busy}>Save verified mapping</button><button className="button" type="button" disabled={busy} onClick={() => { setEditing(null); setDraft(null); }}>Cancel</button>{row.mapping ? <button className="button" type="button" disabled={busy} onClick={() => void forget(row)}>Forget mapping</button> : null}</div>
          </form>}
      </article>;
    })}</div>
    {shown < visible.length ? <button className="button" type="button" onClick={() => setShown((count) => count + 50)}>Show 50 more codes ({visible.length - shown} remaining)</button> : null}
  </div></div>;
}
