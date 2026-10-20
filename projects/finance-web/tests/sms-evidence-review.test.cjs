const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const source = readFileSync(resolve(__dirname, '../lib/sms-evidence-review.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const shim = { exports: {} };
new Function('module', 'exports', 'require', compiled)(shim, shim.exports, require);
const { smsEvidenceWarnings } = shim.exports;

test('warns when a generic City Bank deposit is assigned to EBL with unsupported details', () => {
  const warnings = smsEvidenceWarnings({
    account: { id: 'other', name: 'EBL' },
    categoryName: 'Investment profit', counterparty: 'A government bank', note: 'Investment profit',
    methods: [{ account: 'other', provider: 'ebl', is_active: true }],
    sources: [{ sender: 'CITYBANK', body: 'Tk. 5,313 Deposit\nTk. 72,488 Balance\nA/C: 1234***5678' }],
  });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /City Bank.*EBL/);
  assert.match(warnings[1], /does not name its source or purpose/);
});

test('does not claim a provider mismatch when the account provider is unknown', () => {
  const warnings = smsEvidenceWarnings({
    account: { id: 'custom', name: 'Savings' }, categoryName: '', counterparty: '', note: '', methods: [],
    sources: [{ sender: 'CITYBANK', body: null }],
  });
  assert.deepEqual(warnings, []);
});

test('does not compare both transfer-bank SMS with only the canonical source account', () => {
  const warnings = smsEvidenceWarnings({
    account: { id: 'source', name: 'EBL' }, categoryName: 'Account Transfer',
    counterparty: '', note: '', transactionType: 'transfer', methods: [],
    sources: [{ sender: 'CITYBANK', body: 'Tk. 100 Deposit' }],
  });
  assert.deepEqual(warnings, []);
});
