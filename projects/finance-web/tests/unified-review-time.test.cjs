const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const moduleShim = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync(resolve(__dirname, '../lib/unified-review-time.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(moduleShim, moduleShim.exports);
const { proposedPairTime, timeAfterPairDateChange } = moduleShim.exports;

test('a printed statement time takes precedence over the SMS received time', () => {
  assert.equal(proposedPairTime('2026-01-02', '12:00:00', '2026-01-02', '12:04:00'), '12:00:00');
});

test('SMS received time is suggested only for an aligned or unknown statement date', () => {
  assert.equal(proposedPairTime('2026-01-02', null, '2026-01-02', '12:04:00'), '12:04:00');
  assert.equal(proposedPairTime(null, null, '2026-01-02', '12:04:00'), '12:04:00');
  assert.equal(proposedPairTime('2026-01-01', null, '2026-01-02', '12:04:00'), null);
});

test('moving the result to another date clears an inferred SMS time', () => {
  assert.equal(timeAfterPairDateChange(null, '12:04:00', '2026-01-03', '2026-01-02', '12:04:00'), null);
  assert.equal(timeAfterPairDateChange(null, '12:04:00', '2026-01-02', '2026-01-02', '12:04:00'), '12:04:00');
  assert.equal(timeAfterPairDateChange(null, '12:05:00', '2026-01-03', '2026-01-02', '12:04:00'), '12:05:00');
  assert.equal(timeAfterPairDateChange('12:04:00', '12:04:00', '2026-01-03', '2026-01-02', '12:04:00'), '12:04:00');
});
