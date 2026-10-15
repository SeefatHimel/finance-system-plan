const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function load(sourcePath, dependencies = {}) {
  const source = readFileSync(resolve(__dirname, sourcePath), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const shim = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, shim, shim.exports);
  return shim.exports;
}

const categoryType = load("../lib/category-type.ts");
const { initialPairCategory, categoryAfterPairTypeChoice, mappedPairCategory } = load("../lib/unified-review-category.ts", { "./category-type": categoryType });
const categories = [
  { id: "interior", name: "Interior", kind: "expense", is_active: true },
  { id: "groceries", name: "Groceries", kind: "expense", is_active: true },
  { id: "transfer", name: "Account Transfer", kind: "transfer", is_active: true },
  { id: "inactive", name: "Old category", kind: "expense", is_active: false },
];
const row = (type, category, suggestedType, suggestedCategory) => ({ type, category, review: { suggestion: { type: suggestedType, category: suggestedCategory } } });

test("verified code category prefills the compatible statement result", () => {
  const statement = row("expense", null, "expense", "interior");
  const sms = { transaction_type: "transfer", category: null };
  assert.equal(initialPairCategory(statement, sms, categories), "interior");
  assert.equal(categoryAfterPairTypeChoice(statement, sms, "interior", "expense", "statement", categories), "interior");
  assert.equal(categoryAfterPairTypeChoice(statement, sms, "interior", "transfer", "sms", categories), null);
});

test("transfer mapping waits until transfer is chosen", () => {
  const statement = row("expense", null, "transfer", "transfer");
  const sms = { transaction_type: "transfer", category: null };
  assert.equal(initialPairCategory(statement, sms, categories), null);
  assert.equal(categoryAfterPairTypeChoice(statement, sms, null, "transfer", "sms", categories), "transfer");
});

test("saved and manual categories take precedence; invalid mapping is ignored", () => {
  const statement = row("expense", "groceries", "expense", "interior");
  const sms = { transaction_type: "expense", category: "interior" };
  assert.equal(initialPairCategory(statement, sms, categories), "groceries");
  assert.equal(categoryAfterPairTypeChoice(statement, sms, "groceries", "expense", "custom", categories), "groceries");
  assert.equal(mappedPairCategory(row("expense", null, "expense", "transfer"), "expense", categories), null);
  assert.equal(mappedPairCategory(row("expense", null, "expense", "inactive"), "expense", categories), null);
});
