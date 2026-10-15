const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../lib/statement-citytouch.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", compiled)(shim, shim.exports);
const { displayedStatementText } = shim.exports;

test("recovered second code replaces only the matching masked suffix for display", () => {
  const masked = "CT-FT-***4519-***5630";
  const full = "12345675630";
  assert.equal(displayedStatementText(masked, masked, full), "CT-FT-***4519-12345675630");
  assert.equal(displayedStatementText(`Fee · ${masked}`, masked, full), "Fee · CT-FT-***4519-12345675630");
});

test("custom edits and conflicting evidence are never rewritten", () => {
  const masked = "CT-FT-***4519-***5630";
  assert.equal(displayedStatementText("My edited note", masked, "12345675630"), "My edited note");
  assert.equal(displayedStatementText(masked, masked, "12345679999"), masked);
  assert.equal(displayedStatementText(masked, masked, "***5630"), masked);
});
