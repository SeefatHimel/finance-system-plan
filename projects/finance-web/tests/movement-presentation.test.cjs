const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const output = mkdtempSync(join(tmpdir(), "finance-movement-presentation-"));
execFileSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "--module",
    "commonjs",
    "--target",
    "ES2021",
    "--skipLibCheck",
    "--outDir",
    output,
    "lib/movement-presentation.ts",
  ],
  { cwd: resolve(__dirname, "..") },
);
const { formatMovementAmount, movementPresentation } = require(
  join(output, "movement-presentation.js"),
);
after(() => rmSync(output, { recursive: true, force: true }));
const accounts = new Map([
  ["bank", "Demo bank"],
  ["wallet", "Demo wallet"],
]);
const base = {
  type: "transfer",
  direction: "debit",
  account: "bank",
  transfer_account: "wallet",
};

test("an unfiltered internal transfer has both account names and a neutral amount", () => {
  for (const direction of ["debit", "credit"]) {
    assert.deepEqual(movementPresentation({ ...base, direction }, accounts), {
      path: "Demo bank → Demo wallet",
      tone: "transfer",
      sign: "",
    });
  }
  assert.equal(base.account, "bank");
});
test("ordinary debits and credits keep their account and signed perspective", () => {
  assert.deepEqual(
    movementPresentation(
      { ...base, type: "expense", transfer_account: null },
      accounts,
    ),
    { path: "Demo bank", tone: "debit", sign: "−" },
  );
  assert.deepEqual(
    movementPresentation(
      { ...base, type: "refund", direction: "credit", transfer_account: null },
      accounts,
    ),
    { path: "Demo bank", tone: "credit", sign: "+" },
  );
});
test("missing account names remain explicit rather than inventing a destination", () => {
  assert.equal(
    movementPresentation(base, new Map()).path,
    "Unknown account → Unknown account",
  );
  assert.equal(
    movementPresentation({ ...base, transfer_account: null }, accounts).path,
    "Demo bank → Choose destination",
  );
});

test("movement amounts retain exact cents and the reported currency without numeric rounding", () => {
  assert.equal(
    formatMovementAmount("99999999999999.99").replaceAll(",", ""),
    "BDT 99999999999999.99",
  );
  assert.equal(formatMovementAmount("0.07"), "BDT 0.07");
  assert.equal(formatMovementAmount("12.3", "USD"), "USD 12.30");
  assert.equal(formatMovementAmount("12", "TK"), "TK 12.00");
});
test("unknown or malformed monetary values are not presented as zero", () => {
  for (const value of ["", "NaN", "1e3", "0.001"])
    assert.equal(formatMovementAmount(value), "Amount unavailable");
});
