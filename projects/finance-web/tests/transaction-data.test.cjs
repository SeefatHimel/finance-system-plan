const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file,imports={}) {
  const mod={exports:{}};
  new Function('module','exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText)(mod,mod.exports,name=>imports[name]??require(name));
  return mod.exports;
}
const {loadTransactionData}=load('transaction-data.ts',{'./api':{},'./transaction-list':load('transaction-list.ts')});
const signal=new AbortController().signal;
function fixture() {
  const calls=[];
  const api=Object.fromEntries(['listAccounts','listCategories','listPaymentMethods','getTransactionTotals'].map(name=>[name,async(...args)=>{calls.push([name,args]);return [name];}]));
  api.listTransactionPage=async(...args)=>{calls.push(['listTransactionPage',args]);return {count:26,results:[{id:`page-${args[2]}`}]};};
  return {api,calls};
}
test('page changes reuse lookups and preserve filters and cancellation signals',async()=>{
  const {api,calls}=fixture();const filters={account:'synthetic',month:'2026-01'};
  const first=await loadTransactionData('session',filters,1,25,null,false,false,signal,api);
  calls.length=0;
  const next=await loadTransactionData('session',filters,2,25,first,false,false,signal,api);
  assert.deepEqual(calls.map(([name])=>name),['listTransactionPage','getTransactionTotals']);
  assert.equal(next.accounts,first.accounts);assert.equal(next.transactions[0].id,'page-2');
  assert.equal(calls[0][1][1],filters);assert.equal(calls[0][1].at(-1),signal);assert.equal(calls[1][1].at(-1),signal);
});
test('deletions that shrink the page count load the last valid page',async()=>{
  const {api,calls}=fixture();const result=await loadTransactionData('session',{},9,25,null,false,false,signal,api);
  assert.equal(result.resultPage,2);assert.deepEqual(calls.filter(([name])=>name==='listTransactionPage').map(([,args])=>args[2]),[9,2]);
});
test('embedded editors load reference data without querying the ledger list or totals',async()=>{
  const {api,calls}=fixture();const result=await loadTransactionData('session',{},1,25,null,false,true,signal,api);
  assert.deepEqual(calls.map(([name])=>name),['listAccounts','listCategories','listPaymentMethods']);
  assert.equal(result.transactionCount,0);
});
test('lookup and ledger reads start together and aborted reads do not return partial success',async()=>{
  const {api,calls}=fixture();let reject;
  api.listAccounts=()=>new Promise((_,fail)=>{reject=fail;});
  const pending=loadTransactionData('session',{},1,25,null,false,false,signal,api);
  assert.ok(calls.some(([name])=>name==='listTransactionPage'));assert.ok(calls.some(([name])=>name==='getTransactionTotals'));
  reject(new DOMException('Cancelled','AbortError'));await assert.rejects(pending,{name:'AbortError'});
});
