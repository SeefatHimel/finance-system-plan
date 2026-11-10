import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ context, baseURL }) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname))
    throw new Error("Cash-count tests require the disposable local fixture.");
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set the synthetic fixture password.");
  const result = await context.request.post("/api/auth/login", {
    data: { username: "synthetic-browser", password },
    headers: { origin: baseURL! },
  });
  expect(result.status()).toBe(200);
});

async function cashAccount(
  request: APIRequestContext,
  baseURL: string,
  label: string,
  type = "cash",
) {
  const response = await request.post("/api/backend/api/accounts/", {
    data: {
      name: label,
      type,
      currency: "BDT",
      starting_balance: "1000",
      is_active: true,
    },
    headers: { origin: baseURL },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test("a count can differ, be compared and corrected without leaving the page", async ({
  page,
  context,
  baseURL,
}, info) => {
  const account = await cashAccount(
    context.request,
    baseURL!,
    `Synthetic single ${info.project.name} ${Date.now()}`,
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/cash-counts");
  await page
    .getByLabel("Cash account", { exact: true })
    .selectOption(account.id);
  await page.getByLabel("Count date", { exact: true }).fill("03/02/2026");
  await page.getByLabel("Counted cash (BDT)", { exact: true }).fill("950");
  await page
    .getByLabel("Count notes", { exact: true })
    .fill("Synthetic observed cash");
  await page
    .getByRole("button", { name: "Preview cash counts", exact: true })
    .click();
  await expect(
    page.getByText("Confirm that date-only counts are end-of-day balances.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Counts without a time are end-of-day balances.")
    .check();
  await page
    .getByRole("button", { name: "Refresh count preview", exact: true })
    .click();
  await expect(
    page.getByText("Needs review · saving is allowed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save cash counts", exact: true }),
  ).toBeEnabled();
  const audit = await new AxeBuilder({ page })
    .include(".cash-count-workspace")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: `/private/tmp/finance-cash-${info.project.name}-preview.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Save cash counts", exact: true })
    .click();
  await expect(
    page.getByText("1 cash count was saved.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("History account").selectOption(account.id);
  const row = page.locator(".cash-count-history tbody tr");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Compare movements" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Compare cash counts" }),
  ).toBeVisible();
  await expect(dialog.getByText(/This is the first saved count/)).toBeVisible();
  const modalAudit = await new AxeBuilder({ page })
    .include("dialog[open]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(modalAudit.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("History account")).toHaveValue(account.id);
  await expect(
    row.getByRole("button", { name: "Compare movements" }),
  ).toBeFocused();
  await row.getByRole("button", { name: "Correct count" }).click();
  await page.getByLabel("Counted cash (BDT)", { exact: true }).fill("940");
  await page.getByLabel("Count date", { exact: true }).fill("07/02/2026");
  await page
    .getByRole("button", { name: "Preview cash counts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save cash counts", exact: true })
    .click();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("940.00");
  await expect(row).toContainText("07/02/2026");
  expect(errors).toEqual([]);
});

test("pasted counts compare the same persistent difference and ignore spreadsheet expectations", async ({
  page,
  context,
  baseURL,
}, info) => {
  const label = `Synthetic storage ${info.project.name} ${Date.now()}`;
  const account = await cashAccount(
    context.request,
    baseURL!,
    label,
    "home_cash",
  );
  await page.goto("/cash-counts");
  await page
    .getByRole("button", { name: "Paste count table", exact: true })
    .click();
  await page
    .getByLabel("Paste count table", { exact: true })
    .fill(
      `Storage Account\tDate\tCounted Balance\tExpected Balance\n${label}\t2026-02-04\t1100\t42\n${label}\t2026-02-05\t1100\t43`,
    );
  await page
    .getByLabel("Counts without a time are end-of-day balances.")
    .check();
  await page
    .getByRole("button", { name: "Preview cash counts", exact: true })
    .click();
  await expect(
    page.getByText(
      "The same net difference persists from the previous count.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Spreadsheet expected balance: 42 (reference only).", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save cash counts", exact: true })
    .click();
  await page.getByLabel("History account").selectOption(account.id);
  await expect(page.locator(".cash-count-history tbody tr")).toHaveCount(2);
  await page
    .locator(".cash-count-history tbody tr")
    .first()
    .getByRole("button", { name: "Compare movements" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(
      /The same net difference persists from the previous count/,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: `/private/tmp/finance-cash-${info.project.name}-comparison.png`,
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/cash-counts$/);
});

test("specific-time counts order untimed entries without inventing transaction times", async ({
  page,
  context,
  baseURL,
}, info) => {
  const account = await cashAccount(
    context.request,
    baseURL!,
    `Synthetic timed ${info.project.name} ${Date.now()}`,
  );
  const movement = await context.request.post(
    "/api/backend/api/transactions/",
    {
      data: {
        account: account.id,
        date: "2026-02-06",
        type: "expense",
        direction: "debit",
        amount: "100",
        counterparty_text: "Synthetic untimed purchase",
      },
      headers: { origin: baseURL! },
    },
  );
  expect(movement.status(), await movement.text()).toBe(201);
  await page.goto("/cash-counts");
  await page
    .getByLabel("Cash account", { exact: true })
    .selectOption(account.id);
  await page.getByLabel("Count date", { exact: true }).fill("06/02/2026");
  await page
    .getByLabel("Count time (optional)", { exact: true })
    .fill("18:00:00");
  await page.getByLabel("Counted cash (BDT)", { exact: true }).fill("900");
  await page
    .getByRole("button", { name: "Preview cash counts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save cash counts", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Default order for count 1").selectOption("before");
  await page
    .getByRole("button", { name: "Refresh count preview", exact: true })
    .click();
  await expect(
    page.getByText("Matches ledger", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save cash counts", exact: true })
    .click();
  await page.getByLabel("History account").selectOption(account.id);
  await expect(page.locator(".cash-count-history tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Compare movements", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("06/02/2026 · Time unknown", { exact: true }),
  ).toBeVisible();
  const original = await context.request.get(
    `/api/backend/api/transactions/${(await movement.json()).id}/`,
  );
  expect((await original.json()).time).toBeNull();
});
