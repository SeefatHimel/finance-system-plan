const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-transaction-list-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/transaction-list.ts'], { cwd: resolve(__dirname, '..') });
const { transactionPage, transactionPageParams, transactionColumnPreferences, transactionPeriodFilters, transactionPeriodCaption } = require(join(output, 'transaction-list.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('pagination keeps every filtered record reachable, including the final partial page', () => {
  const records = Array.from({length: 142}, (_, index) => index);
  const visited = [];
  for (let page = 1; page <= 6; page++) {
    const result = transactionPage(records.length, page, 25);
    visited.push(...records.slice(result.start, result.end));
    assert.equal(result.pages, 6);
  }
  assert.deepEqual(visited, records);
  assert.equal(transactionPage(142, 6, 25).end, 142);
});
test('deletions, new filters, empty results and bad URLs cannot strand the table on an empty page', () => {
  assert.deepEqual(transactionPage(2, 6, 25), {current: 1, pages: 1, start: 0, end: 2});
  assert.deepEqual(transactionPage(0, 3, 25), {current: 1, pages: 1, start: 0, end: 0});
  for (const value of ['-3', 'Infinity', 'abc', '1.5', '99999999999999999']) {
    assert.deepEqual(transactionPageParams(new URLSearchParams(`page=${value}&page_size=999`)), {page: 1, pageSize: 25});
  }
  assert.deepEqual(transactionPageParams(new URLSearchParams('page=3&page_size=50')), {page: 3, pageSize: 50});
});
test('existing column choices migrate time to combined date and time, discard unknowns and deduplicate', () => {
  const allowed = ['date', 'description', 'account', 'amount'];
  assert.deepEqual(transactionColumnPreferences(['time', 'date', 'amount', 'removed', 'amount'], allowed), ['date', 'amount']);
  assert.deepEqual(transactionColumnPreferences(['time'], allowed), ['date']);
  assert.deepEqual(transactionColumnPreferences({date: true}, allowed), []);
});

test('date modes replace incompatible date filters instead of carrying stale month or range values', () => {
  assert.deepEqual(transactionPeriodFilters({mode:'all',start:'',end:''}), {month:'',start_date:'',end_date:''});
  assert.deepEqual(transactionPeriodFilters({mode:'monthly',start:'2026-10-01',end:'2026-10-31'}), {month:'2026-10',start_date:'',end_date:''});
  assert.deepEqual(transactionPeriodFilters({mode:'daily',start:'2026-10-27',end:'2026-10-27'}), {month:'',start_date:'2026-10-27',end_date:'2026-10-27'});
  assert.deepEqual(transactionPeriodFilters({mode:'custom',start:'2026-09-28',end:'2026-10-27'}), {month:'',start_date:'2026-09-28',end_date:'2026-10-27'});
});
test('compact date captions distinguish months, days and ranges without timezone date shifts', () => {
  assert.equal(transactionPeriodCaption({mode:'all',start:'',end:''}), 'All dates');
  assert.equal(transactionPeriodCaption({mode:'monthly',start:'2026-10-01',end:'2026-10-31'}), 'October 2026');
  assert.equal(transactionPeriodCaption({mode:'daily',start:'2026-10-27',end:'2026-10-27'}), '27 Oct 2026');
  assert.equal(transactionPeriodCaption({mode:'custom',start:'2026-09-28',end:'2026-10-27'}), '28 Sept – 27 Oct');
  assert.equal(transactionPeriodCaption({mode:'custom',start:'2026-12-28',end:'2027-01-05'}), '28 Dec 2026 – 5 Jan 2027');
});
