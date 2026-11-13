const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const output = mkdtempSync(join(tmpdir(), "finance-sender-display-"));
execFileSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "--module",
    "commonjs",
    "--target",
    "ES2021",
    "--esModuleInterop",
    "--skipLibCheck",
    "--outDir",
    output,
    "lib/sender-rule-display.ts",
  ],
  { cwd: resolve(__dirname, "..") },
);
const { visibleSenderGroups, senderProviderLabels } = require(
  join(output, "finance-web/lib/sender-rule-display.js"),
);
after(() => rmSync(output, { recursive: true, force: true }));
const aliases = ["Pathao.Pay", "Pathao Pay.", "PathaoPay.", "PathaoPay"];
const rules = aliases.map((sender, index) => ({
  id: String(index),
  sender,
  name: `Synthetic rule ${index}`,
  provider: "pathao_pay",
  account: "wallet",
  category: null,
  match_type: "exact",
  is_active: index !== 2,
  priority: 100,
}));
const accounts = [{ id: "wallet", name: "Synthetic travel wallet" }];
const view = (search = "", status = "all", excluded = []) =>
  visibleSenderGroups(rules, accounts, [], excluded, search, status);
test("searching one alias retains the whole group and original IDs/settings", () => {
  const before = JSON.stringify(rules);
  const result = view("  PATHAO.PAY  ");
  assert.equal(result.length, 1);
  assert.equal(result[0].members.length, 4);
  assert.deepEqual(
    result[0].members.map((rule) => rule.id),
    rules.map((rule) => rule.id),
  );
  assert.equal(result[0].members[2].is_active, false);
  assert.equal(JSON.stringify(rules), before);
});
test("account and custom rule names are searchable; no matches give an empty state", () => {
  assert.equal(view("travel wallet").length, 1);
  assert.equal(view("rule 2").length, 1);
  assert.equal(view("missing sender").length, 0);
});
test("mixed groups remain complete in enabled and disabled filters", () => {
  assert.equal(view("", "enabled")[0].members.length, 4);
  assert.equal(view("", "disabled")[0].members.length, 4);
  assert.equal(view("", "provider_paused").length, 0);
});
test("provider pause is separate from individual rule activity", () => {
  assert.equal(view("", "enabled", ["pathao_pay"]).length, 0);
  assert.equal(
    view("", "provider_paused", ["pathao_pay"])[0].members.length,
    4,
  );
  assert.equal(rules.filter((rule) => rule.is_active).length, 3);
});
test("category matching and different accounts never collapse independent rules", () => {
  const result = visibleSenderGroups(
    [
      ...rules,
      {
        ...rules[0],
        id: "other-rule",
        account: "other",
        category: "groceries",
      },
    ],
    accounts,
    [{ id: "groceries", name: "Groceries" }],
    [],
    "grocer",
    "all",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].members.length, 1);
  assert.equal(result[0].members[0].id, "other-rule");
  assert.equal(senderProviderLabels.pathao_pay, "Pathao Pay");
  assert.equal(senderProviderLabels.ebl, "EBL");
});
test("connection ordering stays stable across server order and local writes", () => {
  const extra = {
    ...rules[0],
    id: "bank-rule",
    sender: "SYNTHBANK",
    provider: "bank",
    account: "bank",
    name: "A bank",
    priority: 100,
  };
  const first = visibleSenderGroups(
    [...rules, extra],
    accounts,
    [],
    [],
    "",
    "all",
  );
  const reversed = visibleSenderGroups(
    [extra, ...rules.slice().reverse()],
    accounts,
    [],
    [],
    "",
    "all",
  );
  assert.deepEqual(
    first.map((group) => group.key),
    reversed.map((group) => group.key),
  );
  assert.equal(first[0].members[0].id, "bank-rule");
});
