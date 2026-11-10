# Quality improvement program

Review update — 10 November 2026: these changes form the base of the bulk-import
review branch. Publication/deployment statements below describe the original
1 November verification. See [bulk cash import](bulk-cash-import.md) for the new
feature's tests, API/database rollout and review scope.

Implemented and committed locally on 1 November 2026 in focused review sections.
These changes have not been pushed or deployed.
Production data, hosting settings and live financial sources were not changed.
This is a measured improvement program, not certification of a perfect score.

## Delivery gates

| Area | Implemented and checked locally | Remaining operational gate |
| --- | --- | --- |
| Financial correctness | Shared type/direction policy, database write checks, count-only integrity audit; retry/concurrency and PDF → SMS pairing → correction → Undo regressions | Review historical exceptions before validating staged checks |
| Data handling | Original extraction, encrypted PDF and SMS preservation through correction/Undo; owner isolation; private API caches and safe diagnostics | Verify deployed encryption keys, retention, ingress/access boundaries and recovery permissions |
| Architecture | Separate pure money policy, SQL report projections, account balance queries and session-owned transaction loader | Continue extracting large review/workspace modules incrementally |
| Database/query efficiency | Ordered partial balance indexes, online PostgreSQL index creation, SQL report aggregation; 10k/100k/1m synthetic benchmarks at 1/10/25 concurrent readers | Repeat on staging; large concurrent aggregate reports still need capacity work |
| Frontend/UX | Preserve filters/pages and stale-response protection; stable row action menus; theme-aware debit/totals contrast; keyboard and automated accessibility tests | Observe actual workflows; automated checks do not replace manual assistive-technology testing |
| Testing/contracts | API/web/mobile tests, production web build, browser CI, query/materialization budgets and contract drift checks | Run the updated workflow in hosted CI and smoke-test the release |
| Security/observability | Patched dependencies, multi-worker auth guards, no-store, generated request IDs, route-pattern/status/duration logs with no input values | Configure alerts, log retention, secret rotation and live multi-instance session checks |
| Operations | Private atomic backup publication, checksum verification, guarded atomic restore, backup safety tests and disposable full-table restore drill | Schedule encrypted off-machine backups, failure alerts and recurring restore drills |

## Financial and source integrity

`apps.transactions.policy` owns shared type sets/default directions; the models,
SQL balances and reports use it. New API writes reject nonpositive amounts,
contradictory explicit type/direction, same-account paths, unsupported currency
conversions and historical currency relabeling. Database checks additionally
reject nonpositive amounts and identical endpoints even outside API serializers.

`transactions.0011_ledger_guardrails` adds PostgreSQL checks as `NOT VALID`:
new writes are checked immediately; existing rows are neither rewritten nor
scanned during installation. Updating an invalid historical row also requires
correcting its invalid value. Other databases use normal checks. A migration
regression starts with invalid historical rows and verifies preservation plus
rejection of new invalid writes. No category or parser rule automatically repairs
historical financial values.

Run the read-only audit from `projects/finance-api`:

```bash
python manage.py audit_financial_integrity --fail-on-issues
```

Output contains counts for monetary/path/type/direction, ownership and source
ownership issues plus staged constraint status. It contains no original text,
amounts or account/transaction identifiers. Counts may overlap; they are issue
counts, not unique affected movements. This is not a full semantic reconciliation
or proof that every imported source matches. `--user-id` scopes an investigation;
constraint validation always covers the whole table, so review a global audit.

After resolving/reviewing historical exceptions, the operator can explicitly run:

```bash
python manage.py validate_financial_constraints --reviewed
```

Validation has a five-second lock deadline and thirty-second statement deadline.
A failure rolls back validation and does not change financial values. It is not
run automatically at application startup or by the browser.

## Query and architecture changes

- Reports aggregate totals/categories/merchants/accounts/days in SQL instead of
  instantiating every ledger entry. Decimal amounts, refund/financing distinctions,
  account perspectives and the `spending-v2` response remain intact. Account groups
  have deterministic name/ID order. Merchant spelling follows its latest entry.
- Latest balances use per-account ordered lookups while retaining effective report,
  reviewed-blank, source compatibility and delayed-posting rules. Partial indexes
  contain only reported balances. PostgreSQL creates them concurrently through
  `transactions.0012`; SQLite has an ordered-column development fallback.
