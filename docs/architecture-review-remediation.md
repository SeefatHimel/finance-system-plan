# Architecture review remediation

Review update — 10 November 2026: these changes form the base of the bulk-import
review branch. Publication/deployment statements below describe the original
1 November verification. See [bulk cash import](bulk-cash-import.md) for the new
feature's tests, API/database rollout and review scope.

The review fixes are committed locally in focused sections and remain unpushed.
No production data was modified and no deployment was performed. The API remains the owner of money, source evidence
and authorization; web/mobile submit intents and display server results.

## Main findings addressed

| Finding | Correction | Verification |
| --- | --- | --- |
| Planning edits could overwrite concurrent payment totals or schedules | Card/debt/recurring edits acquire the same user-then-parent locks as payments, reload the parent and revalidate before saving | Stale-serializer/payment regressions; full API suite |
| Debt principal corrections left the remaining balance stale | Remaining principal is recomputed from recorded repayments; a principal below repayments or changing debt direction after repayment is rejected | Principal increase/decrease and stale-note tests |
| Transaction type and debit/credit could contradict each other | New entries and explicit type/direction edits must agree; adjustments retain either direction, transfers retain canonical sending/receiving semantics | Creation/edit regressions; existing contradictions are flagged by issue scan |
| Unsupported foreign-exchange transfers and historical currency relabeling | Reject same-amount cross-currency transfers; reject changing currency after ledger, import, snapshot or card-bill use | API validation tests; no inferred conversion or historical rewrite |
| Offline expense retries could duplicate a movement | Every queued manual entry derives a stable key from its persisted queue ID; old transfer keys are preserved | Mobile identity tests and server idempotent-expense regression |
| Transaction pages downloaded all rows | Bounded server pagination, maximum 100, with count and next offset; web requests only its page | Multi-page API and browser checks, URL/filter restoration |
| Pagination could make summaries misleading | SQL totals cover all matching rows, grouped by currency; refunds, financing and own transfers remain explicit | More-than-one-page and receiving-account totals tests |
| Account balances materialized full ledger history | Group monetary sums in SQL and select only latest effective reports; reviewed blanks and timing uncertainty retain their meanings | Existing comparison tests, source-selection parity and 1,000-row materialization regression |
| Database URL silently lost TLS/query settings | Preserve encoded credentials, SSL options, timeout and pooler handling; unsupported/repeated options fail explicitly | Settings regressions |
| Auth limits and refresh coordination were process-local | Database row-locked throttles and signed proxy client identity; encrypted five-second refresh receipts shared across API workers | Independent-connection concurrent quota/refresh tests, replay expiry and logout tests |
| Dependencies had unsupported/vulnerable versions | Django 5.2 LTS, REST Framework 3.18 security patch, Next.js 15.5 patch, Zod 4 adaptation and patched mobile transitives; Python constraints pin the tested set | Production build, Python/npm audits, web/mobile typechecks and tests, native Android tests/build |
| Deployment health and assets were incomplete | Separate DB/schema readiness, include public web assets in production image, compile/test native Android in CI | Readiness tests, Dockerfile/Compose review and Android debug build |

## Compatibility and rollout

1. Install API requirements, which now include `requirements-constraints.txt`.
   Dependency updates must intentionally refresh constraints and rerun checks.
2. Run `python manage.py migrate --noinput` before the new API. The new
   `users.0001_initial` stores hashed throttle keys and encrypted refresh receipts,
   not financial corrections. No data migration rewrites accounts or evidence.
3. Set one private random `FINANCE_PROXY_AUTH_SECRET` of at least 32 characters
   on API and web. Never expose it through a `NEXT_PUBLIC_` setting.
4. On Vercel the web proxy uses `x-vercel-forwarded-for`. Elsewhere configure
   `FINANCE_TRUSTED_CLIENT_IP_HEADER` to a header the ingress **overwrites** and
   restrict access to that ingress. Untrusted `X-Forwarded-For` is ignored by the
   API. Misconfigured production sign-in fails closed.
5. Deploy API before web. `/api/transactions/` keeps its array response but now
   returns at most 100 rows; consumers must use limit/offset plus headers, or
   `/api/transactions/activity/` for count/results. Web uses the latter plus
   `/api/transactions/totals/`. CSV export remains a separate explicit operation.
6. Route readiness checks to `/api/health/ready/`; liveness remains
   `/api/health/`. Readiness returns 503 if DB access fails or migrations remain.
