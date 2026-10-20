import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, balanceGapDetails, balanceGaps, groupTimelineDays, laneBalance, laneDirection, laneMomentMatchesCanonical, reportedBalanceAtDate, weekStart } from "../lib/account-lanes.ts";

const row = (id, date, time, amount, balance_after, extra = {}) => ({
  id, date, time, amount, balance_after, account: "city", transfer_account: null,
  direction: "debit", type: "expense", reported_balances: [], ...extra
});

test("date window crosses month and leap-day boundaries", () => {
  assert.equal(addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(weekStart("2026-10-20"), "2026-10-19");
  assert.equal(weekStart("2026-10-25"), "2026-10-19");
});

test("transfer is a debit and credit observation of one ledger entry", () => {
  const transfer = row("transfer", "2026-10-20", "10:20:00", "5000.00", null, {
    type: "transfer", transfer_account: "wallet", reported_balances: [
      { account: "city", balance_after: "1000.00" },
      { account: "wallet", balance_after: "8000.00" }
    ]
  });
  assert.equal(laneDirection(transfer, "city"), "debit");
  assert.equal(laneDirection(transfer, "wallet"), "credit");
  assert.equal(laneBalance(transfer, "city"), "1000.00");
  assert.equal(laneBalance(transfer, "wallet"), "8000.00");
  assert.equal(laneDirection(transfer, "other"), null);
});

test("balance gaps use only fully loaded ordered intervals", () => {
  const rows = [
    row("first", "2026-10-20", "09:00:00", "10.00", "90.00"),
    row("middle", "2026-10-20", "10:00:00", "5.00", null),
    row("last", "2026-10-21", "11:00:00", "5.00", "83.00")
  ];
  assert.equal(balanceGaps(rows, "city", new Set(["2026-10-20", "2026-10-21"])).get("last"), 300);
  assert.equal(balanceGaps(rows, "city", new Set(["2026-10-21"])).size, 0);
  assert.equal(balanceGaps([{ ...rows[1], time: null }, rows[2], rows[0]], "city", new Set(["2026-10-20", "2026-10-21"])).size, 0);
  const detail = balanceGapDetails(rows, "city", new Set(["2026-10-20", "2026-10-21"])).get("last");
  assert.equal(detail?.priorCents, 9000);
  assert.equal(detail?.movementCents, -1000);
  assert.equal(detail?.expectedCents, 8000);
  assert.equal(detail?.actualCents, 8300);
  assert.deepEqual(detail?.movements.map(movement => movement.id), ["middle", "last"]);
});

test("historical balance labels use only loaded, ordered saved reports", () => {
  const rows = [row("earlier", "2026-10-20", "09:00:00", "10.00", "90.00"), row("later", "2026-10-21", "10:00:00", "5.00", "85.00")];
  const loaded = new Set(["2026-10-19", "2026-10-20", "2026-10-21"]);
  assert.deepEqual(reportedBalanceAtDate(rows, "city", "2026-10-20", loaded), { status: "reported", value: "90.00", date: "2026-10-20", time: "09:00:00" });
  assert.deepEqual(reportedBalanceAtDate(rows, "city", "2026-10-19", loaded), { status: "unavailable", reason: "no_report" });
  assert.deepEqual(reportedBalanceAtDate(rows, "city", "2026-10-21", new Set(["2026-10-20"])), { status: "unavailable", reason: "not_loaded" });
  assert.deepEqual(reportedBalanceAtDate([...rows, row("unknown-time", "2026-10-21", null, "2.00", "87.00")], "city", "2026-10-21", loaded), { status: "unavailable", reason: "ambiguous_order" });
});

test("quiet days collapse only when loaded and consecutive", () => {
  assert.deepEqual(groupTimelineDays(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"], new Set(["2026-10-23"]), new Set(["2026-10-20", "2026-10-21", "2026-10-23"]), true), [
    { kind: "quiet", start: "2026-10-20", end: "2026-10-21", count: 2 },
    { kind: "day", date: "2026-10-22" }, { kind: "day", date: "2026-10-23" }
  ]);
});

test("a transfer observed on another date cannot produce a precise lane gap", () => {
  const before = row("before", "2026-10-20", "09:00:00", "1.00", "100.00");
  const after = row("after", "2026-10-20", "10:00:00", "5.00", null, {
    type: "transfer", transfer_account: "wallet",
    reported_balances: [{ account: "city", balance_after: "90.00" }],
    transfer_evidence: [{ account: "city", date: "2026-10-21", time: "10:00:00" }]
  });
  assert.equal(laneMomentMatchesCanonical(after, "city"), false);
  assert.equal(balanceGaps([before, after], "city", new Set(["2026-10-20"])).size, 0);
});

test("any conflicting observation for the same transfer account suppresses a numeric gap", () => {
  const before = row("before", "2026-10-20", "09:00:00", "1.00", "100.00");
  const after = row("after", "2026-10-20", "10:00:00", "5.00", null, {
    type: "transfer", transfer_account: "wallet",
    reported_balances: [{ account: "city", balance_after: "90.00" }],
    transfer_evidence: [
      { account: "city", date: "2026-10-20", time: "10:00:00" },
      { account: "city", date: "2026-10-21", time: "10:00:00" }
    ]
  });
  assert.equal(laneMomentMatchesCanonical(after, "city"), false);
  assert.equal(balanceGaps([before, after], "city", new Set(["2026-10-20"])).size, 0);
});
