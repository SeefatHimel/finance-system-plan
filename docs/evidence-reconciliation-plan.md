# Evidence reconciliation and historical revalidation plan

Date: 2026-10-17
Status: first combined-transfer missing-report correction implemented; the shared
decision service, coverage workflow and historical revalidation remain planned.

## Outcome

One money movement is recorded once in the ledger. SMS, statement rows and manual
observations explain that movement, with source coverage and reported balances
shown separately for each owned account. Sources arriving later can enrich the
same entry. Improved parsing, identity mappings and reviewed knowledge can produce
repair proposals for history without silently rewriting confirmed transactions.

This plan takes priority over additional automatic posting. It applies to web and
mobile through the same backend decisions; neither client owns matching policy.
The immediate fix should ship independently of the larger revalidation feature.

## What exists and what needs correction

- `apps/statements/unified.py` pairs reciprocal, unique pending SMS and statement
  rows. It does not pair an already confirmed source with a later pending source.
- Statement review already suggests existing ledger entries; transfer review
  already links pending observations and can merge existing transfer duplicates.
  These are useful foundations, but their decisions and enrichment rules differ.
- Unified linking requires `balance_source=existing`. Its selection can keep an
  existing null account report effective even after known source balances arrive.
- The web pair form continues to edit/validate a statement draft when linking to
  an existing transaction, while most existing ledger fields are retained. The
  title "Final transaction" does not explain that difference.
- Transfer evidence, statement attachments, original SMS, effective account
  reports and audit records already exist. Source text can be unavailable under
  retention policy. Original source observations must stay distinct from corrections.
- Current SMS reprocess endpoints explicitly exclude confirmed candidates.
  Remembered sender/type, transfer-counterparty, statement and identity mappings
  provide scoped knowledge, not an always-training general AI model.
- Current Undo permits only the latest unchanged action for 24 hours. That is
  insufficient as the sole recovery mechanism for a historical repair campaign.

Relevant code: `apps/transactions/balance_reports.py`, `transfers.py`,
`recovery.py`; `apps/statements/services.py`, `unified.py`, `details.py`;
`apps/messages/views.py`; web `lib/transaction-balances.ts` and
`components/unified-review-workspace.tsx`; mobile `src/transaction-draft.ts`.
Paths to backend modules above are relative to `projects/finance-api`.

## Domain and correctness rules

1. Keep `Transaction` as the posted movement. Attaching evidence alone must not
   change ledger movement counts, cashflow classification, account endpoints or
   computed ledger balances. A reviewed report correction may change reported
   balance comparison, which is a separate effect shown in the preview.
2. Identify an observation by owned source, component and reporting account, not
   amount/date/reference. A reference is supporting evidence, never a unique key.
   A source may support principal and fee components; enforce one active posting
   per source movement component rather than an absolute one-document/one-entry rule.
3. Preserve original extraction, amount, direction, date/time, account attribution
   and source linkage history. Reparse into a new interpretation, never overwrite
   the only copy of a source or move its old balance to a different account.
4. Distinguish `missing`, `reported`, `reviewed_value` and `explicitly_cleared`.
   Zero and negative reported balances are valid. Unknown is not zero. An explicit
   null correction is not an invitation to refill it automatically. For legacy
   nulls whose intent cannot be established, mark intent unknown and propose review.
5. Compare balances only for the same account, movement and balance meaning.
   Cash balance, card available credit and card outstanding balance are distinct.
   Preserve exact decimals; do not choose a larger balance, average reports or
   round differences away. Existing near-balance match signals are not authority
   to treat financial values as equal.
6. Type, amount, currency, direction and account-path corrections to posted entries
   always require explicit before/after review, including their ledger effect.
   An income-like incoming source can describe the receiving side of an owned
   transfer; its parser label must not turn the whole transfer into income.
7. Same-account source corroboration and opposite-account transfer corroboration
   are separate checks. Statement and SMS from account B prove coverage of B,
   not that both A and B reported. Ledger endpoints alone prove no source coverage.
8. Repeated equal payments, reverse transfers, reversals, refunds, chargebacks,
   fees, partial settlements and currency conversions are not ordinary duplicates.
   Keep them separate or blocked until a supported relationship model exists.
9. Suggested matches need explanations, negative signals and ambiguity information.
   Amount/date alone never authorize automatic attachment or merge. Preserve
   current date-window safeguards; delayed settlement needs independent evidence
   and separately labelled posted/value/event dates, not a wider blind date window.
