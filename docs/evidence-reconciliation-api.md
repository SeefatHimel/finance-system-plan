# Evidence attachment API

Delivered 2026-10-17 as the backend foundation for phase 2 of the
[evidence reconciliation plan](evidence-reconciliation-plan.md). Deploy migration
`reconciliation.0002_evidenceproposal` before enabling clients. Existing review
routes and installed APKs remain compatible. No historical records are backfilled.
The new web decision/coverage interface is the next phase; existing screens do not
yet consume these proposal endpoints.

## Supported decisions

One posted movement can have multiple canonical SMS/statement observations. The
new boundary attaches a pending SMS, a pending statement component, or one of each
from the **same reporting account** to an explicitly selected ledger entry.
Supported target types: expense, income, fee, refund and owned-account transfer.
A parser's income/expense label does not overwrite an existing transfer's type.
Other types, SMS with a separate fee amount, incompatible currencies/paths,
resolved sources and incomplete searches produce blocked proposals. Resolve
unsupported relationships through their existing dedicated workflows.

Creation, classification corrections, metadata overwrites, duplicate merges,
source reassignment and historical scans are not supported by this boundary.
Existing creation/correction routes remain available. References remain nonunique;
amount/date alone never trigger automatic linking. No learned mapping is saved by
accepting an attachment.

## Preview

Authenticated `POST /api/reconciliation/proposals/`:

```json
{
  "sources": [
    {"kind": "sms", "id": "11111111-1111-4111-8111-111111111111", "component": "principal"},
    {"kind": "statement", "id": "22222222-2222-4222-8222-222222222222", "component": "principal"}
  ],
  "transaction": "33333333-3333-4333-8333-333333333333"
}
```

IDs above are illustrative synthetic values. Use IDs from the authenticated review
responses. A statement fee row uses its own UUID and `component=fee`; SMS supports
only `principal`. Unknown request fields are rejected rather than silently treated
as ledger edits.

HTTP 201 returns an expiring proposal with:

- `id`, `fingerprint`, `expires_at` (15 minutes), `policy_version`;
- `intent=attach|blocked`, sources and the actual target summary;
- up to eight `matches`, independent corroboration, reasons and contradictions
  per source, limits and `blocked_reasons`;
- `required_decisions`, exact decimal-string `balance_choices` and proposed
  missing-balance `field_changes`;
- `coverage_before`/`coverage_after`, separately for each account, and zero ledger
  movement/amount impact.

Omit `transaction` to discover suggestions. That proposal is blocked until a client
selects a target and requests a fresh preview; even one strong match is not selected
automatically. Contradictory retained references/reports require conflict review,
even when another corroborating field agrees. Search is limited to 1,000 same-amount account movements in the
three-day source-observation window. More than eight matching targets or an
incomplete underlying statement search blocks application rather than hiding
ambiguity. A wider calendar gap to the ledger is acceptable only when a retained
same-account source observation itself is within the existing three-day window.
Each observation's reference, date/time and balance is evaluated together.

Preview writes proposal metadata only. It does not post, edit, attach, redact,
learn or resolve sources. Canonical links remain on candidates, statement rows and
transfer evidence; the proposal table is not a second ledger/link authority.

## Apply and retry

Authenticated `POST /api/reconciliation/proposals/{id}/apply/`:

```json
{
  "fingerprint": "COPY_THE_64_CHARACTER_FINGERPRINT_FROM_PREVIEW",
  "idempotency_key": "44444444-4444-4444-8444-444444444444",
  "balance_source": "existing",
  "acknowledge_match": true,
  "acknowledge_conflict": true,
  "acknowledge_issues": true
}
```

Keep the same key, proposal ID, fingerprint and decision body after an uncertain
response. A key is user-scoped and cannot approve another proposal. The server
serializes ledger writers, locks proposal/source/target/account rows, and rechecks
source versions, target/related state, account settings, matching suggestions and
policy fingerprint. Stale/expired decisions return 409; refresh and review a new
proposal rather than automatically retrying approval with new values. Foreign
source/target/proposal IDs return 404; unauthenticated requests return 401. Invalid
or blocked decisions return 400 without partial links. Success and error responses
use `Cache-Control: no-store`.

`balance_source=existing` retains known values, zero, reviewed clears and uncertain
legacy nulls. A genuinely missing transfer-account report can fill from a sole or
exactly agreeing source. Differing incoming values require an explicit eligible
`sms`/`statement` selection and conflict acknowledgment. A statement principal's
fee-inclusive balance cannot be selected for that movement. If it is the only
incoming report for a missing account balance, the proposal is blocked until the
fee is reviewed; attachment must not implicitly make it effective. When no source
reports a balance, attachment does not manufacture a reviewed null selection. Ordinary transaction
nulls retain their current value because clear provenance is not yet explicit.
Source reports are retained even when a different report remains effective.

HTTP 200 returns `intent=attach`, transaction/source IDs, per-account coverage,
effective balance strings, `ledger_movements_added=0`, `unchanged` and `undo_action`.
It never changes amount, account path, type, transaction date/time or primary SMS
ownership. Same-account SMS + PDF coverage does not claim the opposite account
reported. Coverage exposes SMS candidate IDs, statement component IDs, and separate
`legacy_sms`/`manual` flags; ledger endpoints alone do not establish coverage.

A repeated unchanged accepted decision returns its receipt with `unchanged=true`,
without another audit or action. If accepted links/ledger state subsequently change
(including Undo), replay returns 409. Latest-action Undo availability in replayed
receipts is refreshed rather than cached forever.

The existing 24-hour latest unchanged-action Undo can reverse a new attachment:
it returns sources to pending and retains the posted movement. It cannot recover
SMS text already removed under retention. Later edits/links invalidate older Undo.
This is not the future historical compensation workflow. Old combined review keeps
its existing recovery behavior until its client migrates to proposal/apply.

## Privacy and maintenance

Proposals retain structured summaries and hashes, never copied raw SMS text, PDF
bytes or full account/card identifiers. Source originals remain under existing
retention/archive controls. Policy redaction still runs on acceptance. No production
data is used in committed tests or examples.

Expired previews cannot apply, but metadata is retained for receipts. Periodically
run this bounded cleanup from `projects/finance-api` against the intended database:

```bash
.venv/bin/python manage.py purge_evidence_proposals
.venv/bin/python manage.py purge_evidence_proposals --apply --limit 1000
```

The default is dry run; only proposals expired more than 30 days ago are eligible.
`--days` must be at least 30, `--limit` is 1–5000. Repeat pages as needed. Canonical
links/audits/movements are never removed. Idempotency receipts/keys are no longer
available after their proposal metadata is pruned. No cleanup schedule is created
by this change.

## Verification

Use synthetic fixtures and an isolated test database:

```bash
DATABASE_URL= DJANGO_DEBUG=true .venv/bin/python manage.py test \
  apps.reconciliation apps.statements apps.transactions \
  apps.accounts.test_balance_comparison --noinput
DATABASE_URL= DJANGO_DEBUG=true .venv/bin/python manage.py makemigrations --check --dry-run
```

SQLite skips row-lock tests. Run the same suite with `DATABASE_URL` pointing to a
throwaway PostgreSQL instance to verify concurrent identical retries and competing
proposals. Never point these tests at a live finance database.
