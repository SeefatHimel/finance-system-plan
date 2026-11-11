const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript");
const requests = [];
let response;
const value = { exports: {} };
new Function(
  "module",
  "exports",
  "require",
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../lib/cash-counts-api.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
)(value, value.exports, (name) =>
  name === "./api"
    ? {
        authenticatedFetch: async (url, token, init) => {
          requests.push({ url, token, init });
          return { json: async () => response };
        },
      }
    : require(name),
);
const {
  cashPreviewSchema,
  cashHistorySchema,
  cashComparisonSchema,
  saveCashCounts,
  cashCountHistory,
  compareCashCount,
} = value.exports;
const count = {
  id: "synthetic-count",
  account: "synthetic-wallet",
  date: "2026-02-01",
  time: null,
  precision: "end_of_day",
  balance: "0.00",
  expected_balance: "-30.00",
  difference: "30.00",
  note: "Synthetic observation",
  updated_at: "2026-02-01T18:00:00Z",
};

test("zero cash and negative ledger expectations remain distinct from an unknown comparison", () => {
  const parsed = cashComparisonSchema.parse({
    count: {
      ...count,
      current_expected: null,
      current_difference: null,
      ledger_changed: false,
    },
    previous: null,
    difference_change: null,
    errors: ["Timing review needed"],
    movements: [],
    movement_count: 0,
    next_offset: null,
    revision: "synthetic-revision",
  });
  assert.equal(parsed.count.balance, "0.00");
  assert.equal(parsed.count.expected_balance, "-30.00");
  assert.equal(parsed.count.current_expected, null);
  assert.equal(parsed.count.time, null);
  assert.throws(() =>
    cashComparisonSchema.parse({
      ...parsed,
      count: { ...parsed.count, current_expected: 0 },
    }),
  );
});

test("a missing or malformed payload cannot become an empty successful cash history", () => {
  assert.throws(() =>
    cashHistorySchema.parse({ results: [], count: "0", next_offset: null }),
  );
  assert.throws(() => cashPreviewSchema.parse({ ready: true, rows: [] }));
  assert.throws(() => cashComparisonSchema.parse({ count }));
});

test("saving forwards the reviewed token and stable retry key without inventing a time", async () => {
  response = {
    id: "synthetic-receipt",
    saved: 1,
    counts: [
      {
        id: count.id,
        number: 1,
        account: count.account,
        difference: count.difference,
      },
    ],
  };
  const draft = {
    rows: [{ account: count.account, date: count.date, balance: "0" }],
    end_of_day: true,
  };
  await saveCashCounts(
    "synthetic-session",
    draft,
    "reviewed-state",
    "same-retry-key",
  );
  await saveCashCounts(
    "synthetic-session",
    draft,
    "reviewed-state",
    "same-retry-key",
  );
  const request = requests.at(-1);
  assert.equal(request.url, "/api/cash-counts/");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    ...draft,
    review_token: "reviewed-state",
    idempotency_key: "same-retry-key",
  });
  assert.equal(JSON.parse(request.init.body).rows[0].time, undefined);
  assert.equal(request.token, "synthetic-session");
  assert.equal(requests.at(-2).init.body, request.init.body);
});

test("history scope, pagination and cancellation reach the authenticated API", async () => {
  response = { results: [], count: 0, next_offset: null };
  const controller = new AbortController();
  await cashCountHistory(
    "synthetic-session",
    "synthetic-wallet",
    50,
    controller.signal,
  );
  const request = requests.at(-1);
  const url = new URL(request.url, "http://localhost");
  assert.equal(url.searchParams.get("account"), "synthetic-wallet");
  assert.equal(url.searchParams.get("offset"), "50");
  assert.equal(request.init.signal, controller.signal);
  response = {
    count: {
      ...count,
      current_expected: "-30.00",
      current_difference: "30.00",
      ledger_changed: false,
    },
    previous: null,
    difference_change: null,
    errors: [],
    movements: [],
    movement_count: 0,
    next_offset: null,
    revision: "synthetic-revision",
  };
  await compareCashCount("synthetic-session", count.id, 25, controller.signal);
  assert.equal(
    requests.at(-1).url,
    "/api/cash-counts/synthetic-count/?offset=25",
  );
});
