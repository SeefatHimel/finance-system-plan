const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-account-avatar-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2022', '--lib', 'ESNext,DOM', '--skipLibCheck', '--outDir', output, 'lib/account-avatar.ts'], { cwd: resolve(__dirname, '..') });
const { accountAvatar, isAccountLogo } = require(join(output, 'account-avatar.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('initial handles whitespace, empty names, accents and Bangla graphemes', () => {
  assert.equal(accountAvatar('  bank').initial, 'B');
  assert.equal(accountAvatar('épargne').initial, 'É');
  assert.equal(accountAvatar('বাংলা').initial, 'বাং');
  assert.equal(accountAvatar('  ').initial, '?');
});

test('color is stable across reload and rename by using account ID', () => {
  const original = accountAvatar('Bank', 'synthetic-account-01');
  assert.deepEqual(accountAvatar('Bank', 'synthetic-account-01'), original);
  assert.equal(accountAvatar('Cash', 'synthetic-account-01').color, original.color);
  assert.equal(accountAvatar('Cash', 'synthetic-account-01').initial, 'C');
});

test('avatar only renders embedded raster logos, with no remote or script URLs', () => {
  assert.equal(isAccountLogo('data:image/webp;base64,UklGRg=='), true);
  for (const input of [undefined, '', 'https://example.test/logo.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,broken!']) assert.equal(isAccountLogo(input), false);
});
