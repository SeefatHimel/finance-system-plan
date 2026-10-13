const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-review-feedback-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/review-status.ts', 'lib/form-feedback.ts'], { cwd: resolve(__dirname, '..') });
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
