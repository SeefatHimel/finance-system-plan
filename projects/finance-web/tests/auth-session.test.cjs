const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const output = mkdtempSync(join(tmpdir(), 'finance-auth-test-'));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--module', 'commonjs',
  '--target', 'ES2020', '--skipLibCheck', '--outDir', output,
  'lib/auth-navigation.ts', 'lib/auth-errors.ts'], { cwd: resolve(__dirname, '..') });
const { safeReturnPath, loginHref, isProtectedPath } = require(join(output, 'auth-navigation.js'));
const { AuthRequestError, isAuthenticationFailure } = require(join(output, 'auth-errors.js'));
after(() => rmSync(output, { recursive: true, force: true }));

test('login return URLs preserve protected-page filters and anchors', () => {
  const destination = '/transactions?month=2026-01&search=Example%20reference#history';
  assert.equal(safeReturnPath(destination), destination);
  const redirect = new URL(loginHref(destination, 'expired'), 'https://finance.invalid');
  assert.equal(redirect.pathname, '/login');
  assert.equal(redirect.searchParams.get('next'), destination);
  assert.equal(redirect.searchParams.get('reason'), 'expired');
});

test('return URLs reject external redirects, encoded path tricks, and auth/API loops', () => {
  for (const value of [undefined, '', 'https://example.invalid', '//example.invalid',
    '/\\example.invalid', '/%2F%2Fexample.invalid', '/%5Cexample.invalid',
    '/login?next=/login', '/api/auth/logout', '/_next/static/example', '/unknown',
    '/transactions/../login', 'javascript:alert(1)']) {
    assert.equal(safeReturnPath(value), '/', String(value));
  }
});

test('every current workspace is a permitted return route', () => {
  for (const path of ['/', '/transactions', '/accounts', '/messages/review', '/sms-settings',
    '/reports', '/debts', '/credit-cards', '/recurring-bills', '/reconciliation', '/audit-logs']) {
    assert(isProtectedPath(path));
    assert.equal(safeReturnPath(path), path);
  }
  assert(!isProtectedPath('/login'));
});

test('only confirmed 401 auth errors end a session', () => {
  assert(isAuthenticationFailure(new AuthRequestError('Expired', 401)));
  for (const error of [new Error('Network unavailable'), new Error('Session expired'),
    new AuthRequestError('Forbidden', 403), new AuthRequestError('Throttled', 429),
    new AuthRequestError('Gateway unavailable', 502), new AuthRequestError('Unavailable', 503)]) {
    assert.equal(isAuthenticationFailure(error), false);
  }
});
