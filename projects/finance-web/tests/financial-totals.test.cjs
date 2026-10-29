const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const ts = require('typescript');
const output = mkdtempSync(join(tmpdir(), 'finance-financial-totals-test-'));
const compiled = join(output, 'subject.cjs');
writeFileSync(compiled, ts.transpileModule(readFileSync(join(__dirname, '../lib/financial-totals.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText);
const { filteredFinancialTotals } = require(compiled);
after(() => rmSync(output, { recursive: true, force: true }));
const row = (type, amount, extra = {}) => ({ account: 'bank', type, amount, direction: ['income', 'refund', 'borrow', 'repayment_received'].includes(type) ? 'credit' : 'debit', ...extra });
const currencies = new Map([['bank', 'BDT'], ['wallet', 'BDT'], ['usd', 'USD']]);
test('totals separate earned income, refunded consumption and principal with exact cents', () => {
  const [result] = filteredFinancialTotals([row('income', '100.10'), row('expense', '20.20'), row('fee', '0.10'), row('refund', '2.30'), row('borrow', '10.00'), row('lend', '3.00'), row('repayment_received', '1.00'), row('transfer', '25.00', { transfer_account: 'wallet' })], currencies);
  assert.equal(result.income, '100.10'); assert.equal(result.spending, '18.00'); assert.equal(result.refunds, '2.30');
  assert.equal(result.financingIn, '11.00'); assert.equal(result.financingOut, '3.00'); assert.equal(result.net, '90.10'); assert.equal(result.transfers, '25.00');
});
test('whole-portfolio transfers have no net movement; selected account has its own leg', () => {
  const records = [row('transfer', '25.00', { transfer_account: 'wallet' })];
  assert.equal(filteredFinancialTotals(records, currencies)[0].net, '0.00');
  assert.equal(filteredFinancialTotals(records, currencies, 'bank')[0].net, '-25.00');
  assert.equal(filteredFinancialTotals(records, currencies, 'wallet')[0].net, '25.00');
});
test('refund-only periods stay negative and currencies never mix', () => {
  const result = filteredFinancialTotals([row('refund', '0.30'), row('expense', '99.99', { account: 'usd' })], currencies);
  assert.equal(result[0].spending, '-0.30'); assert.equal(result[1].spending, '99.99');
  assert.equal(result[1].currency, 'USD');
});
test('large money values keep every cent across the whole result', () => {
  const result = filteredFinancialTotals(Array.from({ length: 100 }, () => row('expense', '999999999999.99')), currencies);
  assert.equal(result[0].spending, '99999999999999.00');
});

test('schedule estimates account for frequency and keep currencies separate', async () => {
  const { monthlyCommitments, sumMoneyByCurrency } = require(compiled);
  assert.deepEqual(monthlyCommitments([{currency:'BDT',amount:'120.00',frequency:'weekly'},{currency:'BDT',amount:'1200.00',frequency:'yearly'},{currency:'USD',amount:'30.00',frequency:'quarterly'}]), [{currency:'BDT',amount:'620.00'},{currency:'USD',amount:'10.00'}]);
  assert.deepEqual(sumMoneyByCurrency([{currency:'BDT',amount:'0.10'},{currency:'BDT',amount:'0.20'},{currency:'USD',amount:'1.00'}]), [{currency:'BDT',amount:'0.30'},{currency:'USD',amount:'1.00'}]);
});
