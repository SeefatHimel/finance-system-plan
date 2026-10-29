const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const subject = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync(join(__dirname, '../lib/transaction-balances.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(subject, subject.exports);
const { balanceEditSnapshot, balanceEditPrefill } = subject.exports;
const record = { id:'demo', updated_at:'2026-01-02T12:00:00Z', type:'expense', account:'bank', transfer_account:null, direction:'debit', date:'2026-01-02', time:'12:00:00', amount:'3.45', balance_after:'1056.55', transfer_evidence:[] };

test('an explicit balance choice prefills only the freshly fetched matching record', () => {
  const original = JSON.stringify(record);
  const suggestion = { account:'bank', balance:'996.55', snapshot:balanceEditSnapshot(record) };
  assert.deepEqual(balanceEditPrefill(record, suggestion), {account:'bank', balance:'996.55'});
  for (const balance of ['0.00','-1.00']) assert.deepEqual(balanceEditPrefill(record, {...suggestion,balance}), {account:'bank',balance});
  assert.equal(JSON.stringify(record), original);
  for (const changes of [{id:'other'}, {updated_at:'later'}, {amount:'4.00'}, {balance_after:'1055.55'}, {account:'other'}, {time:'12:01:00'}]) {
    assert.equal(balanceEditPrefill({...record,...changes}, suggestion), null);
  }
  assert.equal(balanceEditPrefill(record, {...suggestion,account:'foreign'}), null);
  for (const balance of ['NaN','Infinity','', '1.234','1e3']) assert.equal(balanceEditPrefill(record,{...suggestion,balance}),null);
  assert.equal(balanceEditPrefill(record),null);
});

test('transfer suggestions target one account and expire when its reports change', () => {
  const transfer = {...record,type:'transfer',transfer_account:'cash',reported_balances:[{account:'bank',balance_after:'100.00'},{account:'cash',balance_after:'50.00'}]};
  const receiving = {account:'cash',balance:'60.00',snapshot:balanceEditSnapshot(transfer)};
  assert.deepEqual(balanceEditPrefill(transfer,receiving),{account:'cash',balance:'60.00'});
  assert.equal(balanceEditPrefill({...transfer,reported_balances:[{account:'bank',balance_after:'100.00'},{account:'cash',balance_after:'55.00'}]},receiving),null);
  assert.equal(transfer.reported_balances[0].balance_after,'100.00');
  const evidence = {account:'bank',is_primary:true,balance_after:'100.00',time:'12:00:00'};
  const observed = {...transfer,transfer_evidence:[evidence]};
  const choice = {...receiving,snapshot:balanceEditSnapshot(observed)};
  assert.equal(balanceEditPrefill({...observed,transfer_evidence:[{...evidence,time:'12:01:00'}]},choice),null);
});
