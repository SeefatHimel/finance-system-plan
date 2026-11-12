import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ context, baseURL }) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname))
    throw new Error("Merge tests require the disposable local fixture.");
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set the synthetic fixture password.");
  const response = await context.request.post("/api/auth/login", {
    data: { username: "synthetic-browser", password },
    headers: { origin: baseURL! },
  });
  expect(response.status()).toBe(200);
});

test.afterEach(async ({ context, baseURL }) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname)) return;
  const response = await context.request.get(
    "/api/backend/api/transactions/recent-action/",
  );
  if (!response.ok()) return;
  const latest = await response.json();
  if (latest?.kind === "duplicate_merge" && latest.can_undo && !latest.undone)
    await context.request.post("/api/backend/api/transactions/undo/", {
      data: { action: latest.id },
      headers: { origin: baseURL! },
    });
});

test("merge two posted entries, retain originals and undo without losing filters", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const accounts = await (
    await context.request.get("/api/backend/api/accounts/")
  ).json();
  const account = accounts.find(
    (item: { name: string }) =>
      item.name === `Synthetic duplicate ${info.project.name}`,
  );
  expect(account).toBeTruthy();
  await page.goto(`/transactions?month=2026-08&account=${account.id}`);
  const more = page.getByRole("button", {
    name: /More actions for Synthetic repayment/,
  });
  await expect(more).toHaveCount(2);
  await more.first().click();
  await page
    .getByRole("button", { name: "Merge duplicates", exact: true })
    .click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Merge duplicate entries",
      exact: true,
    }),
  });
  await expect(
    dialog.getByRole("heading", {
      name: "Merge duplicate entries",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.locator(".duplicate-merge-choices input:not(:disabled)").check();
  await dialog
    .getByRole("button", { name: "Review merge", exact: true })
    .click();
  await expect(
    dialog.getByText("1 entry · BDT 100.00", { exact: true }),
  ).toBeVisible();
  await dialog
    .locator(".duplicate-merge-evidence details")
    .first()
    .locator("summary")
    .click();
  await expect(dialog.getByText(/Transaction ID:/).first()).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include(".duplicate-merge-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: `/private/tmp/finance-merge-${info.project.name}-preview.png`,
    fullPage: true,
  });
  await dialog
    .getByLabel("I compared the originals.", { exact: false })
    .check();
  await page.route(
    /\/transactions\/merge-duplicates\/?$/,
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Synthetic preview changed. Review again.",
        }),
      }),
    { times: 1 },
  );
  await dialog
    .getByRole("button", { name: "Merge · count once", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic preview changed. Review again.", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Review merge", exact: true })
    .click();
  await dialog
    .getByLabel("I compared the originals.", { exact: false })
    .check();
  await dialog
    .getByRole("button", { name: "Merge · count once", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(more).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`account=${account.id}`));
  await page
    .getByRole("button", {
      name: "View transaction: Synthetic repayment",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByText("Pre-merge ledger versions", { exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Original ledger ID:", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close transaction details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "More transaction tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo latest action", exact: true })
    .click();
  await expect(more).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("statement review consolidates both entries and attaches the PDF row atomically", async ({
  page,
  context,
}, info) => {
  const accounts = await (
    await context.request.get("/api/backend/api/accounts/")
  ).json();
  const account = accounts.find(
    (item: { name: string }) =>
      item.name === `Synthetic duplicate ${info.project.name}`,
  );
  const history = await (
    await context.request.get("/api/backend/api/statements/imports/")
  ).json();
  const batch = (Array.isArray(history) ? history : history.results).find(
    (item: { account: string }) => item.account === account.id,
  );
  expect(batch).toBeTruthy();
  await page.goto(`/statements?import=${batch.id}`);
  await page
    .getByRole("button", { name: "Review source row 1", exact: true })
    .first()
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Different transaction ID", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByText("gift", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Review duplicate ledger entries",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Merge duplicate entries",
      exact: true,
    }),
  });
  await expect(
    dialog.getByText(
      "The pending statement will also be attached to this entry.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText("Resolve before merging", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("I compared the originals.", { exact: false })
    .check();
  await dialog
    .getByRole("button", { name: "Merge · count once", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const saved = await (
    await context.request.get(
      `/api/backend/api/transactions/?account=${account.id}`,
    )
  ).json();
  expect(saved).toHaveLength(1);
  expect(saved[0].source_labels).toEqual(["SMS", "PDF", "Spreadsheet"]);
  await page.goto(`/transactions?month=2026-08&account=${account.id}`);
  await page
    .getByRole("button", { name: "More transaction tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo latest action", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /More actions for Synthetic repayment/ }),
  ).toHaveCount(2);
});
