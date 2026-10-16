const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const reviewShim = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync(resolve(__dirname, '../lib/statement-review.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(reviewShim, reviewShim.exports);
const moduleShim = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(readFileSync(resolve(__dirname, '../lib/statement-balance-choice.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(moduleShim, moduleShim.exports, (name) => {
  assert.equal(name, './statement-review');
  return reviewShim.exports;
});
const { currentStatementBalanceChoice } = moduleShim.exports;

test('a balance choice expires when the draft version, ledger report or statement report changes', () => {
  const choice = { keep: 'statement', existing_balance_after: '900.00', statement_balance_after: '900.07', version: 1 };
  const match = { effective_balance_after: '900.00' };
  assert.deepEqual(currentStatementBalanceChoice(choice, match, '900.07', 1, 'BDT'), {
    keep: 'statement', existing_balance_after: '900.00', statement_balance_after: '900.07',
  });
  assert.equal(currentStatementBalanceChoice(choice, match, '900.07', 2, 'BDT'), undefined);
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: '900.01' }, '900.07', 1, 'BDT'), undefined);
  assert.equal(currentStatementBalanceChoice(choice, match, '900.08', 1, 'BDT'), undefined);
});

test('zero and absent balances remain distinct in review choices', () => {
  const choice = { keep: 'existing', existing_balance_after: '0.00', statement_balance_after: '0.07', version: 1 };
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: '0.00' }, '0.07', 1, 'BDT').keep, 'existing');
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: null }, '0.07', 1, 'BDT'), undefined);
});

test('a sub-taka BDT difference initially selects the higher report without losing exact values', () => {
  assert.deepEqual(currentStatementBalanceChoice(undefined, { effective_balance_after: '22520.00' }, '22520.33', 1, 'BDT'), {
    keep: 'statement', existing_balance_after: '22520.00', statement_balance_after: '22520.33',
  });
  assert.equal(currentStatementBalanceChoice(undefined, { effective_balance_after: '22520.33' }, '22520.00', 1, 'BDT').keep, 'existing');
  assert.equal(currentStatementBalanceChoice(undefined, { effective_balance_after: '0.00' }, '0.07', 1, 'BDT').keep, 'statement');
  assert.equal(currentStatementBalanceChoice(undefined, { effective_balance_after: '22520.00' }, '22520.99', 1, 'BDT').keep, 'statement');
});

test('larger, equal, unknown or non-BDT reports still need no automatic conflict choice', () => {
  for (const [existing, statement, currency] of [
    ['22520.00', '22521.00', 'BDT'],
    ['22520.00', '22520.00', 'BDT'],
    [null, '22520.33', 'BDT'],
    ['22520.00', null, 'BDT'],
    ['22520.00', '22520.33', 'USD'],
  ]) assert.equal(currentStatementBalanceChoice(undefined, { effective_balance_after: existing }, statement, 1, currency), undefined);
});

test('a manual lower choice overrides the default higher report', () => {
  const choice = { keep: 'existing', existing_balance_after: '22520.00', statement_balance_after: '22520.33', version: 1 };
  assert.equal(currentStatementBalanceChoice(choice, { effective_balance_after: '22520.00' }, '22520.33', 1, 'BDT').keep, 'existing');
});
