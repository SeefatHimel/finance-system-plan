const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-report-cache-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/report-cache.ts'], { cwd: resolve(__dirname, '..') });
symlinkSync(resolve(__dirname, '../node_modules'), join(output, 'node_modules'), 'dir');
const { readReport, clearReportCache, invalidateReportCache, setReportCacheOwner, reportWriteCompleted, reportFreshTime } = require(join(output, 'report-cache.js'));
global.window = {};
after(() => { clearReportCache(); delete global.window; rmSync(output, {recursive:true,force:true}); });

test('concurrent consumers and revisits share a read; different filter/page keys do not', async () => {
  clearReportCache(); let calls = 0, finish;
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const one = readReport(['drill', {category:'a'}, 1], load);
  const two = readReport(['drill', {category:'a'}, 1], load);
  assert.equal(calls, 1); finish({amount:'12.30'});
  assert.deepEqual(await one, await two);
  await readReport(['drill', {category:'a'}, 1], load); assert.equal(calls, 1);
  await readReport(['drill', {category:'a'}, 2], async () => { calls++; return []; });
  await readReport(['drill', {category:'b'}, 1], async () => { calls++; return []; });
  assert.equal(calls, 3);
});

test('fresh reports are reused until five minutes and then read again', async () => {
  clearReportCache(); const original = Date.now; let now = original(), calls = 0;
  Date.now = () => now;
  try {
    const load = async () => ++calls;
    assert.equal(await readReport(['summary'], load), 1);
    now += reportFreshTime - 1;
    assert.equal(await readReport(['summary'], load), 1);
    now += 2;
    assert.equal(await readReport(['summary'], load), 2);
  } finally { Date.now = original; clearReportCache(); }
});

test('a pre-mutation response cannot repopulate the next cache generation', async () => {
  clearReportCache(); let finish;
  const old = readReport(['summary'], () => new Promise(resolve => { finish = resolve; }));
  invalidateReportCache();
  assert.equal(await readReport(['summary'], async () => 'new'), 'new');
  finish('old'); assert.equal(await old, 'old');
  assert.equal(await readReport(['summary'], async () => 'incorrect'), 'new');
});

test('writes and refresh invalidate reads; preview and GET leave them reusable', async () => {
  clearReportCache(); let calls = 0; const load = async () => ++calls;
  await readReport(['summary'], load);
  reportWriteCompleted('/api/reports/saved/preview/', 'POST');
  reportWriteCompleted('/api/reports/monthly/', 'GET');
  assert.equal(await readReport(['summary'], load), 1);
  reportWriteCompleted('/api/reports/saved/example/membership/', 'POST');
  assert.equal(await readReport(['summary'], load), 2);
  reportWriteCompleted('/api/transactions/example/', 'PATCH');
  assert.equal(await readReport(['summary'], load), 3);
  invalidateReportCache(); assert.equal(await readReport(['summary'], load), 4);
});

test('logout, owner switches and failed reads cannot return another session’s data', async () => {
  clearReportCache(); setReportCacheOwner('one');
  await readReport(['library'], async () => 'owner one');
  setReportCacheOwner('one'); assert.equal(await readReport(['library'], async () => 'wrong'), 'owner one');
  setReportCacheOwner('two'); assert.equal(await readReport(['library'], async () => 'owner two'), 'owner two');
  clearReportCache(); assert.equal(await readReport(['library'], async () => 'new login'), 'new login');
  await assert.rejects(readReport(['failure'], async () => { throw Error('offline'); }), /offline/);
  assert.equal(await readReport(['failure'], async () => 'recovered'), 'recovered');
});

test('server execution never shares private reports between requests', async () => {
  clearReportCache(); delete global.window;
  try {
    assert.equal(await readReport(['library'], async () => 'request one'), 'request one');
    assert.equal(await readReport(['library'], async () => 'request two'), 'request two');
  } finally { global.window = {}; }
});

test('ending a session cancels an in-flight private read and cannot warm the new owner', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  clearReportCache(); setReportCacheOwner('old'); let finish;
  const old = readReport(['summary'], () => new Promise(resolve => { finish = resolve; }));
  const rejected = assert.rejects(old);
  clearReportCache(); await rejected;
  setReportCacheOwner('new');
  assert.equal(await readReport(['summary'], async () => 'new owner'), 'new owner');
  finish('old owner');
  assert.equal(await readReport(['summary'], async () => 'wrong'), 'new owner');
  clearReportCache();
  await Promise.resolve();
  context.mock.timers.runAll();
});
