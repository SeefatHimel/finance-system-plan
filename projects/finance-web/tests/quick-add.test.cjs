const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const moduleShim = { exports: {} };
const source = readFileSync(
  resolve(__dirname, "../../finance-contracts/quick-add.ts"),
  "utf8",
);
new Function(
  "module",
  "exports",
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText,
)(moduleShim, moduleShim.exports);
const q = moduleShim.exports;
const preset = {
  ...q.blankPreset(),
  id: "preset",
  available: true,
  name: "Lunch",
  account: "cash",
  category: "food",
  amount: "80.00",
  note: "Default note",
};
test("presets copy defaults and preserve manually entered amount and note without changing the template", () => {
  const draft = q.newQuickDraft(preset);
  assert.equal(draft.amount, "80.00");
  assert.equal(draft.account, "cash");
  draft.amount = "125";
  draft.note = "Actual purchase";
  const changed = q.applyQuickPreset(draft, {
    ...preset,
    account: "other",
    amount: "20",
    note: "Other default",
  });
  assert.equal(changed.account, "other");
  assert.equal(changed.amount, "125");
  assert.equal(changed.note, "Actual purchase");
  assert.equal(preset.amount, "80.00");
  assert.equal(preset.note, "Default note");
});
test("Now resolves on first Save using local days and retry snapshots retain their date and time", () => {
  const draft = q.newQuickDraft(preset, new Date(2026, 9, 12, 23, 59));
  const id = q.newEntryId();
  const input = q.buildQuickEntry(
    draft,
    id,
    "web",
    new Date(2026, 9, 13, 0, 7),
  );
  assert.equal(input.date, "2026-10-13");
  assert.equal(input.time, "00:07");
  draft.amount = "1";
  draft.time = "12:00";
  assert.equal(input.amount, "80.00");
  assert.equal(input.time, "00:07");
  const restored = q.entrySnapshot(JSON.parse(JSON.stringify(input)), "web");
  assert.deepEqual(restored, input);
  assert.equal(q.draftFromEntry(restored).timeMode, "custom");
  assert.notEqual(q.newEntryId(), id);
});
test("unknown time, AM/PM boundaries and every minute are preserved without rounding", () => {
  const draft = {
    ...q.newQuickDraft(preset),
    dateMode: "custom",
    date: "2024-02-29",
    timeMode: "custom",
  };
  for (let minute = 0; minute < 60; minute++) {
    const time = `13:${String(minute).padStart(2, "0")}`;
    assert.equal(
      q.buildQuickEntry({ ...draft, time }, q.newEntryId(), "mobile").time,
      time,
    );
  }
  for (const time of ["00:00", "12:00", "23:59"])
    assert.equal(
      q.buildQuickEntry({ ...draft, time }, q.newEntryId(), "mobile").time,
      time,
    );
  assert.equal(
    q.buildQuickEntry({ ...draft, timeMode: "none" }, q.newEntryId(), "mobile")
      .time,
    null,
  );
});
test("invalid dates, amounts and times are rejected before posting", () => {
  const draft = q.newQuickDraft(preset);
  for (const amount of ["0", "-1", "1.234", "1000000000000", "abc"])
    assert.throws(
      () => q.buildQuickEntry({ ...draft, amount }, q.newEntryId(), "web"),
      /positive amount/,
    );
  for (const date of ["2026-02-30", "2026-99-99", "2026-2-1"])
    assert.throws(
      () =>
        q.buildQuickEntry(
          { ...draft, date, dateMode: "custom" },
          q.newEntryId(),
          "web",
        ),
      /valid date/,
    );
  for (const time of ["24:00", "12:60", "1:05"])
    assert.throws(
      () =>
        q.buildQuickEntry(
          { ...draft, time, timeMode: "custom" },
          q.newEntryId(),
          "web",
        ),
      /valid time/,
    );
  assert.throws(
    () =>
      q.entrySnapshot(
        {
          ...q.buildQuickEntry(draft, q.newEntryId(), "web"),
          source: "mobile",
        },
        "web",
      ),
    /invalid/,
  );
});
