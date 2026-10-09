const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const output = mkdtempSync(join(tmpdir(), 'finance-tap-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'src/tap-gesture.ts'], { cwd: resolve(__dirname, '..') });
const { TapGesture } = require(join(output, 'tap-gesture.js'));
after(() => rmSync(output, { recursive: true, force: true }));
const point = (pageX, pageY) => ({ pageX, pageY });

test('a deliberate tap tolerates normal finger jitter', () => {
  const gesture = new TapGesture();
  gesture.begin(point(100, 100));
  gesture.move(point(103, 104));
  assert.equal(gesture.finish(point(102, 101)), true);
});

test('horizontal and vertical drags do not activate a setting', () => {
  for (const end of [point(140, 100), point(100, 150)]) {
    const gesture = new TapGesture();
    gesture.begin(point(100, 100));
    gesture.move(end);
    assert.equal(gesture.finish(end), false);
  }
});

test('dragging back to the starting point remains cancelled', () => {
  const gesture = new TapGesture();
  gesture.begin(point(100, 100));
  gesture.move(point(150, 100));
  gesture.move(point(100, 100));
  assert.equal(gesture.finish(point(100, 100)), false);
});

test('release movement is checked even if move events were coalesced', () => {
  const gesture = new TapGesture();
  gesture.begin(point(100, 100));
  assert.equal(gesture.finish(point(100, 120)), false);
});

test('a cancelled drag does not block the next deliberate tap', () => {
  const gesture = new TapGesture();
  gesture.begin(point(100, 100));
  gesture.move(point(100, 150));
  gesture.reset();
  gesture.begin(point(200, 200));
  assert.equal(gesture.finish(point(200, 200)), true);
});

test('activation without a touch gesture remains available to accessibility', () => {
  const gesture = new TapGesture();
  assert.equal(gesture.finish(point(0, 0)), true);
});
