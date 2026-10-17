const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
function load(path, dependencies = {}) {
  const source = readFileSync(resolve(__dirname, path), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => dependencies[name], mod, mod.exports);
  return mod.exports;
}
const categoryType = load('../lib/category-type.ts');
const { statementDraftCategory: choose } = load('../lib/statement-draft-category.ts', { './category-type': categoryType });
const categories = [
  { id: 'transfer', kind: 'transfer', is_active: true },
  { id: 'food', kind: 'expense', is_active: true },
  { id: 'old-transfer', kind: 'transfer', is_active: false },
];
test('a funded transfer gets the sole active transfer category without guessing an account', () => {
  assert.equal(choose('transfer', null, categories), 'transfer');
  assert.equal(choose('transfer', 'transfer', categories), 'transfer');
  assert.equal(choose('expense', null, categories), null);
  assert.equal(choose('income', null, categories), null);
});
test('ambiguous or unavailable transfer categories require a user choice', () => {
  assert.equal(choose('transfer', null, []), null);
  assert.equal(choose('transfer', null, categories.filter(c => !c.is_active)), null);
  assert.equal(choose('transfer', null, [...categories, { id: 'second', kind: 'transfer', is_active: true }]), null);
});
test('type changes replace incompatible categories but keep compatible or unknown saved choices', () => {
  assert.equal(choose('transfer', 'food', categories), 'transfer');
  assert.equal(choose('expense', 'transfer', categories), null);
  assert.equal(choose('fee', 'food', categories), 'food');
  assert.equal(choose('transfer', 'custom-saved', categories), 'custom-saved');
});
