const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-statement-review-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/statement-review.ts'], { cwd: resolve(__dirname, '..') });
const { calendarDayDifference, statementAddBlockers, statementLinkBlockReason, statementBalanceDifference, insignificantBdtBalanceDifference, reportedBalanceNeedsAcknowledgment, suggestedBalanceSource } = require(join(output, 'statement-review.js'));
after(() => rmSync(output, { recursive: true, force: true }));
const ready = { dirty: false, canLink: true, requiresAcknowledgement: false, issuesAcknowledged: false, conflict: false, balanceChosen: false };

test('linking requires fresh saved matches, source acknowledgement and a balance choice', () => {
  assert.equal(statementLinkBlockReason(ready), null);
  assert.match(statementLinkBlockReason({ ...ready, dirty: true, balanceChosen: true }), /Save your draft/);
  assert.match(statementLinkBlockReason({ ...ready, canLink: false, balanceChosen: true }), /cannot be linked/);
  assert.match(statementLinkBlockReason({ ...ready, requiresAcknowledgement: true, balanceChosen: true }), /source discrepancies/);
  assert.match(statementLinkBlockReason({ ...ready, conflict: true, issuesAcknowledged: true }), /Choose which reported balance/);
  assert.match(statementLinkBlockReason({ ...ready, categoryConflict: true }), /Choose which category/);
  assert.equal(statementLinkBlockReason({ ...ready, categoryConflict: true, categoryChosen: true }), null);
  assert.match(statementLinkBlockReason({ ...ready, conflict: true, categoryConflict: true }), /reported balance.*Choose which category/);
  assert.equal(statementLinkBlockReason({ ...ready, requiresAcknowledgement: true, issuesAcknowledged: true, conflict: true, balanceChosen: true }), null);
  // A non-conflicting alternative needs no balance choice.
  assert.equal(statementLinkBlockReason({ ...ready, issuesAcknowledged: true }), null);
});

test('disabled Add explains the saved-row gates and the next action', () => {
  const addReady = { dirty: false, issues: [], pendingSmsMatchCount: 0, unifiedPendingSmsStatus: 'none', requiresAcknowledgement: false, issuesAcknowledged: false, classificationConfirmed: false };
  assert.deepEqual(statementAddBlockers(addReady), []);
  assert.deepEqual(statementAddBlockers({ ...addReady, issues: ['Review the transfer wording and confirm whether this involves your own accounts.'] }), [
    'Check Reviewed transaction type to confirm whether this involves your own accounts, then save the draft.',
  ]);
  assert.deepEqual(statementAddBlockers({ ...addReady, dirty: true }), ['Save draft & refresh matches before adding.']);
  assert.deepEqual(statementAddBlockers({ ...addReady, dirty: true, classificationConfirmed: true, issues: ['Review the transfer wording and confirm whether this involves your own accounts.'] }), ['Save draft & refresh matches before adding.']);
  assert.deepEqual(statementAddBlockers({ ...addReady, issues: ['Choose the other owned account for this transfer.'] }), ['Choose the other owned account for this transfer.']);
  assert.deepEqual(statementAddBlockers({ ...addReady, pendingSmsMatchCount: null, unifiedPendingSmsStatus: 'unavailable', requiresAcknowledgement: true }), [
    'Pending SMS matching is unavailable. Resolve pending messages or narrow the review period, then reopen this row.',
    'Check the source and draft discrepancy confirmation in the form.',
  ]);
});

test('reported balance differences retain exact cents, sign, zero and unknown values', () => {
  assert.equal(statementBalanceDifference('900.07', '900.00'), '+0.07');
  assert.equal(statementBalanceDifference('0.29', '0.30'), '-0.01');
  assert.equal(statementBalanceDifference('100', '100.0'), '0.00');
  assert.equal(statementBalanceDifference('-0.01', '0.00'), '-0.01');
  assert.equal(statementBalanceDifference('999999999999.99', '-999999999999.99'), '+1999999999999.98');
  for (const value of [null, '', 'NaN', 'Infinity', '1.001', '1e3']) assert.equal(statementBalanceDifference(value, '0.00'), null);
});

