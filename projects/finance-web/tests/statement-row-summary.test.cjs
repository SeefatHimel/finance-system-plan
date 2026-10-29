const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const shim = { exports: {} };
new Function('module', 'exports', ts.transpileModule(readFileSync(resolve(__dirname, '../lib/statement-row-summary.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText)(shim, shim.exports);
const { distinctStatementNote, statementRowSummary } = shim.exports;
const row = (changes = {}, reviewChanges = {}) => ({
  id: 'row', state: 'pending', transaction: null, amount: '100.00', date: '2026-01-02', direction: 'debit', reviewed_source_direction: null,
  extracted: { direction: 'debit' },
  ...changes,
  review: { matches: [], issues: [], draft_issues: [], review_state: 'new', matching_truncated: false, requires_acknowledgement: false, pending_sms_match_count: 0, unified_pending_sms_status: 'none', ...reviewChanges },
});
test('duplicate notes are omitted without changing source text', () => {
  assert.equal(distinctStatementNote('Synthetic Merchant', ' synthetic   merchant '), '');
  assert.equal(distinctStatementNote('Synthetic Merchant', 'Useful separate note'), 'Useful separate note');
});
test('ready, linked and skipped decisions stay clear in compact rows', () => {
  assert.equal(statementRowSummary(row()).status, 'Ready');
  assert.equal(statementRowSummary(row({ transaction: 'ledger', state: 'linked' })).status, 'Already linked');
  assert.equal(statementRowSummary(row({ state: 'skipped' })).status, 'Skipped');
});
test('known ledger/SMS matches are counted once and unavailable counts are never zero', () => {
  assert.equal(statementRowSummary(row({}, { matches: [{ date: '2026-01-02' }], pending_sms_match_count: 2 })).matchLabel, 'View 3 matches');
  assert.equal(statementRowSummary(row({}, { unified_pending_sms_status: 'unique', unified_pending_sms_pair_id: 'sms', pending_sms_match_count: 0 })).matchLabel, 'View 1 match');
  assert.equal(statementRowSummary(row({}, { unified_pending_sms_status: 'unique', unified_pending_sms_pair_id: 'sms', pending_sms_match_count: null })).matchLabel, 'Review matches');
  const unavailable = statementRowSummary(row({}, { pending_sms_match_count: null, unified_pending_sms_status: 'unavailable' }));
  assert.equal(unavailable.status, 'Needs review');
  assert.equal(unavailable.matchLabel, 'Review matches');
  assert.ok(unavailable.flags.includes('SMS check unavailable'));
});
test('compacting never hides direction, amount, date, match or draft conflicts', () => {
  const source = row({ direction: 'credit' }, { matches: [{ conflict: true, rounding_correction: {}, date: '2026-01-03' }], requires_acknowledgement: true });
  const snapshot = JSON.stringify(source);
  const result = statementRowSummary(source);
  assert.equal(result.status, 'Needs review');
  for (const warning of ['Debit/credit mismatch', 'Amount differs', 'Dates differ', 'Match conflict', 'Source / draft issue']) assert.ok(result.flags.includes(warning), warning);
  assert.equal(JSON.stringify(source), snapshot);
});
test('partial matching does not claim an exact total or a clean result', () => {
  const result = statementRowSummary(row({}, { matching_truncated: true, matches: [{ date: '2026-01-02' }] }));
  assert.equal(result.status, 'Needs review');
  assert.equal(result.matchLabel, 'Review matches');
  assert.ok(result.flags.includes('More matches unchecked'));
});
