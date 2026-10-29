const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const ts = require('typescript');
const output = mkdtempSync(join(tmpdir(), 'finance-account-lanes-test-'));
const compiled = join(output, 'subject.cjs');
writeFileSync(compiled, ts.transpileModule(readFileSync(join(__dirname, '../lib/account-lanes.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText);
const { addDays, atTimelineEdge, balanceGapDetails, balanceGaps, contiguousReadyDates, expandReadyTimelineRange, groupTimelineDays, isVerticalTimelineGesture, laneBalance, laneDirection, laneMomentMatchesCanonical, loadTimelinePages, reportedBalanceAtDate, timelineScrollShift, weekStart } = require(compiled);
after(() => rmSync(output, { recursive: true, force: true }));

test("timeline refresh reads every page before returning the replacement week", async () => {
  const offsets = [];
  const progress = [];
  const rows = await loadTimelinePages(async offset => {
    offsets.push(offset);
    return offset === 0 ? { results: ["first", "second"], count: 3, next_offset: 2 }
      : { results: ["last"], count: 3, next_offset: null };
  }, new AbortController().signal, (loaded, total) => progress.push([loaded, total]));
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(rows, ["first", "second", "last"]);
  assert.deepEqual(progress, [[2, 3]]);
});

test("failed later pages cannot return a partially refreshed week", async () => {
  await assert.rejects(loadTimelinePages(async offset => {
    if (offset) throw new Error("Network unavailable");
    return { results: ["partial"], count: 2, next_offset: 1 };
  }, new AbortController().signal), /Network unavailable/);
});

test("cancelled refresh discards late responses and does not request another page", async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(loadTimelinePages(async () => {
    requests++;
    controller.abort();
    return { results: ["obsolete"], count: 2, next_offset: 1 };
  }, controller.signal), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("nonadvancing page offsets fail instead of looping during refresh", async () => {
  await assert.rejects(loadTimelinePages(async () => ({ results: [], count: 2, next_offset: 0 }), new AbortController().signal), /Please refresh again/);
});

const row = (id, date, time, amount, balance_after, extra = {}) => ({
  id, date, time, amount, balance_after, account: "city", transfer_account: null,
  direction: "debit", type: "expense", reported_balances: [], ...extra
});

test("date window crosses month and leap-day boundaries", () => {
  assert.equal(addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(weekStart("2026-10-20"), "2026-10-19");
  assert.equal(weekStart("2026-10-25"), "2026-10-19");
});

test("a short timeline advances only toward the user's gesture", () => {
  assert.equal(isVerticalTimelineGesture(30, 3, 2), false);
  assert.equal(isVerticalTimelineGesture(3, 30, 2), true);
  assert.equal(isVerticalTimelineGesture(30, 40, 45), false);
  assert.equal(atTimelineEdge(-1, 0, 300, 500, 4), true);
  assert.equal(atTimelineEdge(1, 0, 300, 500, 4), true);
  assert.equal(timelineScrollShift(-20, 0, 300, 500, true, true), -1);
  assert.equal(timelineScrollShift(20, 0, 300, 500, true, true), 1);
  assert.equal(timelineScrollShift(0, 0, 300, 500, true, true), 0);
  assert.equal(timelineScrollShift(20, 0, 300, 500, true, false), 0);
  assert.equal(timelineScrollShift(-20, 20, 1500, 500, true, true), 0);
  assert.equal(timelineScrollShift(20, 976, 1500, 500, true, true), 0);
  assert.equal(timelineScrollShift(20, 996, 1500, 500, true, true), 1);
  assert.equal(atTimelineEdge(-1, 150, 1000, 500, 4), false);
  assert.equal(atTimelineEdge(1, 150, 1000, 500, 4), false);
  assert.equal(atTimelineEdge(-1, 0, 1000, 500, 4), true);
  assert.equal(atTimelineEdge(1, 500, 1000, 500, 4), true);
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

test("timeline renders only contiguous ready weeks around the visible date", () => {
  const dates = Array.from({ length: 21 }, (_, index) => addDays("2026-10-19", index));
  assert.deepEqual(contiguousReadyDates(dates, new Set(["2026-10-19", "2026-11-02"]), "2026-10-28"), []);
  assert.deepEqual(contiguousReadyDates(dates, new Set(["2026-10-26", "2026-11-02"]), "2026-10-28"), dates.slice(7));
  assert.deepEqual(contiguousReadyDates(dates, new Set(["2026-10-19", "2026-11-02"]), "2026-11-03"), dates.slice(14));
  assert.deepEqual(contiguousReadyDates(dates, new Set(["2026-10-19", "2026-10-26", "2026-11-02"]), "2026-10-28"), dates);
});

test("scrolling appends and prepends ready weeks without dropping visible dates", () => {
  const start = "2026-05-11";
  const range = { start, end: addDays(start, 21) };
  const ready = new Set([start, addDays(start, 7), addDays(start, 14)]);
  const existing = Array.from({ length: 21 }, (_, index) => addDays(start, index));
  assert.equal(expandReadyTimelineRange(range, 1, ready), null);
  assert.equal(expandReadyTimelineRange(range, -1, ready), null);
  assert.deepEqual(contiguousReadyDates(existing, ready, existing[20]), existing);

  ready.add(range.end);
  const laterRange = expandReadyTimelineRange(range, 1, ready);
  assert.deepEqual(laterRange, { start, end: addDays(range.end, 7) });
  const laterDates = Array.from({ length: 28 }, (_, index) => addDays(laterRange.start, index));
  assert.deepEqual(laterDates.slice(0, 21), existing);
  assert.deepEqual(contiguousReadyDates(laterDates, ready, existing[20]), laterDates);

  ready.add(addDays(start, -7));
  const earlierRange = expandReadyTimelineRange(range, -1, ready);
  assert.deepEqual(earlierRange, { start: addDays(start, -7), end: range.end });
  const earlierDates = Array.from({ length: 28 }, (_, index) => addDays(earlierRange.start, index));
  assert.deepEqual(earlierDates.slice(7), existing);
  assert.deepEqual(contiguousReadyDates(earlierDates, ready, existing[0]), earlierDates);
});

test("quiet dates retain a small scrollable band for each week", () => {
  const dates = Array.from({ length: 14 }, (_, index) => addDays("2026-05-11", index));
  assert.deepEqual(groupTimelineDays(dates, new Set(), new Set(dates), true), [
    { kind: "quiet", start: "2026-05-11", end: "2026-05-17", count: 7 },
    { kind: "quiet", start: "2026-05-18", end: "2026-05-24", count: 7 }
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

test("reviewed placements interleave untimed entries without adding clock times", async () => {
  const { placedTimelineEvents } = require(compiled);
  const rows = [row('a', '2026-10-01', '10:00:00', '100', '900'), row('b', '2026-10-01', null, '50', '850'), row('c', '2026-10-01', '12:00:00', '20', '830')];
  const events = placedTimelineEvents(rows, ['city'], [{account: 'city', status: 'valid', basis: 'balance', ordered_ids: ['a', 'b', 'c']}]);
  assert.deepEqual(events.events.map(event => event.row.id), ['a', 'b', 'c']);
  assert.equal(events.events[1].row.time, null); assert.equal(events.events[1].account, 'city'); assert.equal(events.unplaced.length, 0);
});
test("stale or incomplete saved placements cannot hide unknown-time entries", async () => {
  const { placedTimelineEvents } = require(compiled);
  const rows = [row('a', '2026-10-01', '10:00:00', '100', '900'), row('b', '2026-10-01', null, '50', '850')];
  for (const order of [{account: 'city', status: 'stale', ordered_ids: ['a', 'b']}, {account: 'city', status: 'valid', ordered_ids: ['a']}]) {
    const result = placedTimelineEvents(rows, ['city'], [order]); assert.deepEqual(result.unplaced.map(row => row.id), ['b']);
  }
});
