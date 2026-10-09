const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-date-health-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/date-period.ts', 'lib/backend-heartbeat.ts'], { cwd: resolve(__dirname, '..') });
const { allDates, dailyPeriod, monthPeriod, shiftPeriod, dateRangeError, dateInPeriod, periodFromFilters, periodBounds } = require(join(output, 'date-period.js'));
const { startBackendHeartbeat, heartbeatIntervalMs } = require(join(output, 'backend-heartbeat.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('calendar navigation handles leap days, month lengths and year boundaries', () => {
  assert.deepEqual(monthPeriod('2024-02'), { mode: 'monthly', start: '2024-02-01', end: '2024-02-29' });
  assert.equal(monthPeriod('2026-02').end, '2026-02-28');
  assert.equal(shiftPeriod(dailyPeriod('0001-01-01'), -1).start, '0001-01-01');
  assert.equal(shiftPeriod(monthPeriod('9999-12'), 1).start, '9999-12-01');
  assert.equal(shiftPeriod(monthPeriod('2026-12'), 1).start, '2027-01-01');
  assert.equal(shiftPeriod(dailyPeriod('2024-03-01'), -1).start, '2024-02-29');
  assert.equal(shiftPeriod(dailyPeriod('2026-01-01'), -1).start, '2025-12-31');
});

test('ranges reject malformed, reversed and oversized dates and include both boundaries', () => {
  for (const [start, end] of [['0000-01-01','0000-01-02'], ['2026-02-30','2026-03-01'], ['2026-02-02','2026-02-01'], ['','2026-01-01'], ['2025-01-01','2026-01-02']]) assert(dateRangeError(start, end));
  assert.equal(dateRangeError('2024-01-01', '2024-12-31'), '');
  const period = { mode: 'custom', start: '2026-01-02', end: '2026-01-05' };
  assert(dateInPeriod('2026-01-02', period)); assert(dateInPeriod('2026-01-05', period));
  assert(!dateInPeriod('2026-01-06', period)); assert(!dateInPeriod(null, period));
  assert(dateInPeriod(null, allDates));
});

test('URL filters restore daily/custom/monthly views and all-dates omits API bounds', () => {
  assert.equal(periodFromFilters({ month: '2026-02' }).mode, 'monthly');
  assert.equal(periodFromFilters({ start_date: '2026-02-01', end_date: '2026-02-01' }).mode, 'daily');
  assert.equal(periodFromFilters({ start_date: '2026-02-01', end_date: '2026-02-01' }, 'custom').mode, 'custom');
  assert.deepEqual(periodBounds(allDates), {});
  assert.deepEqual(periodBounds(dailyPeriod('2026-02-01')), { start_date: '2026-02-01', end_date: '2026-02-01' });
});

test('heartbeat checks immediately and every ten minutes; recent successes suppress other tabs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 });
  let calls = 0, success = 0;
  const heartbeat = startBackendHeartbeat({ ping: async () => { calls++; }, online: () => true, lastSuccess: () => success, recordSuccess: time => { success = time; } });
  await Promise.resolve();
  assert.equal(calls, 1);
  await heartbeat.check(); assert.equal(calls, 1);
  t.mock.timers.tick(heartbeatIntervalMs); await Promise.resolve(); assert.equal(calls, 2);
  heartbeat.stop(); t.mock.timers.tick(heartbeatIntervalMs); assert.equal(calls, 2);
});

test('offline checks wait for reconnection, failures are quiet, and cleanup aborts pending work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let online = false, calls = 0, signal;
  const heartbeat = startBackendHeartbeat({ online: () => online, ping: async () => { calls++; throw new Error('offline'); } });
  await heartbeat.check(); assert.equal(calls, 0);
  online = true; await heartbeat.check(); assert.equal(calls, 1);
  heartbeat.stop();
  const pending = startBackendHeartbeat({ online: () => true, ping: async next => { calls++; signal = next; await new Promise(resolve => next.addEventListener('abort', resolve, { once: true })); } });
  await pending.check(); assert.equal(calls, 2); // A second call cannot overlap the pending request.
  pending.stop(); assert(signal.aborted);
  await Promise.resolve(); t.mock.timers.tick(heartbeatIntervalMs); assert.equal(calls, 2);
});

test('health requests time out and do not record an aborted check as healthy', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let signal, success = false;
  const heartbeat = startBackendHeartbeat({ online: () => true, recordSuccess: () => { success = true; }, ping: async next => {
    signal = next; await new Promise(resolve => next.addEventListener('abort', resolve, { once: true }));
  } });
  t.mock.timers.tick(20_000); await Promise.resolve(); assert(signal.aborted); assert(!success);
  heartbeat.stop();
});

test('request latency and late-opening tabs do not postpone the next check beyond ten minutes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0, success = 0, finish;
  const first = startBackendHeartbeat({ online: () => true, lastSuccess: () => success, recordSuccess: time => { success = time; }, ping: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  t.mock.timers.tick(5000); finish(); await Promise.resolve();
  assert.equal(success, 1000);
  t.mock.timers.tick(heartbeatIntervalMs - 5000); assert.equal(calls, 2);
  first.stop(); finish(); await Promise.resolve();
  success = Date.now();
  t.mock.timers.tick(heartbeatIntervalMs - 60_000);
  const second = startBackendHeartbeat({ online: () => true, lastSuccess: () => success, ping: async () => { calls++; } });
  assert.equal(calls, 2);
  t.mock.timers.tick(60_000); await Promise.resolve(); assert.equal(calls, 3);
  second.stop();
});