7. Rebuild Android to receive the offline manual-entry retry correction. Existing
   queued IDs preserve their identity across restarts; already-created duplicates
   are not silently deleted or merged.

Ordinary mobile/public refresh tokens remain single-use. Only an authenticated
proxy can reuse the five-second encrypted result. A cached successor is checked
against its blacklist before reuse. Logout serializes with refresh and revokes a
recent successor if the old cookie was concurrently consumed. All-session logout
clears receipts and blacklists outstanding sessions. This is not full token-family
revocation after arbitrary generations of rotation.

## Review scope and remaining work

Verification uses an isolated PostgreSQL database containing synthetic fixtures,
not an authenticated production session. Functional checks do not establish
production latency or host/proxy correctness. Observe query timings, migration
duration and authentication behavior in staging before release. PostgreSQL 18
was available locally; CI also exercises PostgreSQL 16. Python tests ran on 3.12
locally; CI/production retain the repository's 3.13 target.

The current mobile audit retains nine low-severity findings through Expo's
`deepmerge` tooling dependency. There are no high/critical findings in the mobile
production dependency audit; the web production dependency audit is clean. Do not
apply npm's breaking Expo downgrade merely to silence this warning. Reassess when
a compatible patched dependency/SDK is available.

The final Python installed-dependency audit reports no known vulnerabilities,
including the patched installer and pytest versions. CI now audits Python as well
as web/mobile packages. The installer baseline is in `requirements-tooling.txt`;
development requirements and production images both install it.

Large review/workspace modules still merit gradual extraction by domain. This
change isolates balance queries, totals, auth signatures and queue identity, but
does not rewrite the whole UI. The backend schema snapshot gate detects generated
shape changes; the manually curated published contract is not a complete formal
proof of runtime response equivalence. New totals are explicitly typed in both,
and generated TypeScript is checked. Deployment restore drills, real load tests,
proxy configuration and live multi-host cookie ordering remain operational work.

## Browser QA

Flow: Transactions → page forward → reload → open/cancel editor → correct an
out-of-range page → change page size. January contains 143 synthetic expenses of
1.25 each; the full-filter spending total must stay 178.75 on every page.

Environment: local web `http://127.0.0.1:3039`, API `http://127.0.0.1:8039`,
fresh headless Chrome context, desktop 1440×1000 and mobile 390×844. Browser plugin
not available, so the frontend testing workflow uses regular Playwright. No live
account is accessed. Checks cover page identity, meaningful content, no framework
error overlay, console health, desktop/mobile screenshots and interaction results.
Temporary logs/screenshots stay outside the repository.

Initial verification: 836 API tests, 209 web tests and 115 mobile JavaScript tests
pass. Web lint/type checks and production build, mobile type checks, native SMS
unit tests and Android debug assembly pass. Migration drift, OpenAPI validation,
the backend snapshot and generated TypeScript checks pass. The schema upgrade's
enum renamings were inspected after resolving references; no unplanned response
shape changes were accepted. Browser identity/content/overlay/console checks and
all interactions above pass, with no application console errors.

## Second review — 31 October 2026

The second pass reviewed query plans/counts, selected columns, page reloads,
HTTP caching, upstream cancellation and stale frontend responses. It found and
corrected additional issues:

- Account detail reads summarized every account, and list context fetched account
  rows twice. Serializer context now uses only the actual selected instances.
- Same-day report timing checks ran per account. They now return only distinct
  account IDs through two batched SQL queries, preserving timing uncertainty.
- Transaction counts joined/grouped statement history before pagination. A scalar
  correlated count uses the indexed transaction relation only for returned rows;
  the overall count and totals query no longer carry that aggregation join.
- Overview coverage materialized every saved import/check to pick the newest.
  Window queries now return one latest row per account, and account identities
  are fetched together. Statement history and original sources are unchanged.
- Reporting and balance-source queries fetched unused account logos and entry
  notes. Period summaries now select only the required fields; row/source reads
  defer logos that are already supplied by the account lookup response.
- Quick-add dispatched a targeted financial update and refreshed the Next route.
  It now uses the existing event listeners; filters, page and open workspaces stay
  in place without an extra server-component request.
- Timeline account loads lacked cancellation and could overwrite a later refresh.
  They now abort on replacement/unmount and cannot commit after cancellation.
- The authenticated proxy dropped legacy pagination/Retry-After headers and did
  not pass cancellation upstream. It now retains those headers, carries the
  client signal, and bounds upstream reads to 30 seconds and writes to 120 seconds.
  Canceling fetch stops waiting/reading; it does not guarantee rollback or cancel
  an already-running WSGI database transaction. Uncertain writes still need their
  existing retry identity or explicit verification.
