const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const source = ts.transpileModule(
  readFileSync(
    resolve(__dirname, "../../finance-contracts/presentation.ts"),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
    },
  },
).outputText;
const mod = { exports: {} };
new Function("exports", source)(mod.exports);
const p = mod.exports;

test("shared monetary presentation retains exact cents, grouping, signs and unknown values", () => {
  assert.equal(
    p.formatCurrency("99999999999999.99").replaceAll(",", ""),
    "BDT 99999999999999.99",
  );
  assert.equal(p.formatCurrency("-0.07", "USD"), "−USD 0.07");
  assert.equal(p.formatCurrency("-0.00"), "BDT 0.00");
  assert.equal(p.formatCurrency("0"), "BDT 0.00");
  assert.equal(p.formatCurrency("00012.3"), "BDT 12.30");
  for (const value of [null, undefined, ""])
    assert.equal(p.formatCurrency(value), "Not reported");
  for (const value of ["NaN", "1e3", "0.001", "12abc", Infinity])
    assert.equal(p.formatCurrency(value), "Amount unavailable");
});
test("calendar dates validate actual days and absent times never acquire a guessed time", () => {
  assert.equal(p.formatCalendarDate("2024-02-29"), "29/02/2024");
  for (const date of ["2026-02-29", "2026-02-30", "0000-01-01", "", null])
    assert.equal(p.formatCalendarDate(date), "Unknown date");
  assert.equal(p.formatClockTime("00:07:32"), "00:07:32");
  for (const time of [null, "", "24:00", "14:70"])
    assert.equal(p.formatClockTime(time), "Not reported");
  assert.deepEqual(p.timestampFields("bad timestamp"), { date: "", time: "" });
});
test("SMS input date and time use the same local day across timezone boundaries; calendar dates never shift", () => {
  function inZone(zone) {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "-e",
          `const exports = {}; ${source}; process.stdout.write(JSON.stringify({ fields: exports.timestampFields('2026-01-01T20:15:00Z'), calendar: exports.formatCalendarDate('2026-01-01'), stamp: exports.formatTimestamp('2026-01-01T20:15:00Z') }));`,
        ],
        { env: { ...process.env, TZ: zone }, encoding: "utf8" },
      ),
    );
  }
  assert.deepEqual(inZone("Asia/Dhaka"), {
    fields: { date: "2026-01-02", time: "02:15" },
    calendar: "01/01/2026",
    stamp: "02/01/2026, 02:15",
  });
  assert.deepEqual(inZone("America/Los_Angeles"), {
    fields: { date: "2026-01-01", time: "12:15" },
    calendar: "01/01/2026",
    stamp: "01/01/2026, 12:15",
  });
});
