const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const moduleShim={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/clock-time.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleShim,moduleShim.exports);
const {clockTimeValue}=moduleShim.exports;
test('clock values preserve exact seconds, midnight and minute-only precision',()=>{
 assert.equal(clockTimeValue('0','7','32'),'00:07:32');
 assert.equal(clockTimeValue('23','59','59'),'23:59:59');
 assert.equal(clockTimeValue('12','0'),'12:00');
 assert.equal(clockTimeValue('00','00','00'),'00:00:00');
});
test('blank or invalid clock selections do not invent a valid timestamp',()=>{
 for(const values of [['','00'],['24','00'],['12','60'],['12','1.5'],['-1','0'],['12','00','60'],['12','00','']])assert.equal(clockTimeValue(...values),null);
});
