const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-transaction-list-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/transaction-list.ts'], { cwd: resolve(__dirname, '..') });
const { transactionPage, transactionPageParams, transactionColumnPreferences } = require(join(output, 'transaction-list.js'));
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
