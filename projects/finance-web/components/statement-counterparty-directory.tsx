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
  if (row.profile === "ebl_bank") return row.code.startsWith("npsb:masked:")
    ? `Masked card/account · ${row.code.slice("npsb:masked:".length)}`
    : "Retired EBL movement field";
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
  const { notify, dismiss } = useToast();
  const [rows, setRows] = useState<StatementCounterpartyCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    providers: { profile: string; label: string; found: number; scanned: number; updated: number }[];
    issues: { id: string; label: string; reason: string }[];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const token = getAccessToken();
    if (!token) { setLoadError("Sign in to review statement codes."); setLoading(false); return; }
    setLoading(true); setLoadError(null);
    void Promise.all([
      listStatementCounterpartyCodes(token, controller.signal),
      listAccounts(token, controller.signal),
      listCategories(token, controller.signal),
    ]).then(([codes, ownedAccounts, allCategories]) => {
      if (!controller.signal.aborted) { setRows(codes); setAccounts(ownedAccounts); setCategories(allCategories); }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "Could not load statement codes.";
        setLoadError(message); notify(message, "error");
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh, notify]);

  const visible = useMemo(() => rows.filter((row) =>
    (!accountFilter || row.account === accountFilter)
    && (!profileFilter || row.profile === profileFilter)
    && (!statusFilter || (row.profile !== "ebl_bank" && (statusFilter === "mapped" ? Boolean(row.mapping) : !row.mapping)))
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
      const providers = [
        { profile: "ebl_bank", label: "EBL bank", found: 0, scanned: 0, updated: 0 },
        { profile: "bkash", label: "bKash", found: 0, scanned: 0, updated: 0 },
      ];
      const issues: { id: string; label: string; reason: string }[] = [];
      for (const item of imports) {
        const provider = providers.find((value) => value.profile === item.profile)!;
        provider.found += 1;
        const label = `${item.account_name} · ${item.period_start ? formatCalendarDate(item.period_start) : "unknown"}–${item.period_end ? formatCalendarDate(item.period_end) : "unknown"}`;
        if (!item.has_original_file) {
          issues.push({ id: item.id, label, reason: "Saved PDF unavailable. Re-upload the identical statement." });
          continue;
        }
        try {
          provider.updated += await refreshStatementIdentifiers(token, item.id);
          provider.scanned += 1;
        } catch (reason) {
          issues.push({ id: item.id, label, reason: reason instanceof Error ? reason.message : "Could not read this saved PDF. Open it to enter a PDF password if needed." });
        }
      }
      setRecoveryResult({ providers, issues });
      setShown(50);
      setRefresh((value) => value + 1);
      const counts = providers.map((provider) => `${provider.label}: ${provider.updated} rows updated`).join("; ");
      notify(issues.length
        ? `Scan incomplete: ${issues.length} PDF${issues.length === 1 ? " needs" : "s need"} attention. ${counts}. Open the affected statements below.`
        : imports.length ? `Scan finished. ${counts}. See the scan results for details.` : "No saved EBL/bKash statements were found.",
      issues.length ? "error" : "success");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not list saved statements.";
      setError(message); notify(message, "error");
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
    <p className="section-subtitle">Review masked EBL card/account clues and identify recurring Citytouch/bKash parties. Party mappings belong to one reporting account and debit or credit direction.</p>
    <details className="statement-code-help"><summary>How to read statement identifiers</summary>
    <p className="inline-note">In <strong>CT-FT-***1234-***5678</strong>, the first part identifies a movement. We use every visible digit of the second part as a possible party clue. When only four digits are available, different parties can share that suffix. Verify it against your records before saving. Debit means money left the reporting account; credit means money arrived.</p>
    <p className="inline-note">Bank operation and ledger purpose are separate. A Citytouch fund transfer can be an internal transfer, a payment, or another type. Your choice suggests details for pending rows; it never posts or changes a transaction automatically.</p>
    <p className="inline-note">EBL shows the repeated masked value, including its trailing star, as read-only card/account evidence. It may be your own sending card; it does not establish a recipient. The following numeric field and // movement references are not recurring party identifiers. Older EBL recipient rules based on that field are no longer applied. Existing transactions stay unchanged; possible charges remain separate.</p>
    <p className="inline-note">For bKash, recipient/recharge numbers and merchant or biller labels can repeat. A TRX ID identifies just one movement, so it is never used as a recurring code. Verify any suggestion before recording.</p>
    </details>
    <p><Link href="/statements">Back to statement reviews</Link></p>
    <div className="statement-code-recovery">
      <p>EBL masked clues are read from saved statement rows. Scanning can correct older EBL identifier metadata or recover missing bKash identifiers. It does not change transactions. Open a password-protected PDF in its statement review to refresh it.</p>
      <button className="button" type="button" disabled={recovering} onClick={() => void recoverIdentifiers()}>{recovering ? "Scanning saved EBL/bKash PDFs…" : "Find identifiers in saved EBL/bKash PDFs"}</button>
      {recoveryResult ? <div role="status">
        <ul>{recoveryResult.providers.map((provider) => <li key={provider.profile}><strong>{provider.label}:</strong> {provider.found ? `scanned ${provider.scanned} of ${provider.found} saved PDFs; updated identifier metadata on ${provider.updated} rows.` : "No saved PDFs found."}</li>)}</ul>
        <p>These are statement row counts, not unique recipients. Zero updates can mean metadata was already correct or no supported clue was found. Your current filters are unchanged.</p>
        {recoveryResult.issues.length ? <ul>{recoveryResult.issues.map((issue) => <li key={issue.id}><Link href={`/statements?import=${encodeURIComponent(issue.id)}`}>{issue.label}</Link>: {issue.reason}</li>)}</ul> : null}
      </div> : null}
    </div>
    <div className="statement-code-filters">
      <label className="field"><span className="field__label">Search code or name</span><input className="field__control" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setShown(50); }} /></label>
      <label className="field"><span className="field__label">Statement type</span><select className="field__control" value={profileFilter} onChange={(event) => { setProfileFilter(event.target.value); setShown(50); }}><option value="">All statements</option><option value="city_bank">City Bank ({rows.filter((row) => row.profile === "city_bank").length})</option><option value="bkash">bKash ({rows.filter((row) => row.profile === "bkash").length})</option><option value="ebl_bank">EBL bank ({rows.filter((row) => row.profile === "ebl_bank").length})</option></select></label>
      <label className="field"><span className="field__label">Reporting account</span><select className="field__control" value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value); setShown(50); }}><option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label className="field"><span className="field__label">Mapping</span><select className="field__control" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setShown(50); }}><option value="">All</option><option value="unmapped">Needs identification</option><option value="mapped">Saved</option></select></label>
    </div>
    {loading ? <p role="status">Loading statement codes…</p> : null}
    {loadError ? <div><p role="alert" className="form-error">{loadError}</p><button className="button" type="button" disabled={loading} onClick={() => { dismiss(); setRefresh((value) => value + 1); }}>Retry loading identifiers</button></div> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {!loading && !loadError && !visible.length ? <p>No statement identifiers match these filters. Import an EBL bank, City Bank or bKash statement to discover them.</p> : null}
    <div className="statement-code-list">{shownRows.map((row) => {
      const key = `${row.account}:${row.profile}:${row.code}:${row.direction}`;
      const isEditing = editing === key && draft;
      const otherOptions = accounts.filter((account) => account.id !== row.account && account.is_active && account.currency === accounts.find((value) => value.id === row.account)?.currency);
      return <article className="statement-code-card" key={key}>
        <div className="statement-code-card__heading"><div><h3>{row.account_name} · {codeLabel(row)}</h3><p>{row.direction === "debit" ? "Money out" : "Money in"} · {row.count} observed · {row.pending_count} pending{row.last_seen ? ` · last seen ${formatCalendarDate(row.last_seen)}` : ""}{row.profile === "city_bank" && row.code.length === 4 ? " · only four digits available" : ""}</p></div><span className={row.profile === "ebl_bank" ? "status-badge" : row.mapping ? "status-badge status-badge--ok" : "status-badge status-badge--warning"}>{row.profile === "ebl_bank" ? row.code.startsWith("npsb:masked:") ? "Account clue" : "Retired reference" : row.mapping ? "Saved" : "Unidentified"}</span></div>
        {row.examples.length ? <details className="statement-code-examples"><summary>Recent masked statement rows</summary><ul>{row.examples.map((example, index) => <li key={`${example.date}-${index}`}>{formatCalendarDate(example.date)} · {example.amount ?? "Amount unknown"} · {example.description}</li>)}</ul></details> : null}
        {row.profile === "ebl_bank" ? <><p>{row.code.startsWith("npsb:masked:") ? "This printed masked value may identify the sending card/account. It does not identify the recipient, so it cannot set a transfer destination or merchant rule." : "This movement field was incorrectly used as a recurring identifier and is retired. The corrected API must be deployed before masked card/account evidence can be shown. Do not use this field as a recipient rule."}</p><Link className="button" href="/accounts">Review account recognition</Link></> : !isEditing ? <><p>{row.mapping ? `${row.mapping.label} · ${row.mapping.party_kind === "owned" ? "My account" : "External party"}${row.mapping.suggested_type ? ` · ${row.mapping.suggested_type.replaceAll("_", " ")}` : " · no type suggestion"}` : "Check who or what this identifier represents."}</p><button className="button" type="button" onClick={() => open(row)}>{row.mapping ? "Edit mapping" : "Identify"}</button></> :
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
