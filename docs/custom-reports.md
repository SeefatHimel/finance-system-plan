# Custom reports and account statements

The report library, saved detail view, and Create/Edit builders remain separate.
The library searches names/currencies, filters by currency, restores search/sort
on return, and offers Account statement, Account overview, Spending review, and
Income review templates. Templates are editable starting points, not saved data.

## Analysis

Analysis uses the saved selection rules and manual transaction membership. Visible
scope chips explain includes/excludes. Daily/monthly activity can display income
and net spending or account cash flow. Category/merchant breakdowns support chart
and table views, comparisons, and transaction drill-through. Charts use the API's
existing aggregates; they do not download the ledger to recompute totals.

Refunds reduce spending. Categories with negative net spending appear separately
as net refunds. Percentage shares use positive net spending as their denominator;
they do not divide by a total reduced by refunds. Change percentages are omitted
for non-positive baselines or when the current value is negative. Decimal strings
are summed in integer cents; conversion to numbers is limited to chart rendering.

The editor offers fixed-date shortcuts, removable selection chips, amount-bound
validation and draft recovery. Shortcuts resolve to fixed dates when selected;
they are not rolling date policies. Analysis comparisons use the preceding period
without manual report additions/removals, as before.

## Account statements

Select **Account statements** on any saved report, or create one from its template.
`report_view` stores the default view; the current view and selected account remain
in the detail URL. Statements use the report's inclusive dates, currency and
included/excluded accounts. They use **all recorded account movements** in that
range. Analysis-only category/type/source/direction/search/amount filters and
manual report membership do not change statement balances.

Each account shows opening, money in, money out and closing. Opening is immediately
before the first date; closing includes the final date. Account detail lists
transactions oldest first with money in/out and running balances. Transfers debit
the sender and credit the recipient. Financing and adjustments use the canonical
ledger policy. Opening + money in − money out = closing.

### Starting-balance choices

Opening settings are stored per account on the saved report, never on the account
or transaction ledger:

- **Ledger:** account starting balance plus recorded movements before the range.
- **Last reported:** the latest eligible report strictly before the range, carried
  forward by recorded movements after that report up to the opening date. The
  original report amount/date and derived opening are disclosed.
- **Manual:** an editable signed amount, including negative values and zero.

The last-reported option reuses the existing owner/account-bound balance evidence
and timing checks. Future reports are never opening anchors. Ambiguous timing,
reports preceding their movement, unavailable reports, and card reference figures
do not receive guessed openings. If a saved reported basis becomes unavailable,
opening/running/closing are null until the user chooses a valid basis; ledger
references and movement totals remain available. Card reports can describe debt
or available credit, so users must confirm a signed opening manually.

Ledger opening/closing remain visible beside report-based balances. Choosing a
manual/report-based opening does not reconcile or repair account history. Changing
the range recomputes ledger/reported openings; manual amounts remain explicit
saved choices and should be reviewed for the new range.

Unknown transaction times are listed last within their day, with stable creation
and UUID tie-breakers. Intermediate running balances follow this display order;
they are not claims about an unknown historical sequence. Closing is order-independent.

### API, pagination and export

`GET /api/reports/saved/{id}/account-statements/` is owner-scoped and privately
uncached. Optional `account`, `offset` and `limit` select a page; limit defaults to
25 and is capped at 100. It returns summaries for selected accounts and one
account's transactions. SQL windows compute running balances before pagination.
History is aggregated in SQL; only the requested transaction page is materialized.

`export=csv&account={id}` exports the complete selected-account statement, including
its opening basis and closing balance. Exports are capped at 50,000 transactions;
narrow the range above that limit. Descriptive spreadsheet cells are escaped to
keep formulas inert. PostgreSQL statement reads use a repeatable-read, read-only
transaction so opening, movements, closing and paginated rows share a snapshot.

PATCH the saved report's `opening_balances` map to save a starting-balance choice.
Entries contain `mode: ledger|reported|manual` and, only for manual, `amount`.
Account IDs must belong to the owner and use the report currency. At most 100
account-specific choices are accepted. The API contract and generated client
include the new fields and JSON/CSV response variants.

## Research and design decisions

[YNAB's spending breakdown](https://support.ynab.com/en_us/spending-breakdown-H1H7YxmD0)
documents ranked categories, account/category/date filtering, transaction
drill-through and separate positive-inflow categories. [Actual Budget's custom
reports](https://actualbudget.org/docs/reports/custom-reports/) documents chart/table
views, saved filters, grouping and explicit live/static date behavior. This
implementation applies those patterns to the existing Finance visual system.
The account-statement/opening-balance workflow follows this product's canonical
ledger and balance-evidence semantics; it is not copied accounting behavior from
either reference product.

## Deployment and verification

Deploy the API and apply `reports.0003_account_statement_settings` before the web
client. The migration adds report metadata only and does not alter ledger data.

Checks: `python manage.py test apps.reports`,
`node --test tests/report-navigation.test.cjs tests/report-presentation.test.cjs`,
web typecheck/lint/build, generated-contract typecheck and schema drift checks.
`e2e/custom-reports.spec.ts` covers library/create/edit/duplicate, discard,
chart/table controls, validation, and report-only opening changes on desktop and
mobile against disposable synthetic fixtures. Never run fixtures against real
financial data.
