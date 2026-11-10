const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-report-navigation-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/report-navigation.ts', 'lib/custom-report-library.ts'], { cwd: resolve(__dirname, '..') });
const { reportFilterQuery, reportFiltersFromQuery, reportReturnPath, reportFiltersKey, customReportFiltersKey, customReportPath, customReportEditPath, isCustomReportPathname, reportDraftKey } = require(join(output, 'report-navigation.js'));
const { filterReportLibrary, reportListQuery, reportListState, reportScopeSummary } = require(join(output, 'custom-report-library.js'));
const { emptyReportRules, canonicalReportRules, setReportRuleChoice, reportRulesEqual, savedReportRules } = require(join(output, 'report-rules.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('report filters survive navigation with the selected date mode and saved report', () => {
  for (const period of [
    { mode: 'monthly', start: '2024-02-01', end: '2024-02-29' },
    { mode: 'daily', start: '2026-10-03', end: '2026-10-03' },
    { mode: 'custom', start: '2026-09-14', end: '2026-10-12' },
    { mode: 'custom', start: '2026-09-14', end: '2026-09-14' },
  ]) {
    const filters = { period, account: 'synthetic-account', currency: 'USD', savedReport: 'synthetic-report' };
    assert.deepEqual(reportFiltersFromQuery(reportFilterQuery(filters)), filters);
  }
});

test('legacy month links restore and invalid ranges recover to a valid current month', () => {
  assert.deepEqual(reportFiltersFromQuery('?month=2026-10').period, { mode: 'monthly', start: '2026-10-01', end: '2026-10-31' });
  assert.equal(reportFiltersFromQuery('?start_date=bad&end_date=2026-01-01').period.mode, 'monthly');
  assert.equal(reportFiltersFromQuery('?start_date=2026-10-01&end_date=2026-10-15&date_view=monthly').period.mode, 'custom');
});

test('report return links support both pages while rejecting redirects outside reports', () => {
  for (const path of ['/reports?month=2026-10', '/custom-reports?saved_report=synthetic-report', '/custom-reports#report-transactions']) {
    assert.equal(reportReturnPath(path), path);
  }
  for (const path of [null, '', '//example.invalid/reports', '/\\example.invalid', '/transactions', '/reports/../login', 'https://example.invalid/custom-reports', '/custom-reports-other']) {
    assert.equal(reportReturnPath(path), null);
  }
  assert.notEqual(reportFiltersKey, customReportFiltersKey);
});

test('multi-account/category rules, exclusions and amounts survive navigation', () => {
  const rules = { ...emptyReportRules(), accounts: ['account-b', 'account-a'], excluded_accounts: ['account-c'], categories: ['category-b', 'category-a'], excluded_categories: ['uncategorized'], types: ['fee','expense'], sources: ['web','sms'], directions: ['debit'], search: 'Synthetic project', min_amount: '10.5', max_amount: '100' };
  const filters = { period: { mode: 'monthly', start: '2026-10-01', end: '2026-10-31' }, account: '', currency: 'BDT', savedReport: 'synthetic', rules };
  assert.deepEqual(reportFiltersFromQuery(reportFilterQuery(filters)), {...filters, rules: canonicalReportRules(rules)});
  assert(reportRulesEqual(rules, {...rules, accounts:['account-a','account-b'], min_amount:'10.50', max_amount:'100.00'}));
  assert(!reportRulesEqual(rules, {...rules, excluded_categories:[]}));
});

test('include/exclude switches are mutually exclusive and legacy reports keep their account', () => {
  const include = setReportRuleChoice(emptyReportRules(), 'categories', 'synthetic-food', 'include');
  const exclude = setReportRuleChoice(include, 'categories', 'synthetic-food', 'exclude');
  assert.deepEqual(exclude.categories, []);
  assert.deepEqual(exclude.excluded_categories, ['synthetic-food']);
  assert(reportRulesEqual(setReportRuleChoice(exclude, 'categories', 'synthetic-food', 'any'), emptyReportRules()));
  assert.deepEqual(savedReportRules({account:'legacy-account', filters:{}}).accounts, ['legacy-account']);
  assert.deepEqual(savedReportRules({account:null, filters:{accounts:['a','b']}}).accounts, ['a','b']);
});

test('details and editing have stable return paths and separate local drafts', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const path of ['/custom-reports/new', customReportPath(id), customReportEditPath(id)]) {
    assert(isCustomReportPathname(path));
    assert.equal(reportReturnPath(path), path);
  }
  for (const path of ['/custom-reports/unknown', '/custom-reports/new/edit', '/custom-reports/111/edit', '/custom-reports/newer']) assert(!isCustomReportPathname(path));
  assert.notEqual(reportDraftKey(), reportDraftKey(id));
  assert.notEqual(reportDraftKey(id), reportDraftKey('another-report'));
});

test('report library search and sort restore without mutating saved definitions', () => {
  const reports = [
    {id:'a',name:'Travel',currency:'BDT',start_date:'2026-10-01',end_date:'2026-10-31',updated_at:'2026-11-01'},
    {id:'b',name:'Household',currency:'BDT',start_date:'2026-09-01',end_date:'2026-09-30',updated_at:'2026-11-02'},
    {id:'c',name:'USD spending',currency:'USD',start_date:'2026-11-01',end_date:'2026-11-30',updated_at:'2026-11-03'},
  ];
  assert.deepEqual(filterReportLibrary(reports,'bdt','name').map(row=>row.id),['b','a']);
  assert.deepEqual(filterReportLibrary(reports,'','updated').map(row=>row.id),['c','b','a']);
  assert.deepEqual(filterReportLibrary(reports,'','period').map(row=>row.id),['c','a','b']);
  assert.deepEqual(filterReportLibrary(reports,'unknown','name'),[]);
  assert.deepEqual(reports.map(row=>row.id),['a','b','c']);
  assert.deepEqual(reportListState(reportListQuery('Household','name')),{search:'Household',sort:'name'});
  assert.equal(reportListState('?sort=invalid').sort,'updated');
  assert.equal(reportScopeSummary({account:'legacy',filters:{excluded_categories:['uncategorized']}}),'1 account · All categories · 1 exclusion');
});