- Interrupted PostgreSQL concurrent index builds can leave an invalid index.
  Inspect `pg_index.indisvalid` for the two named indexes before retrying; remove
  only a confirmed invalid build with the operator's normal migration procedure.
- Transaction page loading is separated from presentation. Page/totals/lookups
  start independently, unchanged lookups are reused within the session, invalid
  pages are corrected, embedded editors skip list reads, and callers retain abort
  and latest-request ownership. No global financial payload cache is introduced.
- Row action menus follow their trigger during focus/table scrolling and close
  when the trigger leaves the viewport. Light-theme amounts and totals now use
  theme tokens with accessible contrast.

## Measured performance

[Machine-readable results](benchmarks/2026-11-01-synthetic.json) contain all 36
endpoint/scale/concurrency cases, with no financial source records. These are
small local smoke samples: 25 requests per case, one synthetic owner, 12 accounts,
50 merchants, PostgreSQL 18.6, Python 3.12.14, macOS ARM64. They use Django
APIClient with independent DB connections in one application process; ingress,
network and real authentication costs are excluded. CI uses PostgreSQL 16 and the
repository's Python 3.13 target. Analyze seeded account/ledger/evidence tables so
planner statistics reflect their actual cardinality.

Local single-reader p95 (milliseconds):

| Ledger rows | Activity page | Whole-filter totals | Accounts/balances | Annual report |
| --- | ---: | ---: | ---: | ---: |
| 10,000 | 32 | 18 | 97 | 51 |
| 100,000 | 40 | 32 | 105 | 178 |
| 1,000,000 | 64 | 218 | 618 | 1,526 |

At one million rows the initial single-reader account/report p95 was approximately
4,969/6,217 ms. Ordered lookups and accurate account statistics reduced it to
618/1,526 ms. All 900 read requests across scales returned 200. At 25 concurrent
million-row reads, p95 was 418 ms for pages, 1,763 ms for totals, 4,339 ms for
accounts and 15,350 ms for annual reports. Those aggregate paths are **not** at the
interactive latency target under that load. Next capacity work should measure
staging query plans and high-cardinality/multi-tenant distributions, then choose
bounded report groups, asynchronous exports/reports or a transactionally maintained
aggregate projection. Do not hide these results by raising budgets or caching
unversioned financial results. Monthly UI reads are narrower than this annual
stress case, but that is not a capacity guarantee.

Repeat only against an empty disposable database named `finance_benchmark_*`:

```bash
python manage.py migrate --noinput
python manage.py benchmark_finance --rows 100000 --concurrency 1,10,25 --requests 25 --output /tmp/finance-benchmark.json
```

The generator refuses other database names and unrelated users, never accesses
production, and refuses shrinking an existing dataset. Use a fresh database for
each smaller scale. Plans/timings during development contained synthetic data
only. Stable query-count and zero-history-materialization assertions run in CI;
wall-clock service-level objectives require controlled staging hardware.

## Diagnostics and recovery

API responses carry generated `X-Request-ID` and `Server-Timing`; the web proxy
forwards both. `FINANCE_API_REQUEST_LOGS` defaults on outside debug. The dedicated
logger emits only generated request ID, method, resolver route pattern, status
and duration. It excludes URLs/query strings, identifiers, IPs, headers, bodies
and financial values. Gunicorn's access format omits raw paths/query strings.
Configure the hosting log sink to alert on sustained 5xx, readiness failures,
latency regressions and backup failures; no external alert service was changed.

Backups publish only complete private files (0600), fail on overwrite, include
SHA-256 and retain older `cksum` manifest compatibility. Restore requires explicit
confirmation and a verified sidecar, then uses a single transaction with
exit-on-error. The dump itself is **not encrypted** by this script: it includes
financial data and must live on encrypted, access-controlled storage. A checksum
is corruption detection, not authentication. Retain encryption secrets/fallback
keys separately; the dump alone cannot decrypt source archives.

The local restore drill compared all 46 tables and 502 synthetic rows, including
encrypted SMS and original PDF archive bytes, in about three seconds. It restored
to a new `finance_restore_*` database and removed only that target afterward.
Matching ciphertext is not proof of deployed application/key recovery. Run the
full application/decryption smoke test on staging as well. See
[backup operations](backup-automation.md) for repeatable commands.

## Verification and release status

