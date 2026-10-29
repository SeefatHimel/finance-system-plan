const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const shim = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync(resolve(__dirname, '../lib/transfer-report-review.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(shim, shim.exports);
const { linkedSmsReports, reportAccountChoices } = shim.exports;
const bank = { id: 'bank', name: 'Synthetic bank', direction: 'debit' };
const card = { id: 'card', name: 'Synthetic card', direction: 'credit' };
const saved = { kind: 'Saved SMS', id: 'candidate', raw_message: 'raw', account: 'card', direction: 'credit' };
const report = { kind: 'Linked report', id: 'report', raw_message: 'raw', account: 'bank', direction: 'debit' };
const preview = sources => ({ ledger: { accounts: [bank, card] }, sources });

test('repair a misplaced report even when the saved SMS already identifies the card', () => {
  assert.deepEqual(reportAccountChoices(preview([saved, report]), saved), [card]);
});
test('an unknown or wrongly saved credit account can only be assigned to the receiving side', () => {
  for (const account of [null, 'bank']) {
    const source = { ...saved, account };
    assert.deepEqual(reportAccountChoices(preview([source, report]), source), [card]);
  }
});
test('a valid report needs no correction and another SMS report cannot authorize one', () => {
  assert.deepEqual(reportAccountChoices(preview([saved, { ...report, account: 'card', direction: 'credit' }]), saved), []);
  assert.deepEqual(linkedSmsReports(preview([{ ...report, raw_message: 'other' }]), saved), []);
  assert.deepEqual(reportAccountChoices(preview([saved, { ...report, raw_message: 'other' }]), saved), []);
});
test('unknown directions and parser interpretations are never silently reassigned', () => {
  for (const source of [{ ...saved, direction: null }, { ...saved, kind: 'Current SMS parser' }]) {
    assert.deepEqual(reportAccountChoices(preview([source, report]), source), []);
  }
});