10. Enforce user/backend ownership, active source-link constraints, current
    versions, idempotency and shared writer locks on the server. A preview is
    advisory; apply must recheck all affected state atomically.

## Shared decision service

Extend the existing `apps/reconciliation` app with an evidence-decision service
boundary, preserving its account checks/snapshots and without creating a second
ledger. Stage one uses adapters over the existing canonical candidate, statement
row and transfer-evidence links. Existing endpoints delegate to it incrementally;
do not dual-write an independent link table or remove old routes in the first release.
If a normalized link table is later necessary, require an explicit migration,
backfill verification and authority cutover before using it as the source of truth.

The service accepts a typed `source_ref` (kind, UUID, component), one or more
sources, and an optional target transaction. It returns:

- intent: `create`, `attach`, `enrich`, `correct`, `merge_proposal` or `blocked`;
- source/target summaries, reporting-account perspective and current versions;
- match reasons, contradictions, competing candidates and completeness limits;
- exact proposed field changes with origin, current value, proposed value and
  whether manual approval is required;
- per-account source coverage before/after and financial/report-comparison impact;
- required decisions, expiry and a deterministic input/proposal fingerprint.

Never force a target's classification to match a source's parsed label just to
attach it. `attach` keeps ledger details; `enrich` fills eligible missing details;
`correct` changes existing values only through a reviewed patch. `merge_proposal`
is distinct from evidence attachment because it removes duplicate ledger effect.
Retain raw source observations even when a reviewed value becomes effective.

Suggested new boundary (final schema defined during implementation):

- `POST /api/reconciliation/proposals/`: bounded, read-only proposal generation.
- `POST /api/reconciliation/proposals/{id}/apply/`: selected decisions, proposal
  fingerprint, current versions and idempotency key. Returns the accepted result,
  evidence coverage and any supported recovery action. Stale inputs return 409
  with changed fields and a route to refresh; never silently recalculate approval.

Existing route authorization, private/no-store responses, exact monetary strings
and API schema generation remain mandatory. Clients consume one decision model.

## User workflow

Choose the intent before presenting editable fields:

- **Record new transaction**: the form is the proposed ledger entry, with source
  comparison and any competing ledger suggestions visible.
- **Same movement / attach to existing**: show the selected entry's actual type,
  path, amount, date and account reports. Replace the ambiguous draft title with
  "Existing transaction + proposed updates". Keep statement-draft corrections in
  a separate disclosure; they do not implicitly become ledger corrections.
- **Review changes**: show only missing information to add, conflicting fields,
  proposed balance selection and any financial impact. Use an in-panel step;
  open one focused conflict dialog where needed, not repeated stacked modals.
  Never confirm a conflict merely by opening that dialog.

On success show, for example, "Linked SMS + statement to the existing transfer;
no new transaction", with an evidence view and applicable recovery action.

Show coverage in the transaction list/details, selected match, review result and
account view. For each owned endpoint display SMS / statement / manual evidence
as `linked`, `not linked`, `unavailable under retention` or `not checked` where
appropriate. Preserve linked parsed metadata when text is redacted. Count actual
sources, not synthetic `balance:` correction rows, as source reports.

An account having no linked source does not mean the transaction did not happen.
Likewise, "not seen in this statement" is scoped to account, statement period,
posting/value-date interpretation and validated import completeness. Do not call
it an extra transaction merely because one uploaded PDF does not contain it.

On new import, review open/refresh, and accepted knowledge changes, mark affected
sources/entries for reassessment. Later sources search the existing ledger as well
as pending sources, across all supported transaction types. Show "Already recorded
— attach missing source" rather than creating a duplicate pending pair. Fully
resolved source components stay resolved; reassessment is a separate workflow.

## Revalidate history using current knowledge

Add **Revalidate history** with account, date range, source kind, issue kind and
"changed knowledge since last check" filters. Offer a transaction-level **Recheck**
using the same pipeline. Default to preview; an ordinary scan never mutates ledger,
confirmed sources, current effective reports, mappings or posting decisions.

Pipeline:

1. Freeze a knowledge manifest: matcher/parser code versions, applicable provider
   profiles, identity and remembered mapping revisions, and policy version. Version
   parser, matcher and each knowledge family separately; a UI release alone must
   not invalidate the whole history.
