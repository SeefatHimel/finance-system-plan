const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const subject={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/balance-source-badges.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText)(subject,subject.exports);
const {balanceSourceBadges}=subject.exports;
const source={kind:'statement',account:'bank',balance_after:'100.00',currency:'BDT',direction:'debit',date:'2026-01-02',time:'12:00:00',time_kind:'reported',usable:true};
const base={value:'100',account:'bank',currency:'BDT',date:'2026-01-02',time:'12:00',direction:'debit',sources:{observations:[source],complete:true}};
const check=(sources,changes={})=>balanceSourceBadges({...base,...changes,sources:{observations:sources,complete:true}});
test('an exact same-account, direction, currency and reported moment can match',()=>{
 assert.equal(balanceSourceBadges(base)[0].label,'Matches Statement');assert.equal(balanceSourceBadges(base)[0].tone,'ok');
 assert.equal(check([{...source,balance_after:'0.00'}],{value:'0.00'})[0].tone,'ok');
 assert.equal(check([{...source,balance_after:'-1.01'}],{value:'-1.01'})[0].tone,'ok');
});
test('equal receipt-only, unknown or different-time reports remain numeric agreement',()=>{
 for(const changed of [{kind:'sms',time_kind:'received'},{time:null},{date:'2026-01-03'},{time:'12:01:00'}]){
  const badge=check([{...source,...changed}])[0];assert.equal(badge.tone,'warning');assert.equal(badge.clock,true);assert.match(badge.label,/value agrees/);
 }
});
test('one matching source cannot hide a contradictory source of the same kind',()=>{
 assert.equal(check([source,{...source,balance_after:'100.01'}])[0].label,'Statement conflicts');
 assert.equal(check([{...source,balance_after:'100.01'}])[0].label,'Statement differs');
 assert.equal(check([{...source,kind:'sms',balance_after:'99.99'}])[0].label,'SMS differs');
});
test('another transfer account never lends its balance to this field',()=>{
 assert.deepEqual(check([{...source,account:'card'}]),[]);
 for(const changed of [{account:null},{usable:false},{currency:'USD'},{direction:'credit'},{balance_after:null}])assert.equal(check([{...source,...changed}])[0].label,'Statement unverified');
});
test('calculated values, incomplete checks, malformed values and absent reports cannot pass',()=>{
 assert.equal(balanceSourceBadges({...base,calculated:true})[0].label,'Calculated');
 for(const sources of [undefined,null,{observations:[source],complete:false}])assert.equal(balanceSourceBadges({...base,sources})[0].label,'Sources unchecked');
 for(const value of ['NaN','Infinity','1e2','100.001',''])assert.equal(balanceSourceBadges({...base,value})[0].tone,'warning');
 assert.deepEqual(balanceSourceBadges({...base,value:null}),[]);assert.deepEqual(check([]),[]);
});
