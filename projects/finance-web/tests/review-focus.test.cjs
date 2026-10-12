const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-focus-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/body-scroll-lock.ts'], { cwd: resolve(__dirname, '..') });
const { lockBodyScroll } = require(join(output, 'body-scroll-lock.js'));
const originalDocument = global.document;
global.document = { body: { style: { overflow: '' } } };
after(() => { global.document = originalDocument; rmSync(output, { recursive: true, force: true }); });

test('exiting Focus mode restores the original page scroll setting', () => {
  document.body.style.overflow = 'auto';
  const release = lockBodyScroll();
  assert.equal(document.body.style.overflow, 'hidden');
  release();
  assert.equal(document.body.style.overflow, 'auto');
});

test('nested dialog and Focus mode can close in either order without unlocking early or leaving scrolling stuck', () => {
  for (const order of [[0, 1], [1, 0]]) {
    document.body.style.overflow = 'scroll';
    const releases = [lockBodyScroll(), lockBodyScroll()];
    releases[order[0]]();
    assert.equal(document.body.style.overflow, 'hidden');
    releases[order[1]]();
    assert.equal(document.body.style.overflow, 'scroll');
  }
});

test('repeated cleanup cannot release another active dialog scroll lock', () => {
  document.body.style.overflow = '';
  const focus = lockBodyScroll(), dialog = lockBodyScroll();
  focus(); focus();
  assert.equal(document.body.style.overflow, 'hidden');
  dialog();
  assert.equal(document.body.style.overflow, '');
});