2. Read owned source snapshots and current transaction/evidence/decision revisions
   in bounded pages. Record the run's cutoff and cursor so new arrivals become
   new work instead of being skipped during pagination.
3. Reinterpret retained source text/PDF extraction in a sandboxed proposal context.
   Where text is gone, use retained structured observations and label restricted
   checks; do not fabricate text or bypass an explicit retention choice. Re-upload
   or authorized resync can restore evidence only under existing recovery rules.
4. Compare old interpretation, current saved decision and new interpretation.
   Categorize outcomes as unchanged, missing balance/detail, missing evidence link,
   account/path suggestion, conflicting report, probable duplicate movement,
   inconsistent ledger classification or insufficient source/ambiguity.
5. Produce a reasoned diff and affected account/period totals. Keep source quality
   separate from match strength; a learned alias is not proof of money movement.
6. Let the user apply selected proposals. Group simple additions separately from
   conflicting/financial corrections and duplicate merges. Apply each item in its
   own atomic transaction, report item outcomes, and keep failed/stale items reviewable.
7. Store the accepted decision, knowledge/input fingerprints, minimal before/after
   changes and source references in audit history. No additional raw SMS/PDF copies
   belong in run or audit payloads. Give transient previews bounded retention.

Persistent models needed for this layer: `RevalidationRun`,
`RevalidationProposal`, versioned `SourceInterpretation`, scoped `ReviewDecision`
and `KnowledgeRevision` (names provisional). Store explicit pair rejection, manual
field lock, deliberate clearing and reviewed balance selection as decisions with
scope and revision; do not infer all of these from a null field or free-text log.

Start with resumable DB-backed bounded batches and a management command. Do not
make one HTTP request scan a user's entire history. A persisted progress/status
API supports resume, cancel, retry and per-item errors; an always-on worker can
consume the same batches when infrastructure supports it. Cancellation stops new
work; it does not pretend to roll back items already applied. Show an explicit
compensation plan for those items.

Reassess only affected provider/account/pattern/date regions after a knowledge
change, using an index plus a periodic bounded sweep. Expose checked-through and
knowledge version so stale/unscanned data cannot look validated. A failure or
missing raw source is not a clean result.

## Repairing existing records

First run a read-only inventory, then preview repairs:

| Existing condition | Proposed repair | Approval rule |
| --- | --- | --- |
| Linked same-movement report is known, effective account report is genuinely absent | Select the agreed source report for that account | Review first during rollout; never override an explicit clear |
| SMS and PDF agree but a legacy blank report masks them | Explain source values and blank selection; propose effective-report repair | Unknown old intent requires approval |
| Source was posted alone, counterpart source is still pending | Attach the missing source to the existing movement | Explicit acceptance first; no extra ledger posting |
| Both sources were posted as separate transactions | Propose merge with before/after account and period totals | Always explicit; keep fee/reversal/debt/bill relationships intact |
| A better identity/mapping contradicts an earlier account or type choice | Show proposed correction and all dependent effects | Never silently replace a confirmed or manually locked choice |
| Evidence was attached to the wrong movement | Propose detach and reassignment with both entries previewed | Explicit, atomic, ownership-checked; do not delete the source |
| Source is absent, redacted, ambiguous or unsupported | Mark limited/unverifiable and offer source recovery if permitted | No invented match or report |

Do not rerun the current pending-only parser against confirmed candidates in place,
reset confirmed rows to pending, truncate tables, or ask users to re-enter/reimport
all their transactions. Repairs use the same proposal/apply service as new linking.
Re-importing a supported source can provide evidence without posting it again.

Historical repair has its own compensating-operation history, independent of the
24-hour latest-action Undo. A compensation rechecks subsequent changes and
relationships; conflict produces another review proposal, not a blind snapshot
restore. Duplicate merges must preserve all source references and explain changes
to movement counts and balances. Dependent debt, bill, reconciliation and statement
records require explicit handling or a blocked proposal.

## Learning and automation policy

A remembered mapping supplies a suggestion, not a fact about every old entry.
Explicit user decisions and source identity outrank learned classification hints.
A new rule triggers reassessment proposals, not retroactive financial posting.
Do not train/remember from automatic attachment itself, unaccepted suggestions,
compensated mistakes, or bulk repairs unless the user explicitly opts into the
appropriate mapping scope. Rejected pairs stay suppressed for unchanged inputs;
new material evidence may reopen them with a visible reason.

Automation levels are separate opt-ins:

