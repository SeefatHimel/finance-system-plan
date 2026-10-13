const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-review-feedback-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/review-status.ts', 'lib/form-feedback.ts', 'lib/review-filters.ts', 'lib/review-drafts.ts'], { cwd: resolve(__dirname, '..') });
const { reviewFieldErrors, reviewNotes, validReviewCount } = require(join(output, 'review-status.js'));
const { RequestError, responseError } = require(join(output, 'api-errors.js'));
const { fieldErrorsFrom, focusFieldError, nativeFieldErrors } = require(join(output, 'form-feedback.js'));
after(() => rmSync(output, { recursive: true, force: true }));
const valid = { account: 'demo-bank', other: '', amount: '125.50', type: 'expense', category: 'demo-category' };

test('corrected draft clears missing account and amount immediately without changing parser values', () => {
  const parsed = { ...valid, account: '', amount: '' };
  assert.deepEqual(Object.keys(reviewFieldErrors(parsed)), ['account', 'amount']);
  assert.deepEqual(reviewFieldErrors({ ...parsed, account: 'demo-bank', amount: '1,250.50' }), {});
  assert.equal(parsed.account, ''); assert.equal(parsed.amount, '');
});
test('only transfers require a distinct second account; category and confidence remain review notes', () => {
  assert.deepEqual(reviewFieldErrors({ ...valid, category: '' }), {});
  assert.deepEqual(reviewNotes('0.42', '', 'expense'), ['Check source SMS', 'Uncategorized']);
  assert.ok(reviewFieldErrors({ ...valid, type: 'transfer' }).transfer_account);
  assert.ok(reviewFieldErrors({ ...valid, type: 'transfer', other: valid.account }).transfer_account);
  assert.deepEqual(reviewFieldErrors({ ...valid, type: 'transfer', other: 'demo-wallet' }), {});
  assert.deepEqual(reviewFieldErrors({ ...valid, other: valid.account }), {});
});
test('ready status rejects values that the financial API cannot accept', () => {
  for (const amount of ['', '0', '-10', 'NaN', 'Infinity', '0x10', '1e3', '12.345', 'abc']) {
    assert.ok(reviewFieldErrors({ ...valid, amount }).amount, amount);
  }
  for (const amount of ['0.01', ' 1,234.56 ', '12']) assert.deepEqual(reviewFieldErrors({ ...valid, amount }), {});
});
test('queue notifications cannot expose another user count or accept malformed counts', () => {
  assert.equal(validReviewCount({ owner: 7, count: 0 }, 7), true);
  for (const value of [{ owner: 8, count: 3 }, { owner: 7, count: -1 }, { owner: 7, count: 1.5 }, { owner: 7, count: '3' }, null]) assert.equal(validReviewCount(value, 7), false);
  assert.equal(validReviewCount({ owner: 7, count: 3 }, null), false);
});
test('server validation retains individual fields and global messages; server failures remain private', async () => {
  const failure = await responseError(new Response(JSON.stringify({ amount: ['Must be positive.'], reported_balances: [{ balance_after: ['Use two decimals.'] }], non_field_errors: ['This linked entry changed.'] }), { status: 400 }));
  assert.ok(failure instanceof RequestError);
  assert.deepEqual(fieldErrorsFrom(failure), { amount: 'Must be positive.', reported_balances: 'Use two decimals.' });
  assert.match(failure.message, /linked entry changed/);
  const server = await responseError(new Response(JSON.stringify({ amount: ['private diagnostic'] }), { status: 500 }));
  assert.deepEqual(fieldErrorsFrom(server), {}); assert.doesNotMatch(server.message, /private diagnostic/);
});
test('validation reveals a collapsed detail before focusing its invalid control', () => {
  const saved = Object.fromEntries(['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLDetailsElement'].map(key => [key, global[key]]));
  class Element {}
  class Input extends Element {}
  class Select extends Element {}
  class Textarea extends Element {}
  class Details extends Element {}
  Object.assign(global, { HTMLElement: Element, HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea, HTMLDetailsElement: Details });
  try {
    const form = {}, details = Object.assign(new Details(), { open: false, parentElement: form });
    let focused = false, scrolled = false;
    const input = Object.assign(new Input(), { name: 'reference', parentElement: details, willValidate: true, validity: { valid: false }, validationMessage: 'Reference is too long.', focus() { assert.equal(details.open, true); focused = true; }, scrollIntoView() { scrolled = true; } });
    form.elements = [input];
    const errors = nativeFieldErrors(form);
    assert.deepEqual(errors, { reference: 'Reference is too long.' });
    focusFieldError(form, errors); assert.equal(focused, true); assert.equal(scrolled, true);
    focusFieldError(null, errors); // Closing the editor during a failed request is safe.
  } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete global[key] : global[key] = value; }
});