- API responses without an explicit no-store policy could be cached. Middleware
  now defaults every API response, including errors/token responses, to private,
  no-store while preserving existing no-store headers. The web proxy independently
  enforces private no-store. In-memory, session-owned query state remains usable.
- The dashboard awaited an unbounded health fetch before showing its content.
  It now streams a standard loading state and caps that health check at 5 seconds.

Measured with 20 synthetic accounts and 1,000 transfers/2,000 observations on
local PostgreSQL, with warm query plans:

| Operation | Before | After |
| --- | ---: | ---: |
| Balance summaries | 25 queries | 7 queries |
| Accounts list | 27 queries | 8 queries |
| One account detail | 27 queries across all accounts | 8 queries scoped to that account |
| Transaction page | 6 queries, about 43 ms | 6 queries, about 27 ms |
| Full filtered totals | 1 query | 1 query |

Timings are diagnostic samples, not production guarantees. EXPLAIN ANALYZE was
inspected on synthetic data; no speculative index or financial schema migration
was introduced. Regression tests compare one versus twenty accounts to prevent
timing-query growth, ensure only the latest of 60 imports/checks is returned,
and verify report columns exclude unused large/private fields.

Second-pass verification: **842 API tests, 211 web tests and 115 mobile tests
pass**, as do web/mobile type checks, web lint/build, migration drift, OpenAPI
validation, backend snapshot and generated TypeScript checks. No mobile/native
code changed in this pass; the earlier native tests/debug build remain applicable.
The existing 84 schema warnings concern enum names/operation IDs; there are zero
schema errors and no contract drift. The previously documented low Expo warnings
and staging/load/proxy checks remain outstanding.

Browser QA used the same isolated local URLs and fresh headless Chrome context.
Browser plugin unavailable; regular Playwright fallback. It saved a synthetic
quick entry while on January page 2, verified the same page/filter after save and
reload, and observed **zero route refreshes** after the save. It also delayed an
old account response across a timeline refresh and verified it could not replace
the newer account data. Desktop 1440×1000 and mobile 390×844 screenshots were
inspected; page identity, meaningful content, console/overlay checks and
interactions passed with no application errors. No production account or data was
accessed. All work is committed locally and remains unpushed.

## Quality program — 1 November 2026

The next implementation adds staged database write checks, a count-only integrity
audit/explicit validation, shared monetary type policy, SQL report aggregates,
online ordered partial balance indexes, a session-owned transaction loader and
private request diagnostics. It also fixes row-menu focus/scroll dismissal and
theme contrast, and adds repeatable browser/accessibility and backup/restore CI.

The full backend suite now passes 851 tests; 215 web and 115 mobile unit tests
pass, plus eight browser and four backup safety tests. A synthetic full-table
restore matched 46 tables/502 rows, including encrypted source bytes. Fresh
SQLite migrations retain development compatibility. The earlier one-query report
implementation is superseded by six bounded SQL aggregation queries (per period),
which materialize groups instead of complete transaction objects. Latest report
selection now uses ordered per-account subqueries, preserving existing semantics.

See [the quality program](quality-improvement-program.md) for reproducible commands,
all scale/concurrency measurements, rollout and remaining gates. Million-row
single-reader account/report p95 improved from about 4.97/6.22 s to 0.62/1.53 s;
25 concurrent annual reports remain slow. Production load, ingress, key recovery,
alerts and encrypted off-machine backups are not claimed complete. All changes
are committed locally and remain unpushed.

## Follow-up concurrency review

Two additional races were reproduced with independent PostgreSQL connections:
separate balance/report aggregations could mix committed snapshots, and an
expired auth window could disappear between lookup and row locking. Balance
contributions now use one UNION ALL statement; all report sections plus current
and previous comparison periods likewise share one statement. Financial JSON
projection values are text/Decimal rather than floats. Login windows are locked
inside get_or_create, retaining safe recreation if cleanup wins first. This
supersedes the six-query-per-period layout described above; no API schema or new
migration is introduced. See the quality program for the new regressions and
final verification results. Changes remain local and unpushed.

Final follow-up checks: 859 API tests pass; fresh OpenAPI snapshot and migration
drift checks pass. A three-sample synthetic million-row recheck returned no errors
and approximately 555/787 ms account/annual-report p95. This is a local smoke check,
not new evidence for concurrent production capacity. Second review found no
additional blockers in the race fixes; remaining deployment gates still apply.
