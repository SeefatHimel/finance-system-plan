const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const subject = ts.transpileModule(readFileSync(require('node:path').join(__dirname, '../lib/statement-match-comparison.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const moduleShim = {exports:{}};
new Function('module','exports',subject)(moduleShim,moduleShim.exports);
const {statementComparisonDifferences, descriptionNumberDifferences, descriptionDifferenceParts} = moduleShim.exports;
const facts = {amount:'100.00',account:'bank',transferAccount:null,date:'2026-08-25',time:null,type:'expense',category:null,balance:'900.00',reference:'',description:'PAY SERVICE12345678901234'};

test('statement-to-ledger comparison flags known date, path, type, and balance differences', () => {
 const result=statementComparisonDifferences(facts,{...facts,transferAccount:'wallet',date:'2026-08-22',time:'10:09:00',type:'transfer',category:'transfer-category',balance:'1500.00',description:'Bank transfer PAY SERVICE12345678'});
 assert.equal(result.amount,false);
 for(const field of ['date','path','classification','balance']) assert.equal(result[field],true);
 assert.equal(result.time,false); // Missing statement time is not a mismatch.
 assert.equal(result.reference,false);
 assert.equal(result.descriptionNumbers.hasDifference,true);
});

test('different reporting times do not erase a visible numeric balance difference', () => {
 const result=statementComparisonDifferences(facts,{...facts,balance:'1200.00'});
 assert.equal(result.balance,true); // Replacement rules are handled separately by the caller.
});

test('unknown facts and formatting differences never fabricate mismatches', () => {
 const result=statementComparisonDifferences({...facts,amount:null,date:null,balance:null,reference:''},{...facts,time:'10:00',reference:'known'});
 for(const field of ['amount','date','time','balance','reference']) assert.equal(result[field],false);
 assert.equal(statementComparisonDifferences({...facts,time:'10:00',amount:'100.0'},{...facts,time:'10:00:00'}).time,false);
});

test('whole numeric codes are compared without treating a shared prefix as equality', () => {
 const result=descriptionNumberDifferences('PAY SERVICE12345678901234','PAY SERVICE12345678');
 assert.deepEqual(result,{statement:['12345678901234'],ledger:['12345678'],hasDifference:true});
 assert.equal(descriptionNumberDifferences('PAY SERVICE12345678','PAY SERVICE12345678').hasDifference,false);
});

test('mask and suffix text stays intact and no numbers are invented', () => {
 const text='VISA POS 111122****304*||***6789|PAY SERVICE12345678901234';
 const changes=descriptionNumberDifferences(text,'PAY SERVICE12345678');
 assert.deepEqual(changes.statement,['111122****304*','***6789','12345678901234']);
 const parts=descriptionDifferenceParts(text,changes.statement);
 assert.equal(parts.map(p=>p.text).join(''),text);
 assert.deepEqual(parts.filter(p=>p.different).map(p=>p.text),changes.statement);
 assert.equal(descriptionNumberDifferences('Unknown merchant','PAY SERVICE12345678').hasDifference,false);
});

test('unknown transfer endpoints are not treated as contradictory account paths', () => {
 const incoming={...facts,type:'transfer',account:null,transferAccount:'wallet'};
 assert.equal(statementComparisonDifferences(incoming,{...incoming,account:'bank'}).path,false);
 assert.equal(statementComparisonDifferences(incoming,{...incoming,transferAccount:'other-wallet'}).path,true);
 const outgoing={...facts,type:'transfer',transferAccount:null};
 assert.equal(statementComparisonDifferences(outgoing,{...outgoing,transferAccount:'wallet'}).path,false);
});

test('category assignments remain visibly different from explicitly uncategorized entries', () => {
 assert.equal(statementComparisonDifferences(facts,{...facts,category:'groceries'}).classification,true);
 assert.equal(statementComparisonDifferences({...facts,category:'groceries'},facts).classification,true);
 assert.equal(statementComparisonDifferences(facts,{...facts}).classification,false);
});

test('blank money strings are unavailable rather than zero-value conflicts', () => {
 const result=statementComparisonDifferences({...facts,amount:'',balance:' '},facts);
 assert.equal(result.amount,false);
 assert.equal(result.balance,false);
});

test('common printed mask characters are preserved and compared as whole values', () => {
 const left='Card 111122XXXX304X / account •••6789';
 const right='Card 111122xxxx305x / account •••9876';
 const codes=descriptionNumberDifferences(left,right);
 assert.deepEqual(codes.statement,['111122XXXX304X','•••6789']);
 assert.deepEqual(codes.ledger,['111122xxxx305x','•••9876']);
 assert.equal(descriptionDifferenceParts(left,codes.statement).map(p=>p.text).join(''),left);
});
