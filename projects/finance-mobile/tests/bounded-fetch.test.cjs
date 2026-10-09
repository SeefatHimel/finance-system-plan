const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-network-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'src/bounded-fetch.ts'], { cwd: resolve(__dirname, '..') });
const { boundedFetch } = require(join(output, 'bounded-fetch.js'));
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; rmSync(output, { recursive: true, force: true }); });

test('a stalled connection produces a retryable error', async () => {
  global.fetch = (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(boundedFetch('https://test.invalid', undefined, 20), /Server did not respond/);
});

test('the timeout remains active while waiting for the response body', async () => {
  global.fetch = async (_, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))); }
  }));
  await assert.rejects(boundedFetch('https://test.invalid', undefined, 20), /Server did not respond/);
});

test('HTTP errors and JSON remain available to authentication recovery', async () => {
  global.fetch = async () => new Response(JSON.stringify({ detail: 'Synthetic expired session' }), { status: 401 });
  const response = await boundedFetch('https://test.invalid');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { detail: 'Synthetic expired session' });
});

test('empty successful responses remain readable', async () => {
  global.fetch = async () => new Response(null, { status: 204 });
  const response = await boundedFetch('https://test.invalid');
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
});
