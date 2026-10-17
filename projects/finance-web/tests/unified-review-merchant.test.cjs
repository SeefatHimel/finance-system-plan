const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const source = readFileSync(resolve(__dirname, "../lib/unified-review-merchant.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const shim = { exports: {} };
new Function("module", "exports", compiled)(shim, shim.exports);
const { initialUnifiedMerchant, initialUnifiedNote, merchantNoteSuggestion } = shim.exports;

const raw = "CT-FT-***8509-***9710";
function row(counterparty, suggestion) {
  return {
    counterparty_text: counterparty,
    extracted: { description: raw },
    review: { suggestion: suggestion ? { counterparty_text: suggestion } : null },
  };
}

test("saved code mapping prefills a raw Citytouch merchant in combined review", () => {
  assert.equal(initialUnifiedMerchant(row(raw, "HPL Board"), "Cash out"), "HPL Board");
  assert.equal(initialUnifiedMerchant(row("", "HPL Board"), "Cash out"), "HPL Board");
});

test("manual merchant corrections and unmapped rows keep their current behavior", () => {
  assert.equal(initialUnifiedMerchant(row("Chosen merchant", "HPL Board"), "Cash out"), "Chosen merchant");
  assert.equal(initialUnifiedMerchant(row(raw, null), "Cash out"), raw);
  assert.equal(initialUnifiedMerchant(row("", null), "Cash out"), "Cash out");
});

test("bKash recipient mapping suggests its verified name and note without replacing edits", () => {
  const description = "01999990001 / TRX ID: SYNTHETIC";
  const pending = {
    counterparty_text: "01999990001",
    note: description,
    extracted: { description },
    review: { suggestion: { counterparty_text: "Known recipient", note: "Send Money · Known recipient" } },
  };
  assert.equal(initialUnifiedMerchant(pending, "SMS detail"), "Known recipient");
  assert.equal(initialUnifiedNote(pending, "SMS detail"), "Send Money · Known recipient");
  assert.equal(initialUnifiedNote({ ...pending, note: "My edited note" }, "SMS detail"), "My edited note");
  assert.equal(initialUnifiedMerchant({ ...pending, counterparty_text: "My edited name" }, "SMS detail"), "My edited name");
});

test("merchant note suggestion uses the current merchant without proposing a masked bank code", () => {
  assert.equal(merchantNoteSuggestion(" HPL Board ", raw), "HPL Board");
  assert.equal(merchantNoteSuggestion("North End Coffee", "Custom note"), "North End Coffee");
  assert.equal(merchantNoteSuggestion("North End Coffee", "North End Coffee"), null);
  assert.equal(merchantNoteSuggestion(raw, "Cash out"), null);
  assert.equal(merchantNoteSuggestion("CARD ****9710", "Cash out"), null);
  assert.equal(merchantNoteSuggestion("123456789012", "Cash out"), null);
});
