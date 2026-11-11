const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript");
const moduleValue = { exports: {} };
const requests = [];
const api = {
  authenticatedFetch: async (url, token, init) => {
    requests.push({ url, token, init });
    return {
      json: async () => ({
        id: "synthetic-batch",
        state: "committed",
        receipt: { new: 1, linked: 0, skipped: 0, checkpoints: 0 },
      }),
    };
  },
};
new Function(
  "module",
  "exports",
  "require",
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../lib/bulk-import-api.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
)(moduleValue, moduleValue.exports, (name) =>
  name === "./api" ? api : require(name),
);
const { bulkPreviewSchema, bulkSourceSchema, commitBulkImport } =
  moduleValue.exports;
function preview() {
  return {
    id: "synthetic-batch",
    account: "synthetic-account",
    filename: "Synthetic table",
    state: "draft",
    version: 1,
    headers: ["Date", "Amount"],
    configuration: { mapping: { date: "Date", amount: "Amount" } },
    rows: [{ number: 1, original: { Date: "2026-01-02", Amount: "0" } }],
    checkpoints: [],
    errors: [],
    summary: {},
    review_token: "synthetic-review-token",
    timezone: "Asia/Dhaka",
    receipt: {},
  };
}
test("an unmapped or invalid source row remains inspectable without inventing transaction values", () => {
  const p = bulkPreviewSchema.parse(preview());
  assert.equal(p.rows[0].values, undefined);
  assert.equal(p.rows[0].original.Amount, "0");
  assert.equal(p.configuration.date_order, "ISO");
  assert.equal(p.configuration.positive_direction, "debit");
});
test("malformed success payloads cannot masquerade as a valid preview or source", () => {
  assert.throws(() =>
    bulkPreviewSchema.parse({
      ...preview(),
      rows: [{ number: 1, original: "not a row" }],
    }),
  );
  assert.throws(() =>
    bulkSourceSchema.parse({
      batch: "synthetic",
      number: 1,
      original: {},
      normalized: {},
    }),
  );
});
test("confirmation carries the reviewed version and token through cookie-aware authenticated requests", async () => {
  const p = bulkPreviewSchema.parse(preview());
  await commitBulkImport("synthetic-session", p);
  const request = requests.at(-1);
  assert.equal(request.url, "/api/bulk-imports/synthetic-batch/commit/");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    version: 1,
    review_token: "synthetic-review-token",
  });
  assert.equal(request.token, "synthetic-session");
});

test("edited notes and category suggestions survive preview parsing with safe limits", () => {
  const input = preview();
  input.configuration.decisions = {
    1: { notes: "Reviewed context\nSecond line" },
  };
  input.rows[0].category_suggestion = {
    category: "synthetic-category",
    label: "Transport",
    method: "alias",
  };
  const parsed = bulkPreviewSchema.parse(input);
  assert.equal(
    parsed.configuration.decisions["1"].notes,
    "Reviewed context\nSecond line",
  );
  assert.equal(parsed.rows[0].category_suggestion.label, "Transport");
  input.configuration.decisions["1"].notes = "";
  assert.equal(
    bulkPreviewSchema.parse(input).configuration.decisions["1"].notes,
    "",
  );
  input.configuration.decisions["1"].notes = "x".repeat(4001);
  assert.throws(() => bulkPreviewSchema.parse(input));
});
