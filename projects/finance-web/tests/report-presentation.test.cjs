const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-report-presentation-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/report-presentation.ts'], { cwd: resolve(__dirname, '..') });
const { reportCents, reportMoney, reportChange, reportBreakdownRows, reportTrend, reportPresetPeriod, reportAmountError, reportStarter } = require(join(output, 'report-presentation.js'));
after(() => rmSync(output, {recursive:true,force:true}));

test('decimal report math retains cents, negative openings and large amounts',()=>{
  assert.equal(reportMoney(reportCents('0.10')+reportCents('0.20')),'0.30');
  assert.equal(reportMoney(reportCents('-0.01')),'-0.01');
  assert.equal(reportMoney(reportCents('999999999999.99')-reportCents('0.01')),'999999999999.98');
  assert.equal(reportMoney(reportCents('-25.50')+reportCents('530')-reportCents('300')),'204.50');
});
test('comparison percentages are absent for zero/negative baselines or crossing into negative',()=>{
  assert.equal(reportChange('25','0').percent,null);
  assert.equal(reportChange('25','-10').percent,null);
  assert.equal(reportChange('-25','100').percent,null);
  assert.deepEqual(reportChange('75','100'),{amount:'-25.00',direction:'down',percent:25});
  assert.deepEqual(reportChange('0','0'),{amount:'0.00',direction:'same',percent:null});
});
test('spending shares exclude net refunds and retain zero rows for inspection',()=>{
  const rows=[{name:'Refunds',amount:'-30.00',previous_amount:'0'},{name:'Small',amount:'20',previous_amount:'5'},{name:'Zero',amount:'0',previous_amount:'15'},{name:'Large',amount:'80',previous_amount:'90'}];
  const grouped=reportBreakdownRows(rows);
  assert.deepEqual(grouped.spending.map(row=>[row.name,row.share]),[['Large',80],['Small',20]]);
  assert.equal(grouped.positiveTotal,'100.00');assert.equal(grouped.refunds[0].name,'Refunds');assert.equal(grouped.neutral[0].name,'Zero');
  assert.equal(rows[0].name,'Refunds');
});
test('monthly activity preserves refunds and manual additions outside the saved period',()=>{
  const row=(date,expense)=>({date,income_total:'0',expense_total:expense,cash_in_total:'0.10',cash_out_total:'0.20'});
  const result=reportTrend([row('2026-11-01','10.10'),row('2026-11-02','-0.20'),row('2026-10-01','5')],'month');
  assert.deepEqual(result.map(r=>[r.date,r.expense_total]),[['2026-10','5.00'],['2026-11','9.90']]);
  assert.equal(result[1].cash_in_total,'0.20');assert.equal(result[1].cash_out_total,'0.40');
});
test('date shortcuts resolve to fixed inclusive dates across leap years and year boundaries',()=>{
  assert.deepEqual(reportPresetPeriod('last-month','2024-03-15'),{mode:'monthly',start:'2024-02-01',end:'2024-02-29'});
  assert.deepEqual(reportPresetPeriod('year-to-date','2026-11-14'),{mode:'custom',start:'2026-01-01',end:'2026-11-14'});
  assert.deepEqual(reportPresetPeriod('last-90-days','2026-01-01'),{mode:'custom',start:'2025-10-04',end:'2026-01-01'});
});
test('templates use intentional transaction types and statements remain a separate view',()=>{
  assert.deepEqual(reportStarter('spending').rules.types,['expense','fee','refund']);
  assert.deepEqual(reportStarter('income').rules.types,['income']);
  assert.equal(reportStarter('account-statement').report_view,'account_statement');
  assert.equal(reportStarter('unknown'),null);
  assert.match(reportAmountError('20','10'),/at least/);assert.equal(reportAmountError('0','0'),'');assert.match(reportAmountError('-1',null),/non-negative/);
});
