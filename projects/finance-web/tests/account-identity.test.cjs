const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const output = mkdtempSync(join(tmpdir(), 'finance-account-identity-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs', '--target', 'ES2021', '--skipLibCheck', '--outDir', output, 'lib/account-identity.ts'], { cwd: resolve(__dirname, '..') });
const { safeAccountIdentifier, accountIdentityInput, emptyAccountIdentity } = require(join(output, 'finance-web/lib/account-identity.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('statement and ledger evidence stays masked', () => {
  assert.equal(safeAccountIdentifier('1234 5678 9012 3456'), '3456');
  assert.equal(safeAccountIdentifier('1234-5678-9012-3456'), '3456');
  assert.equal(safeAccountIdentifier(' 1234 ** 3456 '), '1234**3456');
  assert.equal(safeAccountIdentifier('1234567890123456x'), '3456');
  assert.equal(safeAccountIdentifier('1234567890**3456'), '3456');
  assert.equal(safeAccountIdentifier('1234'), '1234');
  assert.equal(safeAccountIdentifier('123'), '123');
  assert.equal(safeAccountIdentifier('****123'), '****123');
  assert.throws(() => safeAccountIdentifier('12'), /three ending digits/);
  assert.throws(() => safeAccountIdentifier('1234**12'), /three ending digits/);
  assert.throws(() => safeAccountIdentifier('1234567890**12'), /three ending digits/);
});

test('account settings send full values for encrypted API retention', () => {
  const draft = { ...emptyAccountIdentity(), enabled: true, provider: 'ebl', identifier: '12345678901111', additional_identifiers: [{ kind: 'card', value: '12345678902222', label: 'Daily card' }], aliases: ' Everyday \nEveryday\nOther label\n' };
  const body = accountIdentityInput(draft);
  assert.equal(body.identifier, '12345678901111');
  assert.equal(body.additional_identifiers[0].value, '12345678902222');
  assert.deepEqual(body.aliases, ['Everyday', 'Other label']);
  assert.equal(accountIdentityInput({ ...draft, enabled: false }), null);
  assert.throws(() => accountIdentityInput({ ...emptyAccountIdentity(), enabled: true }), /disable recognition/);
});