1. Suggest and explain (initial release/default).
2. Attach uniquely corroborated missing evidence, without altering ledger fields,
   explicitly selected balance reports or source classification.
3. Fill eligible missing nonfinancial details or agreed reported balances only
   under a separately enabled policy, provenance/clear-state checks and an audit.

Creating money movements, changing account/type/amount/currency, duplicate merges,
fees/reversals and conflicting reports stay manual in this plan. Disable/revoke an
automation policy without losing the decisions it produced. Measure actual user
corrections/compensations, ambiguity, duplicate escapes, proposal staleness and
coverage; a confidence label alone does not justify enabling automation.

## Implementation sequence and acceptance gates

| Phase | Scope and likely commit/PR boundary | Acceptance gate |
| --- | --- | --- |
| 0 | Synthetic reproductions and baseline inventory command | Reproduce blank-effective combined transfer, late source, conflicting reports and repeated equal payments; scans are read-only |
| 1 | API: correct combined link selection and distinguish missing vs deliberate clear; expose effective report versus original reports | Missing receiving balance fills from agreeing sources; sender report unchanged; zero preserved; conflict/explicit-clear/unknown intent require a choice; no additional movement; retries and stale decisions safe |
| 2 | API/contracts: shared proposal and apply service; adapt combined, statement and SMS routes | Same policy across source order and route; late evidence finds existing movements across supported types; no ambiguous/multi-target auto-link; locks and idempotency verified |
| 3 | Web: intent-specific form, before/after decision step, per-account coverage and receipt | Link mode displays real target; editable statement draft cannot masquerade as ledger update; coverage distinguishes account side and source kind; drafts survive dialogs |
| 4 | API/web: resumable historical scan, proposals, selective apply and compensation | Existing known cases repair without reposting; stale/changed-knowledge proposals rejected; dry runs write only scan/proposal records, never ledger/source decisions; retry/cancel/partial failure honest; source retention honored |
| 5 | Mobile: consume shared decisions, coverage, targeted recheck and recovery | Same conflicts and results as web; no independent matcher; offline proposals cannot apply until refreshed; new signed APK and physical-device checks |
| 6 | Infrastructure/product: targeted background reassessment and opt-in evidence automation | Correctness/precision measured on reviewed synthetic and permitted private validation; automation excludes financial corrections; bounded cost and visible status |

Ship phases 0–1 as a focused correction. Phases 2–3 complete new-source linking.
Phase 4 is required before calling historical revalidation available. Defer broad
automation until this lifecycle, conflict handling and compensation are proven.
No rewrite of the entire project or new AI service is required.

## Verification and rollout

Tests must cover source-arrival order (SMS first, PDF first, both pending, both
posted, opposite account first), existing empty/zero/negative/cleared reports,
conflicting same-account reports, repeated equal payments, missing time, delayed
posting, limited statement coverage, inactive/deleted accounts, user switches,
retention/redaction, changed mappings, remembered rejection, undo/compensation,
fee components, concurrent approval and retries after a lost response. Assert
unchanged ledger totals for attachment/enrichment and exact expected totals for
explicit corrections/merges. API, web and mobile must agree on the chosen account
report and coverage states.

For each phase update OpenAPI/generated types/examples if the boundary changes,
project docs and relevant Q&A; run focused Django tests, migration/schema drift
checks, then affected client typechecks and interaction tests. Test migrations on
synthetic data and a permitted private snapshot; never commit financial dumps.
Deploy additive API fields/migrations before clients. Preserve compatibility with
installed APKs; old pending routes can remain as adapters. Run production repair
inventory in preview mode and review representative proposals before applying any
batch. Do not automatically backfill uncertain historical report choices during a
schema migration. Keep reconciliation/auto-enrichment feature flags independently
reversible and evidence automation off by default.

## First delivery: combined transfer missing reports

The focused first fix now selects agreeing/sole incoming reports for genuinely
missing transfer-account balances, exposes eligibility to web review and requires
an explicit source for differing reports. Known values and protected null choices
are retained; no historical records are automatically rewritten. The primary
report remains attached to the original account even if later-linked evidence
has an earlier event timestamp. Regression fixtures are synthetic.

This delivers the immediate correction, not the read-only production inventory,
persistent clear-intent/knowledge models, shared proposal service, full link-mode
redesign, coverage indicators or historical repair UI. Those remain the following
implementation phases. Existing protected legacy blanks can still be corrected
explicitly in Transactions while revalidation is developed.
