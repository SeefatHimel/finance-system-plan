const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-bulk-revalidation-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/bulk-revalidation.ts'], { cwd: resolve(__dirname, '..') });
const { selectedCorrections, correctionGroups } = require(join(output, 'bulk-revalidation.js'));
after(() => rmSync(output, { recursive: true, force: true }));
const entry = id => ({ preview: { transaction: id, token: `preview-${id}`, suggestions: [{ key: 'amount' }, { key: `balance:${id}` }] } });

test('nothing is approved by default; only explicitly offered fields go into requests', () => {
  const entries = [entry('A'), entry('B')];
  assert.deepEqual(selectedCorrections(entries, {}, new Set()), []);
  assert.deepEqual(selectedCorrections(entries, { A: ['amount', 'amount', 'account', 'balance:A'], B: ['amount'] }, new Set(['B'])), [
    { transaction: 'A', token: 'preview-A', selected: ['amount', 'balance:A'] },
  ]);
  assert.deepEqual(selectedCorrections(entries, { absent: ['amount'] }, new Set()), []);
});

test('selected entries on different result pages retain their own preview token and fields', () => {
  const entries = Array.from({ length: 45 }, (_, id) => entry(String(id)));
  const result = selectedCorrections(entries, { 0: ['amount'], 22: ['balance:22'], 44: ['amount'] }, new Set());
  assert.deepEqual(result.map(item => [item.transaction, item.token, item.selected]), [
    ['0', 'preview-0', ['amount']], ['22', 'preview-22', ['balance:22']], ['44', 'preview-44', ['amount']],
  ]);
});

test('large selections are split into bounded groups without dropping or duplicating entries', () => {
  const items = selectedCorrections(Array.from({ length: 63 }, (_, id) => entry(String(id))), Object.fromEntries(Array.from({ length: 63 }, (_, id) => [String(id), ['amount']])), new Set());
  const groups = correctionGroups(items);
  assert.deepEqual(groups.map(group => group.length), [25, 25, 13]);
  assert.deepEqual(groups.flat(), items);
  assert.deepEqual(correctionGroups([]), []);
  for (const size of [0, -1, 26, 1.5]) assert.throws(() => correctionGroups(items, size));
});
