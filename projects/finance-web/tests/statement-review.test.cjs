const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-statement-review-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/statement-review.ts'], { cwd: resolve(__dirname, '..') });
const { statementLinkBlockReason, statementBalanceDifference } = require(join(output, 'statement-review.js'));
after(() => rmSync(output, { recursive: true, force: true }));
const ready = { dirty: false, canLink: true, requiresAcknowledgement: false, issuesAcknowledged: false, conflict: false, balanceChosen: false };

test('linking requires fresh saved matches, source acknowledgement and a balance choice', () => {
  assert.equal(statementLinkBlockReason(ready), null);
  assert.match(statementLinkBlockReason({ ...ready, dirty: true, balanceChosen: true }), /Save your draft/);
  assert.match(statementLinkBlockReason({ ...ready, canLink: false, balanceChosen: true }), /cannot be linked/);
  assert.match(statementLinkBlockReason({ ...ready, requiresAcknowledgement: true, balanceChosen: true }), /source discrepancies/);
  assert.match(statementLinkBlockReason({ ...ready, conflict: true, issuesAcknowledged: true }), /Choose which reported balance/);
  assert.equal(statementLinkBlockReason({ ...ready, requiresAcknowledgement: true, issuesAcknowledged: true, conflict: true, balanceChosen: true }), null);
  // A non-conflicting alternative needs no balance choice.
  assert.equal(statementLinkBlockReason({ ...ready, issuesAcknowledged: true }), null);
});

test('reported balance differences retain exact cents, sign, zero and unknown values', () => {
  assert.equal(statementBalanceDifference('900.07', '900.00'), '+0.07');
  assert.equal(statementBalanceDifference('0.29', '0.30'), '-0.01');
  assert.equal(statementBalanceDifference('100', '100.0'), '0.00');
  assert.equal(statementBalanceDifference('-0.01', '0.00'), '-0.01');
  assert.equal(statementBalanceDifference('999999999999.99', '-999999999999.99'), '+1999999999999.98');
  for (const value of [null, '', 'NaN', 'Infinity', '1.001', '1e3']) assert.equal(statementBalanceDifference(value, '0.00'), null);
});