- 859 backend tests pass on PostgreSQL, including the follow-up concurrency regressions; migration drift check passes.
- 215 web unit tests, typecheck/lint and production build pass.
- Eight browser tests pass at desktop/mobile widths. Both themes pass the tested
  transaction workspace and quick-entry WCAG A/AA axe checks; focus, Escape,
  pagination/filter retention, zero duplicate route refresh and stale responses
  are covered. This is not an accessibility certification of every screen.
- 115 mobile JavaScript tests and typecheck pass. Native Android verification
  from the preceding review remains recorded separately; no new native changes.
- Four backup safety tests and a full-table synthetic restore drill pass.
- Fresh SQLite migration and 45 focused checks pass (six PostgreSQL-specific
  cases skipped); production still requires PostgreSQL.
- Browser/backup/restore checks are added to CI; hosted CI has not run these local
  commits. The OpenAPI snapshot matches, with zero errors and the 84
  existing enum/operation-ID warnings. Fresh Python and web production dependency
  audits report zero known advisories; the prior review's low Expo tooling
  warnings remain documented separately.
- Final report-module/migration review: 27 focused regressions pass. Read-only
  comparison against the previous report implementation matches all 13 synthetic
  account perspectives. New Python files pass undefined/unused-name checks;
  workflow YAML/JSON and shell syntax checks pass. Desktop/mobile screenshots
  were inspected using synthetic data only.

Release remains gated by historical audit review, staging capacity/proxy/key
checks, a successful hosted CI run and the deployment smoke test. Changes are
committed locally; nothing was pushed, deployed or automatically repaired in the
user's database.

## Follow-up: concurrent read and login-cleanup fixes

The review reproduced two races using committed writes from independent
PostgreSQL connections. A transfer inserted between the sending/receiving SUMs
could appear only on its receiving side; report totals and detail groups could
also observe different commits. Expired authentication-window cleanup could
remove a record between an unlocked lookup and its locking read.

Balance sums now use one `UNION ALL` statement, retaining both sending and
receiving contributions. Reports assemble their totals, categories, merchants,
account groups and daily groups from one statement; current and preceding
comparison periods are batched into that same statement. Values cross the JSON
projection as decimal strings and remain Decimal in Python. This protects the
aggregation even inside an existing READ COMMITTED transaction, without
serializing financial writers or changing the connection's isolation level.
It does not claim that every independent API call/page load shares one snapshot.

The throttle acquires its row lock during `get_or_create`: if cleanup deletes an
expired row first, it safely creates a replacement; if login locks first, cleanup
waits and rechecks the renewed expiry. Tests cover both orderings, committed
concurrent transfer insertion, report insertion, moves across comparison periods,
equal-value contributions, empty periods and large exact PostgreSQL amounts.
No migration, endpoint or financial payload schema changes are needed for these
fixes. The earlier 900-read benchmark remains a historical baseline from before
this follow-up; its timing numbers must not be relabeled as measurements of the
new statement layout.

Follow-up verification: all **859 backend tests pass**, including the new
committed-write and cleanup-ordering cases. Forty-five focused SQLite checks pass
with six PostgreSQL/concurrency/exact-decimal cases skipped. Report parity still
matches all 13 synthetic account perspectives. Migration drift and the fresh
OpenAPI snapshot check pass (zero schema errors; the same 84 known warnings).
The second review found no additional blockers in these fixes.

A [three-sample million-row smoke recheck](benchmarks/2026-11-01-read-consistency-followup.json)
returned no errors, with local single-reader p95 around 555 ms for accounts and
787 ms for the annual report. This confirms no obvious single-reader regression;
it does not replace the earlier concurrent-load baseline or the staging capacity
gate. Financial source values remain unchanged. Work is committed locally and
remains unpushed.

## Commit organization

The local changes are split into seven review sections, in dependency order:

1. Ledger invariants, planning-write locks, integrity commands and source tests.
2. SQL read projections, snapshot consistency, bounded pages and API contracts.
3. Shared authentication, private requests, diagnostics and runtime upgrades.
4. Mobile queue retry identities and patched dependencies.
5. Web data loading, context retention and interaction/accessibility fixes.
6. Synthetic CI, benchmark fixtures, backup/restore checks and deployment docs.
7. Architecture/Q&A, verification evidence and remaining release gates.

Each implementation section includes related regression checks. Shared rollout
and cross-project decisions are collected in this document and the remediation
record. Commit messages describe the purpose and scope; these local commits do
not imply a successful hosted CI run or authorize deployment.
