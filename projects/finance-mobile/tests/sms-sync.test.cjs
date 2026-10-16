const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const mod = { exports: {} };
const code = ts.transpileModule(
  readFileSync(resolve(__dirname, "../src/sms-sync-presentation.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  },
).outputText;
new Function("module", "exports", code)(mod, mod.exports);
const { smsSyncPresentation, smsSyncDiagnostics } = mod.exports;
const status = {
  pendingCount: 552,
  importedCount: 0,
  rejectedCount: 0,
  state: "error",
  updatedAt: "",
  message: "Synthetic error",
};

test("DNS errors distinguish waiting from records needing correction, including older status payloads", () => {
  const view = smsSyncPresentation({ ...status, failureKind: "network" }, 552);
  assert.equal(view.label, "Waiting");
  assert.equal(view.tone, "waiting");
  assert.equal(view.waiting, true);
  const old = smsSyncPresentation(
    {
      ...status,
      message:
        'Unable to resolve host "synthetic.invalid": No address associated with hostname',
    },
    552,
  );
  assert.equal(old.label, "Waiting");
  assert.match(old.message, /remain saved/);
});
test("authentication and rejected records need attention while a server outage retries", () => {
  assert.equal(
    smsSyncPresentation({ ...status, failureKind: "auth" }, 552).label,
    "Attention",
  );
  assert.equal(
    smsSyncPresentation(
      { ...status, failureKind: "rejected", rejectedCount: 4 },
      4,
    ).tone,
    "error",
  );
  assert.equal(
    smsSyncPresentation({ ...status, failureKind: "server" }, 552).label,
    "Waiting",
  );
});
test("stale running text cannot disable retry when no worker is running", () => {
  assert.equal(
    smsSyncPresentation(
      { ...status, state: "running", workerRunning: false },
      552,
    ).running,
    false,
  );
  assert.equal(
    smsSyncPresentation(
      { ...status, state: "running", workerRunning: true },
      552,
    ).label,
    "Syncing",
  );
  assert.equal(
    smsSyncPresentation({ ...status, state: "success", message: "Uploaded" }, 0)
      .label,
    "Ready",
  );
});

test("sync diagnostics allow only operational metadata and omit message and credential fields", () => {
  const value = JSON.parse(
    smsSyncDiagnostics(
      {
        ...status,
        stage: "auth_refresh",
        httpCode: 401,
        body: "private synthetic SMS",
        sender: "synthetic sender",
        access: "synthetic-access",
        refresh: "synthetic-refresh",
        message: "private synthetic response",
        username: "synthetic-user",
      },
      "test-version",
      "https://synthetic-token:password@api.test:443/path?secret=test",
    ),
  );
  assert.equal(value.foregroundHost, "api.test");
  assert.equal(value.stage, "auth_refresh");
  assert.equal(value.httpCode, 401);
  assert.equal(value.pendingCount, 552);
  for (const field of [
    "body",
    "sender",
    "access",
    "refresh",
    "message",
    "username",
  ])
    assert.equal(field in value, false);
});

function loadApi(fetch) {
  const api = { exports: {} };
  const scopeModule = { exports: {} };
  const compile = (file) =>
    ts.transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }).outputText;
  new Function("module", "exports", compile("../src/secure-document.ts"))(
    scopeModule,
    scopeModule.exports,
  );
  new Function("module", "exports", "require", compile("../src/api.ts"))(
    api,
    api.exports,
    (name) =>
      name === "./secure-document"
        ? scopeModule.exports
        : { boundedFetch: fetch },
  );
  return api.exports;
}
const jwt = (user, tag) =>
  `header.${Buffer.from(JSON.stringify({ user_id: user, tag })).toString("base64url")}.signature`;

test("foreground recovery receives the rejected token and reuses the refreshed same-user session", async () => {
  const old = jwt(1, "old"),
    current = jwt(1, "current");
  const seen = [];
  const api = loadApi(async (_url, request) => {
    seen.push(request.headers.Authorization);
    return new Response(
      JSON.stringify(seen.length === 1 ? { detail: "Expired" } : []),
      { status: seen.length === 1 ? 401 : 200 },
    );
  });
  api.configureAuthenticationRecovery(async (rejected) => {
    assert.equal(rejected, old);
    return current;
  });
  assert.deepEqual(await api.listAccounts(old), []);
  assert.deepEqual(seen, [`Bearer ${old}`, `Bearer ${current}`]);
});
test("a user switch during recovery cannot replay an old user's request with the new user's token", async () => {
  let attempts = 0;
  const api = loadApi(async () => {
    attempts++;
    return new Response("{}", { status: 401 });
  });
  api.configureAuthenticationRecovery(async () => jwt(2, "different-user"));
  await assert.rejects(
    api.listAccounts(jwt(1, "old-user")),
    /signed-in user changed/,
  );
  assert.equal(attempts, 1);
});

test("unknown or unreadable queue status never claims Ready or zero verified messages", () => {
  const { smsSyncSummary } = mod.exports;
  assert.equal(smsSyncPresentation(null, 0).label, "Not checked");
  for (const patch of [
    { pendingCountKnown: false },
    { queueReadable: false },
  ]) {
    const value = { ...status, state: "success", ...patch };
    assert.equal(smsSyncSummary(value, 0).known, false);
    assert.equal(smsSyncPresentation(value, 0).label, "Status unavailable");
  }
});
test("partial sync progress keeps correction and delayed counts disjoint and exposes retry responsibility", () => {
  const { smsSyncSummary } = mod.exports;
  const mixed = smsSyncSummary(
    {
      ...status,
      importedCount: 25,
      rejectedCount: 2,
      delayedCount: 3,
      retryScheduled: true,
      nextAttemptAt: "2026-10-17T10:00:00Z",
    },
    10,
  );
  assert.equal(mixed.uploaded, 25);
  assert.equal(mixed.queued, 10);
  assert.equal(mixed.rejected, 2);
  assert.equal(mixed.delayed, 3);
  assert.equal(mixed.waiting, 5);
  assert.equal(mixed.label, "Needs correction");
  assert.match(mixed.guidance, /Other eligible messages/);
  const automatic = smsSyncSummary(
    { ...status, failureKind: "network", retryScheduled: true },
    10,
  );
  assert.match(automatic.guidance, /retry automatically/);
  assert.match(
    smsSyncSummary(
      { ...status, failureKind: "network", retryScheduled: false },
      10,
    ).guidance,
    /use Retry/,
  );
  const clamped = smsSyncSummary(
    { ...status, rejectedCount: 4, delayedCount: 20, importedCount: -1 },
    5,
  );
  assert.equal(clamped.waiting, 0);
  assert.equal(clamped.delayed, 1);
  assert.equal(clamped.uploaded, 0);
  assert.equal(
    smsSyncPresentation({ ...status, state: "success", rejectedCount: 1 }, 1)
      .label,
    "Attention",
  );
});
