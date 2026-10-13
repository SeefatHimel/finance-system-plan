const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const moduleShim = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync(resolve(__dirname, '../lib/statement-balance-choice.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(moduleShim, moduleShim.exports);
const { currentStatementBalanceChoice } = moduleShim.exports;

test('a balance choice expires when the draft version, ledger report or statement report changes', () => {
  const choice = { keep: 'statement', existing_balance_after: '900.00', statement_balance_after: '900.07', version: 1 };
  const match = { effective_balance_after: '900.00' };
  assert.deepEqual(currentStatementBalanceChoice(choice, match, '900.07', 1), {
    keep: 'statement', existing_balance_after: '900.00', statement_balance_after: '900.07',
  });
  assert.equal(currentStatementBalanceChoice(choice, match, '900.07', 2), undefined);
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: '900.01' }, '900.07', 1), undefined);
  assert.equal(currentStatementBalanceChoice(choice, match, '900.08', 1), undefined);
  assert.equal(currentStatementBalanceChoice(undefined, match, '900.07', 1), undefined);
});

test('zero and absent balances remain distinct in review choices', () => {
  const choice = { keep: 'existing', existing_balance_after: '0.00', statement_balance_after: '0.07', version: 1 };
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: '0.00' }, '0.07', 1).keep, 'existing');
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: null }, '0.07', 1), undefined);
});
