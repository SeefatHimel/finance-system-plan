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
const { agreeingSmsStatementEvidence } = moduleShim.exports;

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
