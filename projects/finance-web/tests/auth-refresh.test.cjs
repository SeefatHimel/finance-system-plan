const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const vm = require('node:vm');

const project = resolve(__dirname, '..');
const output = mkdtempSync(join(tmpdir(), 'finance-rotation-test-'));
const config = join(output, 'tsconfig.json');
writeFileSync(config, JSON.stringify({ extends: join(project, 'tsconfig.json'),
  compilerOptions: { noEmit: false, incremental: false, module: 'commonjs', moduleResolution: 'node',
    target: 'ES2021', rootDir: project, outDir: output },
  include: ['lib/server-auth.ts', 'lib/refresh-coordinator.ts', 'app/api/auth/me/route.ts',
    'app/api/auth/refresh/route.ts', 'app/api/auth/logout/route.ts', 'app/api/backend/[...path]/route.ts'].map(file => join(project, file)),
  exclude: ['node_modules'] }));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config], { cwd: project });
after(() => rmSync(output, { recursive: true, force: true }));
const { createRefreshCoordinator } = require(join(output, 'lib/refresh-coordinator.js'));
writeFileSync(join(output, 'lib/session-api.js'), require('typescript').transpileModule(
  readFileSync(join(project, 'lib/session-api.ts'), 'utf8'),
  { compilerOptions: { module: 1, target: 8 } }
).outputText);


test('slow pending refreshes remain single-flight beyond the result reuse interval', async () => {
  let now = 0, calls = 0, finish;
  const run = createRefreshCoordinator(5000, () => now);
  const refresh = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = run('synthetic-session', refresh);
  await Promise.resolve();
  now = 20_000;
  const second = run('synthetic-session', refresh);
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish('replacement');
  assert.equal(await second, 'replacement');
  now += 4999;
  assert.equal(await run('synthetic-session', refresh), 'replacement');
  assert.equal(calls, 1);
  now += 2;
  const third = run('synthetic-session', async () => { calls++; return 'next'; });
  assert.equal(await third, 'next');
  assert.equal(calls, 2);
});

test('refresh failures are retryable and unrelated sessions never share results', async () => {
  const run = createRefreshCoordinator(5000);
  await assert.rejects(run('one', async () => { throw new Error('synthetic outage'); }));
  assert.equal(await run('one', async () => 'first'), 'first');
  assert.equal(await run('two', async () => 'second'), 'second');
});