const { confidenceValue, confidenceRangeError, matchesConfidence, matchesReviewCondition, reviewSummary, canFindTransferMatch, reviewConditions } = require(join(output, 'review-filters.js'));
const message = { confidence: '0.9', transaction_type: 'expense', message_kind: 'card_purchase', possible_internal_transfer: false, possible_related_candidate: null, related_match_reason: '', identity_suggestions: [], raw_message: { duplicate_of: null, status: 'received', body: 'Synthetic test notification' } };
test('confidence bands have exact boundaries, inclusive custom limits and explicit unknown scores', () => {
  for (const value of ['', 'NaN', 'Infinity', '-0.1', '1.1']) assert.equal(confidenceValue(value), null);
  for (const [score, band] of [['0', 'low'], ['0.6499', 'low'], ['0.65', '65'], ['0.8499', '65'], ['0.85', '85'], ['0.8999', '85'], ['0.9', '90'], ['1', '90']]) {
    assert.equal(matchesConfidence(score, band), true);
    for (const other of ['low', '65', '85', '90'].filter(value => value !== band)) assert.equal(matchesConfidence(score, other), false);
  }
  assert.equal(matchesConfidence('', 'unknown'), true);
  assert.equal(matchesConfidence('', 'custom'), false);
  assert.equal(matchesConfidence('0.85', 'custom', '85', '90'), true);
  assert.equal(matchesConfidence('0.9', 'custom', '85', '90'), true);
  assert.equal(matchesConfidence('0.9001', 'custom', '85', '90'), false);
  assert.equal(confidenceRangeError('', ''), '');
  assert.ok(confidenceRangeError('91', '90')); assert.ok(confidenceRangeError('-1', '100'));
  assert.equal(matchesConfidence('0.3', 'custom', '91', '90'), true, 'invalid custom filter does not silently hide rows');
});
test('pending conditions distinguish corrections, evidence and available actions', () => {
  const cases = {
    ready: [message, valid], missing: [message, { ...valid, amount: '' }], amount: [message, { ...valid, amount: '0' }], account: [message, { ...valid, account: '' }],
    transfer_account: [message, { ...valid, type: 'transfer' }], same_accounts: [message, { ...valid, type: 'transfer', other: valid.account }], uncategorized: [message, { ...valid, category: '' }],
    verify_account: [{ ...message, identity_suggestions: [{ role: 'sender' }] }, valid], duplicate: [{ ...message, raw_message: { ...message.raw_message, duplicate_of: 'synthetic-id' } }, valid],
    related: [{ ...message, possible_related_candidate: 'synthetic-id' }, valid], notes: [{ ...message, confidence: '0.4' }, valid], unknown: [{ ...message, message_kind: 'unknown' }, valid],
    non_transaction: [{ ...message, message_kind: 'promotional' }, valid], match: [message, { ...valid, type: 'transfer' }], reparse: [message, valid], redact: [message, valid],
    unavailable: [{ ...message, raw_message: { ...message.raw_message, status: 'redacted' } }, valid]
  };
  for (const { value } of reviewConditions) assert.equal(matchesReviewCondition(...cases[value], value), true, value);
  assert.equal(matchesReviewCondition(message, valid, 'duplicate'), false);
  assert.equal(matchesReviewCondition(message, valid, 'related'), false);
  assert.equal(matchesReviewCondition(message, valid, 'missing'), false);
  assert.equal(matchesReviewCondition(message, { ...valid, type: 'expense', other: valid.account }, 'same_accounts'), false);
  assert.equal(matchesReviewCondition({ ...message, raw_message: { ...message.raw_message, body: null } }, valid, 'reparse'), false);
});
test('status uses correction precedence and never displays a ready warning', () => {
  assert.equal(reviewSummary(message, valid).tone, 'ready');
  const duplicate = { ...message, raw_message: { ...message.raw_message, duplicate_of: 'synthetic-id' } };
  assert.equal(reviewSummary(duplicate, valid).title, 'Verify possible duplicate');
  assert.equal(reviewSummary(duplicate, { ...valid, amount: '' }).title, '1 correction needed');
  assert.equal(reviewSummary({ ...message, possible_related_candidate: 'synthetic-id' }, valid).tone, 'info');
  assert.equal(reviewSummary({ ...message, confidence: '0.4' }, valid).tone, 'warning');
});
test('match lookup eligibility follows explicit type corrections and source hints', () => {
  assert.equal(canFindTransferMatch(message, valid), false);
  assert.equal(canFindTransferMatch(message, { ...valid, type: 'transfer' }), true);
  const incoming = { ...message, transaction_type: 'income', message_kind: 'bank_transfer_in' };
  assert.equal(canFindTransferMatch(incoming, { ...valid, type: 'income' }), true);
  assert.equal(canFindTransferMatch(incoming, { ...valid, type: 'expense' }), false);
});

const { createReviewDrafts } = require(join(output, 'review-drafts.js'));
test('temporary filter exclusion and message navigation retain sparse native drafts without cross-message leakage', () => {
  const drafts = createReviewDrafts();
  drafts.capture('first', 'reference', 'SYNTHETIC-DRAFT');
  drafts.capture('first', 'note', '');
  drafts.capture('first', 'date', '2026-01-02');
  drafts.capture('first', 'remember_mapping', false);
  assert.equal(drafts.text('first', 'reference', 'parsed'), 'SYNTHETIC-DRAFT');
  assert.equal(drafts.text('first', 'note', 'parsed'), '');
  assert.equal(drafts.text('first', 'date', 'parsed'), '2026-01-02');
  assert.equal(drafts.remember('first'), false);
  assert.equal(drafts.text('second', 'reference', 'other parsed'), 'other parsed');
  assert.equal(drafts.remember('second'), true);
});
test('parser resets discard only their own drafts; bulk resets and new workspaces retain no previous edits', () => {
  const drafts = createReviewDrafts();
  drafts.capture('first', 'reference', 'first edit'); drafts.capture('second', 'reference', 'second edit');
  drafts.capture('second', 'amount', '123'); drafts.capture('second', 'balance_after', '999');
  drafts.reset('first');
  assert.equal(drafts.text('first', 'reference', 'refreshed'), 'refreshed');
  assert.equal(drafts.text('second', 'reference', 'parsed'), 'second edit');
  assert.equal(drafts.text('second', 'balance_after', 'account-bound balance'), 'account-bound balance');
  assert.equal(drafts.text('second', 'amount', 'controlled amount'), 'controlled amount');
  drafts.reset(); assert.equal(drafts.text('second', 'reference', 'refreshed'), 'refreshed');
  assert.equal(createReviewDrafts().text('second', 'reference', 'new session'), 'new session');
});
