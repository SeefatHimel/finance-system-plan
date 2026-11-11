import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ context, baseURL }) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname))
    throw new Error(
      "Bulk-import browser tests require an isolated local workspace.",
    );
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set the synthetic browser fixture password.");
  const response = await context.request.post("/api/auth/login", {
    data: { username: "synthetic-browser", password },
    headers: { origin: baseURL! },
  });
  expect(response.status()).toBe(200);
});

test("paste, checkpoint, record, source inspection and undo preserve the workspace", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/transactions?month=2026-01&page=2");
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Import cash entries" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Wallet or account")).toBeFocused();
  const label = `Synthetic bulk ${testInfo.project.name} ${Date.now()}`;
  await dialog
    .getByLabel("Paste table")
    .fill(
      `Date\tCategory\tDescription\tAmount\tNotes\n2026-04-11\t\t${label} lunch\t150.00\tSynthetic note\n2026-04-11\t\t${label} refund\t-20.00\t`,
    );
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Review imported entries" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("11/04/2026 · Time unknown", { exact: true }).first(),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Add balance checkpoint", exact: true })
    .click();
  await dialog.getByLabel("Balance date 1").fill("11/04/2026");
  await dialog.getByLabel("Counted balance 1 (BDT)").fill("870");
  await dialog.getByLabel("This is the end-of-day balance.").check();
  await expect(
    dialog.getByRole("button", { name: "Import approved entries" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Import approved entries" }),
  ).toBeEnabled();
  const qa = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(qa.violations).toEqual([]);
  await dialog
    .locator(".bulk-import-body")
    .evaluate((element) => (element.scrollTop = 0));
  await page.screenshot({
    path: `/private/tmp/finance-bulk-${testInfo.project.name}-review.png`,
    fullPage: false,
  });
  await dialog.getByRole("button", { name: "Import approved entries" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Your entries are recorded" }),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "2 new entries · 0 linked sources · 0 skipped rows · 1 balance checkpoints",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/month=2026-01.*page=2/);
  await dialog.getByText("Original table · 2 rows", { exact: true }).click();
  await expect(
    dialog.getByText("Synthetic note", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  await dialog.getByText(/Recent imports/).click();
  await dialog
    .getByRole("button", { name: /Pasted table.*Committed/ })
    .first()
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import receipt" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Undo this import", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm Undo import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import undone", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Review this table again", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Review imported entries" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close import", exact: true })
    .click();
  expect(errors).toEqual([]);
});

test("missing values can be skipped and same-day repeats are explicitly kept", async ({
  page,
}, testInfo) => {
  await page.goto("/transactions?month=2026-01");
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const name = `Synthetic repeated tea ${testInfo.project.name} ${Date.now()}`;
  await dialog
    .getByLabel("Paste table")
    .fill(
      `Date\tDescription\tAmount\n2026-04-12\t${name}\t30\n2026-04-12\t${name}\t30\n2026-04-12\tSynthetic missing\t0`,
    );
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Import approved entries" }),
  ).toBeDisabled();
  await dialog.getByLabel("Action for row 3").selectOption("skip");
  await dialog
    .getByRole("button", {
      name: "Mark highlighted details reviewed",
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Import approved entries" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Import approved entries" }).click();
  await expect(
    dialog.getByText(
      "2 new entries · 0 linked sources · 1 skipped rows · 0 balance checkpoints",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Undo this import", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm Undo import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import undone", exact: true }),
  ).toBeVisible();
});