const user = { id: 9, username: 'synthetic-session-user', email: '', first_name: '', last_name: '' };
const tokens = { access: 'synthetic-new-access', refresh: 'synthetic-new-refresh' };
function harness(fetchBackend) {
  const jar = new Map([['finance_refresh', 'synthetic-old-refresh']]);
  const loaded = new Map();
  class MockResponse extends Response {
    cookies = { values: new Map(), set: (...args) => { this.cookies.values.set(args[0], args.slice(1)); } };
    static json(body, options) { return new MockResponse(JSON.stringify(body), options); }
  }
  function load(filename) {
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const module = { exports: {} };
    loaded.set(filename, module);
    const localRequire = name => {
      if (name === 'next/headers') return { cookies: () => ({ get: key => jar.has(key) ? { value: jar.get(key) } : undefined }) };
      if (name === 'next/server') return { NextResponse: MockResponse };
      if (name.startsWith('@/')) return load(join(output, name.slice(2) + '.js'));
      if (name.startsWith('.')) return load(resolve(dirname(filename), name + '.js'));
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${readFileSync(filename, 'utf8')}\n})`, {
      fetch: fetchBackend, AbortSignal, Date, Map, WeakMap, Error, Headers, Response, Request, URL, setTimeout,
      process: { env: { NODE_ENV: 'production', NEXT_SERVER_API_BASE_URL: 'https://synthetic.invalid' } }
    }, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return { jar, load: file => load(join(output, file)), auth: load(join(output, 'lib/server-auth.js')), MockResponse };
}
const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

test('a transient user lookup after rotation preserves both replacement cookies', async () => {
  let unavailable = true, refreshes = 0;
  const h = harness(async url => {
    if (url.endsWith('/refresh/')) { refreshes++; return json(tokens); }
    if (url.endsWith('/me/')) return unavailable ? json({ detail: 'Synthetic outage' }, 503) : json(user);
    throw new Error('Unexpected synthetic route');
  });
  const me = h.load('app/api/auth/me/route.js');
  const failed = await me.GET();
  assert.equal(failed.status, 502);
  assert.equal(failed.cookies.values.get('finance_access')[0], tokens.access);
  assert.equal(failed.cookies.values.get('finance_refresh')[0], tokens.refresh);
  assert.equal(failed.cookies.values.get('finance_refresh')[1].httpOnly, true);
  assert.equal(failed.cookies.values.get('finance_refresh')[1].secure, true);
  assert(!JSON.stringify(await failed.json()).includes(tokens.refresh));
  for (const [key, [value]] of failed.cookies.values) h.jar.set(key, value);
  unavailable = false;
  const recovered = await me.GET();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), user);
  assert.equal(refreshes, 1);
});

test('the explicit refresh route also preserves rotation after a user lookup outage', async () => {
  const h = harness(async url => url.endsWith('/refresh/') ? json(tokens) : json({}, 503));
  const route = h.load('app/api/auth/refresh/route.js');
  const response = await route.POST(new Request('https://finance.invalid/api/auth/refresh', {
    method: 'POST', headers: { origin: 'https://finance.invalid' }
  }));
  assert.equal(response.status, 502);
  assert.equal(response.cookies.values.get('finance_refresh')[0], tokens.refresh);
});

test('a backend request failing after rotation still commits replacement cookies', async () => {
  const h = harness(async url => {
    if (url.endsWith('/refresh/')) return json(tokens);
    throw new Error('Synthetic network outage');
  });
  const route = h.load('app/api/backend/[...path]/route.js');
  const response = await route.GET({ method: 'GET', headers: new Headers(), nextUrl: new URL('https://finance.invalid/api/backend/api/accounts/') }, { params: { path: ['api', 'accounts'] } });
  assert.equal(response.status, 502);
  assert.equal(response.cookies.values.get('finance_refresh')[0], tokens.refresh);
});

test('an old failing refresh response cannot erase cookies from another successful request', async () => {
  const h = harness(async () => json({ detail: 'Invalid token' }, 401));
  const response = await h.load('app/api/auth/me/route.js').GET();
  assert.equal(response.status, 401);
  assert.equal(response.cookies.values.size, 0);
});

test('proxy refresh does not drop replacement tokens when its retried fetch fails', async () => {
  const h = harness(async url => {
    if (url.endsWith('/refresh/')) return json(tokens);
    return json({ detail: 'Synthetic failure' }, 503);
  });
  const route = h.load('app/api/backend/[...path]/route.js');
  const response = await route.GET({ method: 'GET', headers: new Headers(), nextUrl: new URL('https://finance.invalid/api/backend/api/accounts/') }, { params: { path: ['api', 'accounts'] } });
  assert.equal(response.status, 503);
  assert.equal(response.cookies.values.get('finance_refresh')[0], tokens.refresh);
});

test('a successful category deletion forwards its bodyless 204 response', async () => {
  const h = harness(async url => {
    if (url.endsWith('/refresh/')) return json(tokens);
    if (url.endsWith('/api/categories/synthetic-category/')) return new Response(null, { status: 204 });
    throw new Error('Unexpected synthetic route');
  });
  const route = h.load('app/api/backend/[...path]/route.js');
  const request = new Request('https://finance.invalid/api/backend/api/categories/synthetic-category/', {
    method: 'DELETE', headers: { origin: 'https://finance.invalid' }
  });
  request.nextUrl = new URL(request.url);
  const response = await route.DELETE(request, { params: { path: ['api', 'categories', 'synthetic-category'] } });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.cookies.values.get('finance_refresh')[0], tokens.refresh);
});

test('browser verification shares checks and recovers a stale 401 before signing out', async () => {
  let calls = 0;
  const h = harness(async () => ++calls === 1 ? json({}, 401) : json(user));
  const session = h.load('lib/session-api.js');
  const first = session.getCookieSessionUser();
  assert.equal(first, session.getCookieSessionUser());
  assert.deepEqual(await first, user);
  assert.equal(calls, 2);
});

test('browser verification retains temporary errors and confirms terminal 401 separately', async () => {
  let calls = 0;
  const unavailable = harness(async () => { calls++; return json({}, 503); });
  await assert.rejects(unavailable.load('lib/session-api.js').getCookieSessionUser(), error => error.status === 503);
  assert.equal(calls, 1);
  const expired = harness(async () => { calls++; return json({}, 401); });
  await assert.rejects(expired.load('lib/session-api.js').getCookieSessionUser(), error => error.status === 401);
  assert.equal(calls, 3);
});

test('explicit logout still revokes and clears both HttpOnly cookies', async () => {
  const h = harness(async () => new Response(null, { status: 204 }));
  const response = await h.load('app/api/auth/logout/route.js').POST(new Request('https://finance.invalid/api/auth/logout', {
    method: 'POST', headers: { origin: 'https://finance.invalid' }
  }));
  assert.equal(response.status, 200);
  for (const name of ['finance_access', 'finance_refresh']) {
    assert.equal(response.cookies.values.get(name)[0], '');
    assert.equal(response.cookies.values.get(name)[1].maxAge, 0);
  }
});
