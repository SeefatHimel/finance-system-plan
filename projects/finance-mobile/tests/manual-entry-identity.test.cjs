const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), path = require('node:path');
const mod = {exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/manual-entry-identity.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod,mod.exports);
const {queuedEntryInput} = mod.exports;
test('every queued movement retains one identity through retries and old queue reloads',()=>{
 for(const type of ['expense','income','transfer','fee','lend','repayment_paid']) {
  const original={type,amount:'20.00'};
  const first=queuedEntryInput('saved-id',original);
  assert.equal(queuedEntryInput('saved-id',original).external_key,first.external_key);
  assert.deepEqual(queuedEntryInput('saved-id',first),first);
  assert.notEqual(queuedEntryInput('another-id',original).external_key,first.external_key);
 }
 assert.equal(queuedEntryInput('saved-id',{type:'transfer'}).external_key,'queued-transfer:saved-id');
 assert.equal(queuedEntryInput('saved-id',{type:'expense',external_key:'already-sent'}).external_key,'already-sent');
});