test('only nonzero BDT differences below one taka skip extra conflict acknowledgment', () => {
  assert.equal(insignificantBdtBalanceDifference('714041.33', '714041.00', 'BDT'), true);
  assert.equal(insignificantBdtBalanceDifference('99.01', '100.00', 'BDT'), true);
  assert.equal(insignificantBdtBalanceDifference('99.00', '100.00', 'BDT'), false);
  assert.equal(insignificantBdtBalanceDifference('100.00', '100.00', 'BDT'), false);
  assert.equal(insignificantBdtBalanceDifference('99.99', '100.00', 'USD'), false);
  assert.equal(insignificantBdtBalanceDifference(null, '100.00', 'BDT'), false);
  assert.equal(reportedBalanceNeedsAcknowledgment('714041.33', '714041.00', 'BDT'), false);
  assert.equal(reportedBalanceNeedsAcknowledgment('99.00', '100.00', 'BDT'), true);
  assert.equal(reportedBalanceNeedsAcknowledgment('100', '100.00', 'BDT'), false);
  assert.equal(reportedBalanceNeedsAcknowledgment('99.99', '100.00', 'USD'), true);
});

test('combined review suggests the higher eligible report without rounding', () => {
  assert.equal(suggestedBalanceSource('714041.33', '714041.00'), 'statement');
  assert.equal(suggestedBalanceSource('99.99', '100.00'), 'sms');
  assert.equal(suggestedBalanceSource('-1.00', '-0.50'), 'sms');
  assert.equal(suggestedBalanceSource('999999999999.99', '999999999999.98'), 'statement');
  assert.equal(suggestedBalanceSource('100', '100.00'), 'sms');
  assert.equal(suggestedBalanceSource(null, '0.00'), 'sms');
  assert.equal(suggestedBalanceSource('0.00', null), 'statement');
  assert.equal(suggestedBalanceSource(null, null), 'statement');
  assert.equal(suggestedBalanceSource('110.00', '100.00', true), 'sms');
  assert.equal(suggestedBalanceSource('110.00', null, true), '');
});

// Printed dates must stay calendar dates across browser zones and DST boundaries.
test('source date differences are signed calendar days and reject unavailable or invalid dates', () => {
  assert.equal(calendarDayDifference('2026-01-02', '2026-01-05'), 3);
  assert.equal(calendarDayDifference('2026-01-05', '2026-01-02'), -3);
  assert.equal(calendarDayDifference('2026-03-08', '2026-03-09'), 1);
  assert.equal(calendarDayDifference('2024-02-28', '2024-03-01'), 2);
  assert.equal(calendarDayDifference('2026-10-17', '2026-10-17'), 0);
  for (const value of [null, '', '2026-02-30', '2026-1-02', 'not a date']) assert.equal(calendarDayDifference(value, '2026-01-05'), null);
});

test('filling a linked missing balance selects an agreed or sole report, never the higher conflicting one', () => {
  const { suggestedLinkedBalanceSource: choose } = require(join(output, 'statement-review.js'));
  assert.equal(choose('450.07', '450.07'), 'sms');
  assert.equal(choose('0.00', '0'), 'sms');
  assert.equal(choose('-0.07', null), 'sms');
  assert.equal(choose(null, '450.07'), 'statement');
  assert.equal(choose(null, null), '');
  assert.equal(choose('450.07', '450.14'), '');
  assert.equal(choose('450.14', '450.07'), '');
  assert.equal(choose('450.07', '450.14', false, 'BDT'), 'statement');
  assert.equal(choose('450.07', '450.14', false, 'USD'), '');
  assert.equal(choose(null, '450.07', true), '');
  assert.equal(choose('450.07', null, true), 'sms');
});

test('sub-taka source amounts use exact higher cents without chaining differences', () => {
  const { coalescedSourceAmount: choose, automaticBdtBalanceSource: balance } = require(join(output, 'statement-review.js'));
  assert.equal(choose(['100.00', '100.99'], 'BDT'), '100.99');
  assert.equal(choose(['100.99', '100.00'], 'BDT'), '100.99');
  assert.equal(choose(['100.00', '101.00'], 'BDT'), null);
  assert.equal(choose(['100.00', '100.90', '101.80'], 'BDT'), null);
  assert.equal(choose(['100.00', '100.01'], 'USD'), null);
  assert.equal(choose(['999999999999.99', '999999999999.98'], 'BDT'), '999999999999.99');
  assert.equal(balance({sms:'-0.50', statement:'-0.07'}, 'BDT'), 'statement');
  assert.equal(balance({sms:null, statement:'0.00'}, 'BDT'), null);
});
