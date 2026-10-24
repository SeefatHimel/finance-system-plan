const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(resolve(__dirname, '../lib/sms-statement-evidence.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const moduleShim = { exports: {} };
new Function('module', 'exports', compiled)(moduleShim, moduleShim.exports);
const { agreeingSmsStatementEvidence, compareSmsStatementReports, sourceAttentionItems } = moduleShim.exports;

const statement = {
  account: 'bank', account_name: 'Synthetic bank', amount: '100.00',
  balance_after: '900.07', currency: 'BDT', direction: 'debit', reference: 'SYNTH-1',
};

test('shows only source details corroborated for a reviewed pair', () => {
  const details = agreeingSmsStatementEvidence(statement,
    { account: 'bank', amount: '100.00', source_direction: 'debit' },
    { late_posting: false, reasons: ['Reported balances agree.', 'Reference agrees.'] });
  assert.deepEqual(details.map(item => item.label), [
    'Reporting account', 'Direction', 'Exact amount', 'Balance after', 'Reference',
  ]);
});

test('does not highlight an edited account, rounded amount or later balance as exact', () => {
  const details = agreeingSmsStatementEvidence(statement,
    { account: 'other-account', amount: '99.63', source_direction: '' },
    { late_posting: true, reasons: ['Reported balances agree.'] });
  assert.deepEqual(details, []);
});

test('distinguishes a real date and balance difference from missing reports', () => {
  const sms = { date: '2026-07-25', balance_after: '743678.60' };
  assert.deepEqual(compareSmsStatementReports(
    { date: '2026-07-26', value_date: null, balance_after: '743600.00' }, sms, false,
  ), { date: 'different', balance: 'different' });
  assert.deepEqual(compareSmsStatementReports(
    { date: null, balance_after: null }, sms, false,
  ), { date: 'unknown', balance: 'unknown' });
});

test('EBL value date can match an earlier SMS without treating posting-order balances as a discrepancy', () => {
  assert.deepEqual(compareSmsStatementReports(
    { date: '2026-07-26', value_date: '2026-07-25', balance_after: '743600.00' },
    { date: '2026-07-25', balance_after: '743678.60' }, true,
  ), { date: 'value_date_match', balance: 'different_reporting_times' });
});

test('review prompts name important differences without declaring a pair invalid', () => {
  const items = sourceAttentionItems(
    { account: 'bank', direction: 'debit', amount: '100.00', date: '2026-07-26', balance_after: '900.00' },
    { account: 'other', direction: 'credit', amount: '101.00', date: '2026-07-25', balance_after: '901.00' },
    false,
  );
  assert.deepEqual(items.map(item => item.key), ['account', 'direction', 'amount', 'date', 'balance']);
  assert.ok(items.every(item => item.tone === 'warning'));
});

test('late posting explains value date and balance instead of labelling a confirmed discrepancy', () => {
  const items = sourceAttentionItems(
    { account: 'bank', direction: 'debit', amount: '100.00', date: '2026-07-26', value_date: '2026-07-25', balance_after: '900.00' },
    { account: 'bank', direction: 'debit', amount: '100.00', date: '2026-07-25', balance_after: '901.00' },
    true,
  );
  assert.deepEqual(items.map(item => [item.key, item.tone]), [['date', 'context'], ['balance', 'context']]);
});

test('missing date and balance are disclosed instead of suggesting a clean comparison', () => {
  const items = sourceAttentionItems(
    { account: 'bank', direction: 'debit', amount: '100.00', date: null, balance_after: null },
    { account: 'bank', direction: 'debit', amount: '100.00', date: '2026-07-25', balance_after: '901.00' },
    false,
  );
  assert.deepEqual(items.map(item => [item.key, item.tone]), [['date', 'context'], ['balance', 'context']]);
});
