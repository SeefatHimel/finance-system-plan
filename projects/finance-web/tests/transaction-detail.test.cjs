const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const ts = require('typescript');
const output = mkdtempSync(join(tmpdir(), 'finance-transaction-detail-'));
const subject = join(output, 'subject.cjs');
writeFileSync(subject, ts.transpileModule(readFileSync(join(__dirname, '../lib/transaction-detail.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText);
after(() => rmSync(output, { recursive: true, force: true }));
const { detailDifferences, detailAmount, detailSourceCount } = require(subject);
const record = { type:'expense',account:'bank',date:'2026-10-28',time:'18:45:00',direction:'debit',amount:'3420.00' };
const source = { account:'bank',date:'2026-10-28',time:null,amount:'3420',balance:'22180.50',direction:'debit',currency:'BDT' };
const fields = changes => changes.map(row=>row.field);
test('equal money values and absent statement times are not mismatches',()=>{
  assert.deepEqual(detailDifferences(record,source,{bank:'22180.50'},'BDT'),[]);
  assert.deepEqual(detailDifferences(record,{...source,time:'18:45'},{bank:'22180.50'},'BDT'),[]);
});
test('date, amount and account-bound balance differences are called out separately',()=>{
  assert.deepEqual(fields(detailDifferences(record,{...source,date:'2026-10-29',amount:'3420.01',balance:'22180.51'},{bank:'22180.50'},'BDT')),['date','amount','balance']);
});
test('received SMS dates do not masquerade as known event dates or times',()=>{
  assert.deepEqual(detailDifferences(record,{...source,date:'2026-10-29',time:'01:10',dateKind:'received'},{bank:'22180.50'},'BDT'),[]);
});
test('transfers compare the source to its own account leg',()=>{
  const transfer={...record,type:'transfer',transfer_account:'wallet'};
  const receiving={...source,account:'wallet',direction:'credit',balance:'100.00'};
  assert.deepEqual(detailDifferences(transfer,receiving,{bank:'22180.50',wallet:'100.00'},'BDT'),[]);
  assert.deepEqual(fields(detailDifferences(transfer,{...receiving,balance:'101.00'},{bank:'22180.50',wallet:'100.00'},'BDT')),['balance']);
});
test('unattributed or foreign-account reports never borrow a ledger balance',()=>{
  assert.deepEqual(detailDifferences(record,{...source,account:null,balance:'999.00'},{bank:'22180.50'},'BDT'),[]);
  assert.deepEqual(fields(detailDifferences(record,{...source,account:'other',balance:'999.00'},{bank:'22180.50'},'BDT')),['account']);
});
test('different currencies are not compared as equal monetary units; fees stay separate',()=>{
  assert.deepEqual(fields(detailDifferences(record,{...source,currency:'USD',amount:'1.00',balance:'2.00'},{bank:'22180.50'},'BDT')),['currency']);
  assert.deepEqual(detailDifferences(record,{...source,amount:'9.99',compareAmount:false},{bank:'22180.50'},'BDT'),[]);
});
test('internal transfers stay neutral unless the user selected an account perspective',()=>{
  const transfer={...record,type:'transfer',transfer_account:'wallet'};
  assert.deepEqual(detailAmount(transfer),{sign:'',tone:'transfer'});
  assert.deepEqual(detailAmount(transfer,'bank'),{sign:'−',tone:'debit'});
  assert.deepEqual(detailAmount(transfer,'wallet'),{sign:'+',tone:'credit'});
  assert.deepEqual(detailAmount({...record,type:'income',direction:'credit'}),{sign:'+',tone:'credit'});
});
test('source counts distinguish original PDFs from their rows and unavailable checks',()=>{
  assert.equal(detailSourceCount([{id:'sms'},{id:'sms'}],[{batch:'pdf'},{batch:'pdf'}]),'1 SMS · 1 statement PDF');
  assert.equal(detailSourceCount(null,[]),'SMS unavailable · 0 statement PDFs');
  assert.equal(detailSourceCount([],null),'0 SMS · Statements unavailable');
});
test('legacy scalar transfer balances are not silently assigned to the sending account',()=>{
  const { detailBalances } = require(subject);
  const old={...record,type:'transfer',transfer_account:'wallet',balance_after:'100.00',transfer_evidence:[]};
  assert.deepEqual(detailBalances(old),{});
  assert.deepEqual(detailBalances({...old,balance_reporting_account:'wallet'}),{wallet:'100.00'});
  assert.deepEqual(detailBalances({...old,reported_balances:[]}),{});
  assert.deepEqual(detailBalances({...old,reported_balances:[{account:'bank',balance_after:null},{account:'wallet',balance_after:'25.00'},{account:'unrelated',balance_after:'999.00'}]}),{wallet:'25.00'});
});
test('unavailable currency and account do not produce a false money comparison',()=>{
  assert.deepEqual(detailDifferences(record,{...source,account:null,currency:null,amount:'5.00',balance:'100.00'},{bank:'22180.50'},'BDT'),[]);
});
