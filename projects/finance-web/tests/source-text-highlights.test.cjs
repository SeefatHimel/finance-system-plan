const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(resolve(__dirname, '../lib/source-text-highlights.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const moduleShim = { exports: {} };
new Function('module', 'exports', compiled)(moduleShim, moduleShim.exports);
const { sourceTextParts } = moduleShim.exports;

test('highlights exact source facts across bank SMS formatting', () => {
  const parts = sourceTextParts(
    'Cash WD BDT20,000 from EBL. Card 447780**5025 on 25-Jul-26. Balance BDT 743,678.60.',
    { amount: '20000.00', balanceAfter: '743678.60', date: '2026-07-25', identifiers: ['447780**5025'], direction: 'debit' },
  );
  assert.deepEqual(parts.filter(part => part.highlight).map(part => [part.text, part.highlight.label]), [
    ['Cash WD', 'Debit wording'], ['20,000', 'Amount'], ['447780**5025', 'Account or card'],
    ['25-Jul-26', 'Date'], ['743,678.60', 'Reported balance after'],
  ]);
  assert.equal(parts.map(part => part.text).join(''), 'Cash WD BDT20,000 from EBL. Card 447780**5025 on 25-Jul-26. Balance BDT 743,678.60.');
});

test('does not claim a value appears in a different or redacted source', () => {
  const parts = sourceTextParts('Amount 120000, balance hidden, unpaid. Credit Card.', {
    amount: '20000.00', balanceAfter: '500.00', direction: 'debit',
  });
  assert.deepEqual(parts.filter(part => part.highlight), []);
});

test('does not treat the word credit in a card name as incoming-money evidence', () => {
  const parts = sourceTextParts('Credit Card 1234', { direction: 'credit' });
  assert.deepEqual(parts.filter(part => part.highlight), []);
});
