const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-workflows-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--rootDir', '..', '--outDir', output, 'lib/api-errors.ts', 'lib/category-type.ts', 'lib/transaction-balances.ts', 'lib/latest-request.ts'], { cwd: resolve(__dirname, '..') });
const { responseError, fetchWithConnectionError } = require(join(output, 'finance-web/lib/api-errors.js'));
const { LatestRequest } = require(join(output, 'finance-web/lib/latest-request.js'));
const { editableReportedBalance } = require(join(output, 'finance-web/lib/transaction-balances.js'));
const { categoryTypeProposal, directionForType } = require(join(output, 'finance-web/lib/category-type.js'));
after(() => rmSync(output, { recursive: true, force: true }));
const error = (body, status = 400) => responseError(new Response(JSON.stringify(body), { status }));
const category = kind => ({ id: 'demo', name: 'Demo category', kind });

test('validation fields and detail become readable messages', async () => {
  assert.equal((await error({ amount: ['Enter a valid number.'], non_field_errors: ['Choose different accounts.'] })).message, 'Amount: Enter a valid number. Choose different accounts.');
  assert.equal((await error({ detail: 'This SMS is already recorded.' })).message, 'This SMS is already recorded.');
  assert.equal((await error({ payment_method: { account: ['Select a method for this account.'] } })).message, 'Payment method: Select a method for this account.');
  assert.equal((await error(['Try another value.', 'Try another value.'])).message, 'Try another value.');
});
test('unexpected bodies and server failures have safe actionable fallbacks', async () => {
  assert.equal((await responseError(new Response('<html>debug details</html>', { status: 400 }))).message, 'Check the entered details and try again.');
  for (const status of [500, 502, 503]) assert.equal((await error({ detail: 'Private server debug information' }, status)).message, 'The service is temporarily unavailable. Please try again.');
  assert.match((await error({}, 403)).message, /permission/);
  assert.match((await error({}, 404)).message, /Refresh/);
  assert.match((await error({}, 409)).message, /changed/);
  assert.match((await error({ detail: 'debug' }, 429)).message, /wait/);
  assert((await error({ detail: 'x'.repeat(1000) })).message.length <= 600);
});
test('connection and cancellation errors tell users what to do', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(fetchWithConnectionError('https://example.invalid'), /Check your connection/);
    global.fetch = async () => { throw new DOMException('Aborted', 'AbortError'); };
    await assert.rejects(fetchWithConnectionError('https://example.invalid'), /cancelled/);
  } finally { global.fetch = original; }
});
test('compatible subtypes and neutral categories do not propose reclassification', () => {
  for (const [kind, type] of [['expense','fee'], ['income','refund'], ['transfer','transfer'], ['debt','repayment_paid'], ['system','expense']]) assert.equal(categoryTypeProposal(category(kind), type), null);
  assert.equal(categoryTypeProposal(undefined, 'income'), null);
});
test('incompatible categories propose a type while debt requires a specific movement', () => {
  assert.deepEqual(categoryTypeProposal(category('income'), 'expense').options, ['income']);
  assert.deepEqual(categoryTypeProposal(category('expense'), 'transfer').options, ['expense']);
  assert.deepEqual(categoryTypeProposal(category('transfer'), 'expense').options, ['transfer']);
  assert.deepEqual(categoryTypeProposal(category('debt'), 'expense').options, ['lend', 'borrow', 'repayment_received', 'repayment_paid']);
  for (const type of ['income','refund','borrow','repayment_received']) assert.equal(directionForType(type), 'credit');
  for (const type of ['expense','fee','transfer','adjustment','lend','repayment_paid']) assert.equal(directionForType(type), 'debit');
});

test('editing loads stored balances or the primary transfer report, including zero', () => {
  const record = {type: 'transfer', balance_after: null, transfer_evidence: [
    {is_primary: false, balance_after: '3000.00'}, {is_primary: true, balance_after: '9000.00'}
  ]};
  assert.equal(editableReportedBalance(record), '9000.00');
  assert.equal(editableReportedBalance({...record, balance_after: '0.00'}), '0.00');
  assert.equal(editableReportedBalance({...record, type: 'expense'}), '');
  assert.equal(editableReportedBalance({...record, transfer_evidence: [{is_primary: false, balance_after: '3000.00'}]}), '');
  assert.equal(editableReportedBalance({...record, transfer_evidence: [{is_primary: true, balance_after: '0.00'}]}), '0.00');
});

test('rapid navigation debounces to the last choice and cancel removes queued work', (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const requests = new LatestRequest();
  const calls = [];
  requests.schedule(() => calls.push('first'), 250);
  t.mock.timers.tick(100);
  requests.schedule(() => calls.push('second'), 250);
  t.mock.timers.tick(100);
  requests.schedule(() => calls.push('last'), 250);
  t.mock.timers.tick(249);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['last']);
  requests.schedule(() => calls.push('unmounted'), 250);
  requests.cancel();
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, ['last']);
});
test('late responses and finalizers cannot overwrite the latest request', async () => {
  const requests = new LatestRequest();
  let resolveOld, resolveNew, oldTicket;
  const oldData = new Promise(resolve => {resolveOld = resolve;});
  const newData = new Promise(resolve => {resolveNew = resolve;});
  const published = [];
  const collect = async (ticket, data) => {
    try {
      const value = await data;
      if (ticket.isCurrent()) published.push(value);
    } finally {
      if (ticket.isCurrent()) published.push('finished');
    }
  };
  const old = requests.run(ticket => {oldTicket = ticket; return collect(ticket, oldData);});
  const current = requests.run(ticket => collect(ticket, newData));
  assert(oldTicket.signal.aborted);
  assert(!oldTicket.isCurrent());
  resolveNew('latest'); await current;
  resolveOld('stale'); await old;
  assert.deepEqual(published, ['latest', 'finished']);
});
test('explicit filter application cancels a pending month debounce', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const requests = new LatestRequest(); const calls = [];
  requests.schedule(() => calls.push('queued month'), 250);
  await requests.run(async ticket => {assert(ticket.isCurrent()); calls.push('apply filters');});
  t.mock.timers.tick(1000);
  assert.deepEqual(calls, ['apply filters']);
});
test('new navigation aborts active work before its debounce fires', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const requests = new LatestRequest();
  let oldTicket, complete;
  const pending = requests.run(ticket => {
    oldTicket = ticket;
    return new Promise(resolve => {complete = resolve;});
  });
  const calls = [];
  requests.schedule(() => calls.push('new month'), 250);
  assert(oldTicket.signal.aborted);
  assert(!oldTicket.isCurrent());
  t.mock.timers.tick(249);
  assert.deepEqual(calls, []);
  complete(); await pending;
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['new month']);
});
