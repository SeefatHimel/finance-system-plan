const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-sender-group-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, '../finance-contracts/sender-groups.ts'], { cwd: resolve(__dirname, '..') });
const {senderRuleGroups,isPathaoSender,pathaoSenders} = require(join(output, 'sender-groups.js'));
after(() => rmSync(output, { recursive: true, force: true }));
test('four exact aliases display together without replacing rules or choices',()=>{
 const rules=pathaoSenders.map((sender,i)=>({id:String(i),sender,provider:'pathao_pay',account:'wallet',match_type:'exact',is_active:i!==1}));
 const groups=senderRuleGroups(rules);
 assert.equal(groups.length,1);assert.deepEqual(groups[0].members,rules);
 assert.equal(groups[0].members[1].is_active,false);
 assert.equal(new Set(groups[0].members.map(rule=>rule.id)).size,4);
});
test('sender grouping is exact, provider scoped and wallet scoped',()=>{
 assert.equal(isPathaoSender('  PATHAOPAY. '),true);
 assert.equal(isPathaoSender('PathaoPay Marketing'),false);
 assert.equal(isPathaoSender('PathaoPay','other'),false);
 const base={id:'1',sender:'PathaoPay',provider:'pathao_pay',account:'one',match_type:'exact'};
 assert.equal(senderRuleGroups([base,{...base,id:'2',account:'two'},{...base,id:'3',match_type:'contains'}]).length,3);
});
