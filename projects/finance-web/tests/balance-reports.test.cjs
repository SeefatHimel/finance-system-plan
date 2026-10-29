const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const path=require('node:path');
const subject=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/balance-reports.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const shim={exports:{}};new Function('module','exports',subject)(shim,shim.exports);
const {groupBalanceReports,transactionBalanceReports,balanceValueKey}=shim.exports;
const selected={account:'bank',name:'Example bank',currency:'BDT',value:'1000.00'};
const report=(id,value,other={})=>({id,sourceKey:id,label:id,account:'bank',currency:'BDT',value,date:'2026-10-20',time:'12:00:00',...other});

test('agreeing sources collapse to one selected account value with source count',()=>{
 const [group]=groupBalanceReports([selected],[report('sms','1000'),report('pdf','1000.00')]);
 assert.equal(group.primary,'1000.00');assert.equal(group.sourceCount,2);assert.equal(group.differs,false);assert.equal(group.reports.length,2);
});
test('differing reports preserve the chosen primary rather than selecting the highest',()=>{
 const [group]=groupBalanceReports([selected],[report('sms','1000.00'),report('pdf','1500.00')]);
 assert.equal(group.primary,'1000.00');assert.equal(group.differs,true);
});
test('a reviewed primary can disagree with one retained original',()=>{
 assert.equal(groupBalanceReports([selected],[report('pdf','900')])[0].differs,true);
});
test('zero and negative values are known; missing values never become zero',()=>{
 assert.equal(balanceValueKey('0.00'),'0.');assert.equal(balanceValueKey('-0.00'),'0.');assert.equal(balanceValueKey('-010.20'),'-10.2');
 const [group]=groupBalanceReports([{...selected,value:null}],[report('a',null),report('b','0.00')]);
 assert.equal(group.primary,null);assert.equal(group.differs,false);assert.equal(group.sourceCount,2);
});
test('unknown selected balance stays unknown even when sources disagree',()=>{
 const [group]=groupBalanceReports([{...selected,value:null}],[report('a','100'),report('b','200')]);assert.equal(group.primary,null);assert.equal(group.differs,true);
});
test('different currencies and accounts are never collapsed or cross-compared',()=>{
 const groups=groupBalanceReports([selected,{...selected,account:'wallet',value:'20.00'}],[report('a','1000'),report('usd','10',{currency:'USD'}),report('wallet','20',{account:'wallet'})]);
 assert.equal(groups[0].sourceCount,1);assert.equal(groups[0].differs,false);assert.equal(groups[1].primary,'20.00');assert.equal(groups[1].sourceCount,1);
 assert.equal(groupBalanceReports([{...selected,currency:null}],[report('a','10',{currency:null}),report('b','20',{currency:null})])[0].differs,false);
});
test('manual selections and multiple rows in one PDF do not inflate original source count',()=>{
 const [group]=groupBalanceReports([selected],[report('one','1000',{sourceKey:'pdf:1'}),report('two','1000',{sourceKey:'pdf:1'}),report('review','1000',{original:false})]);
 assert.equal(group.sourceCount,1);assert.equal(group.reports.length,3);
});
test('decimal comparison remains exact for large amounts',()=>{
 assert.notEqual(balanceValueKey('999999999999.98'),balanceValueKey('999999999999.99'));
});
const accounts=[{id:'bank',currency:'BDT'},{id:'wallet',currency:'BDT'}];
const evidence={id:'e',account:'bank',direction:'debit',raw_message:'m',source:'sms',date:'2026-10-20',time:'12:00:00',balance_after:'1000.00',reference:'EXAMPLE'};
const record={id:'t',account:'bank',transfer_account:'wallet',type:'transfer',transfer_evidence:[evidence]};
test('hydrating an SMS replaces its saved observation without double-counting it',()=>{
 const reports=transactionBalanceReports(record,accounts,{messages:[{id:'m',sender:'EXAMPLE',received_at:'2026-10-20T06:01:00Z',parsed:{account:'bank',currency:'BDT',balance_after:'1000.00',reference:'EXAMPLE'}}],rows:[],batches:{}});
 assert.equal(reports.length,1);assert.equal(reports[0].sourceKey,'sms:m');assert.equal(reports[0].time,'12:00:00');assert.equal(reports[0].received,false);
});
test('ordinary SMS attribution comes from confirmed parsed account metadata',()=>{
 const reports=transactionBalanceReports({...record,type:'expense',transfer_evidence:[]},accounts,{messages:[{id:'m',sender:'EXAMPLE',received_at:'2026-10-20T06:01:00Z',parsed:{account:'wallet',currency:'BDT',balance_after:'20.00'}}],rows:[],batches:{}});
 assert.equal(reports[0].account,'wallet');assert.equal(reports[0].received,true);
});
test('older API responses do not fabricate an SMS reporting account',()=>{
 const reports=transactionBalanceReports({...record,type:'expense',transfer_evidence:[]},accounts,{messages:[{id:'m',sender:'EXAMPLE',received_at:'2026-10-20T06:01:00Z',parsed:{balance_after:'1000.00'}}],rows:[],batches:{}});
 assert.equal(reports[0].account,null);assert.equal(reports[0].currency,null);
});