test("linking spreadsheet evidence keeps the existing movement and exposes its original row", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const headers = { origin: baseURL! };
  const accounts = await (
    await context.request.get("/api/backend/api/accounts/")
  ).json();
  const wallet = accounts.find(
    (account: { name: string }) => account.name === "Synthetic QA Cash",
  );
  const amount = (((Date.now() % 1_000_000) + 10_000) / 100).toFixed(2);
  const label = `Synthetic original bulk match ${testInfo.project.name} ${Date.now()}`;
  const response = await context.request.post(
    "/api/backend/api/transactions/",
    {
      headers,
      data: {
        account: wallet.id,
        date: "2026-04-13",
        type: "expense",
        amount,
        counterparty_text: label,
        source: "web",
      },
    },
  );
  expect(response.status()).toBe(201);
  const entry = await response.json();
  await page.goto("/transactions?month=2026-01");
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Paste table")
    .fill(
      `Date,Description,Amount,Notes\n2026-04-13,${label},${amount},Synthetic linked original row`,
    );
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await dialog.getByText(/1 possible match/).click();
  await dialog
    .getByLabel("Notes for row 1", { exact: true })
    .fill("Reviewed linked import note");
  await dialog.getByRole("radio").first().check();
  await dialog.getByLabel("I reviewed this row and its chosen action.").check();
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Import approved entries" }).click();
  await expect(
    dialog.getByText(
      "0 new entries · 1 linked sources · 0 skipped rows · 0 balance checkpoints",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto(
    `/transactions?month=2026-04&search=${encodeURIComponent(label)}`,
  );
  await page
    .getByRole("button", { name: `View transaction: ${label}`, exact: true })
    .first()
    .click();
  await expect(
    dialog.getByText("Spreadsheet evidence · 1 row", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByText("Spreadsheet evidence · 1 row", { exact: true })
    .click();
  await expect(
    dialog.getByText("Synthetic linked original row", { exact: true }),
  ).toBeVisible();
  await dialog.getByText("Reviewed import notes", { exact: true }).click();
  await expect(
    dialog.getByText("Reviewed linked import note", { exact: true }),
  ).toBeVisible();
  const retained = await (
    await context.request.get(`/api/backend/api/transactions/${entry.id}/`)
  ).json();
  expect(retained.note).toBe(entry.note);
  await dialog
    .getByRole("button", { name: "Close transaction details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  await dialog.getByText(/Recent imports/).click();
  await dialog
    .getByRole("button", { name: /Pasted table.*Committed/ })
    .first()
    .click();
  await dialog
    .getByRole("button", { name: "Undo this import", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm Undo import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import undone", exact: true }),
  ).toBeVisible();
  expect(
    (
      await context.request.get(`/api/backend/api/transactions/${entry.id}/`)
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.delete(
        `/api/backend/api/transactions/${entry.id}/`,
        { headers },
      )
    ).status(),
  ).toBe(204);
});

test("timed checkpoints order untimed entries without inventing clock times", async ({
  page,
  context,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem("finance.theme.v1", "dark"),
  );
  await page.goto("/transactions?month=2026-01");
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const label = `Synthetic timed checkpoint ${testInfo.project.name} ${Date.now()}`;
  await dialog
    .getByLabel("Paste table")
    .fill(
      `Date,Description,Amount\n2026-04-14,${label} expense,10\n2026-04-14,${label} refund,-5`,
    );
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Add balance checkpoint", exact: true })
    .click();
  await dialog.getByLabel("Balance date 1").fill("14/04/2026");
  await dialog.getByLabel("Counted balance 1 (BDT)").fill("0");
  await dialog
    .getByLabel("Balance time 1 (optional)", { exact: true })
    .fill("18:00:00");
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Import approved entries" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Untimed entries on this day happened")
    .selectOption("before");
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await dialog
    .getByText("Review 2 untimed entries / mark exceptions", { exact: true })
    .click();
  await dialog
    .locator(".bulk-import-untimed")
    .filter({ hasText: "refund" })
    .getByRole("combobox")
    .selectOption("after");
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Import approved entries" }),
  ).toBeEnabled();
  const axe = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: `/private/tmp/finance-bulk-${testInfo.project.name}-timed.png`,
    fullPage: false,
  });
  await dialog.getByRole("button", { name: "Import approved entries" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Your entries are recorded" }),
  ).toBeVisible();
  const records = await (
    await context.request.get(
      `/api/backend/api/transactions/?search=${encodeURIComponent(label)}`,
    )
  ).json();
  expect(records).toHaveLength(2);
  expect(records.every((r: { time: string | null }) => r.time === null)).toBe(
    true,
  );
  await dialog
    .getByRole("button", { name: "Undo this import", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm Undo import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import undone", exact: true }),
  ).toBeVisible();
});

test("category suggestions and editable notes preserve originals and explicit choices", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/transactions?month=2026-01&page=2");
  await expect(page).toHaveTitle(/finance/i);
  await page
    .getByRole("button", { name: "Import entries", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const label = `Synthetic category notes ${testInfo.project.name} ${Date.now()}`;
  await dialog
    .getByLabel("Paste table")
    .fill(
      `Date\tCategory\tDescription\tAmount\tNotes\n2026-05-15\tTransportation\t${label} ride\t10.25\tOriginal ride context\n2026-05-15\tBills\t${label} bill\t20.50\tOriginal bill context`,
    );
  await dialog
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Review imported entries" }),
  ).toBeVisible();
  const mapping = dialog
    .locator("details")
    .filter({
      has: page.locator("summary", {
        hasText: "Column mapping and category choices",
      }),
    })
    .first();
  await mapping.locator("summary").first().click();
  await expect(
    mapping
      .getByLabel("Transportation", { exact: true })
      .locator("option:checked"),
  ).toHaveText("Transport");
  await expect(
    mapping.getByText("Suggested: Transportation → Transport", { exact: true }),
  ).toBeVisible();
  const mappingQa = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(mappingQa.violations).toEqual([]);
  const transport = await mapping
    .getByLabel("Transportation", { exact: true })
    .inputValue();
  await mapping.getByLabel("Bills", { exact: true }).selectOption("");
  const first = dialog.locator(".bulk-import-row").nth(0);
  await first.locator("summary").first().click();
  await expect(
    first.getByLabel("Category for row 1").locator("option:checked"),
  ).toHaveText("Transport");
  const notes = first.getByLabel("Notes for row 1", { exact: true });
  await expect(notes).toHaveValue("Original ride context");
  await notes.fill("");
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(notes).toHaveValue("");
  await expect(mapping.getByLabel("Bills", { exact: true })).toHaveValue("");
  await mapping
    .getByLabel("Bills", { exact: true })
    .selectOption({ label: "Electricity" });
  const chosenCategory = await mapping
    .getByLabel("Bills", { exact: true })
    .inputValue();
  const edited = "Reviewed ride context\nSecond line of notes";
  await notes.fill(edited);
  await dialog
    .getByRole("button", { name: "Refresh preview", exact: true })
    .click();
  await expect(notes).toHaveValue(edited);
  await mapping.locator("summary").first().click();
  await first
    .getByText("Original table row · unchanged", { exact: true })
    .click();
  await expect(
    first.getByText("Original ride context", { exact: true }),
  ).toBeVisible();
  const qa = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(qa.violations).toEqual([]);
  await notes.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/private/tmp/finance-import-notes-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await dialog
    .getByRole("button", { name: "Import approved entries", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Your entries are recorded" }),
  ).toBeVisible();
  const records = await (
    await context.request.get(
      `/api/backend/api/transactions/?search=${encodeURIComponent(label)}`,
    )
  ).json();
  expect(records).toHaveLength(2);
  const ride = records.find((record: { counterparty_text: string }) =>
    record.counterparty_text.endsWith(" ride"),
  );
  const bill = records.find((record: { counterparty_text: string }) =>
    record.counterparty_text.endsWith(" bill"),
  );
  expect(ride.category).toBe(transport);
  expect(ride.note).toContain(edited);
  expect(ride.note).not.toContain("Original ride context");
  expect(ride.type).toBe("expense");
  expect(ride.direction).toBe("debit");
  expect(bill.category).toBe(chosenCategory);
  expect(bill.note).toContain("Original bill context");
  await dialog.getByText("Original table · 2 rows", { exact: true }).click();
  await expect(
    dialog.getByText("Original ride context", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/month=2026-01.*page=2/);
  await dialog
    .getByRole("button", { name: "Undo this import", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm Undo import", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Import undone", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
