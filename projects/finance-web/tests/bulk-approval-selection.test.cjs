const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../finance-contracts/unified-bulk.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const exportsObject={};vm.runInNewContext(js,{exports:exportsObject,Map});
const {selectPagePairs,pairSelectionKey,BULK_APPROVAL_LIMIT}=exportsObject;
const pair=index=>({statement:`synthetic-row-${index}`,sms:`synthetic-sms-${index}`});
test('selection retains earlier pages and deduplicates identical pairs',()=>{
 const existing=[pair(1),pair(2)]; const result=selectPagePairs(existing,[pair(2),pair(3)]);
 assert.deepEqual(Array.from(result,pairSelectionKey),[pair(1),pair(2),pair(3)].map(pairSelectionKey));
 assert.equal(existing.length,2);
});
test('select page respects the batch cap without dropping existing selections',()=>{
 const existing=Array.from({length:20},(_,index)=>pair(index));
 const result=selectPagePairs(existing,Array.from({length:50},(_,index)=>pair(index+20)));
 assert.equal(result.length,BULK_APPROVAL_LIMIT);
 assert.deepEqual(Array.from(result.slice(0,20),pairSelectionKey),existing.map(pairSelectionKey));
});
test('competing pairs retain distinct identities for server-side ambiguity checks',()=>{
 const result=selectPagePairs([],[pair(1),{...pair(1),sms:'synthetic-alternative'}]);
 assert.equal(result.length,2);assert.notEqual(pairSelectionKey(result[0]),pairSelectionKey(result[1]));
});
