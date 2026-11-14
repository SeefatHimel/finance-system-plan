import { test, expect } from "@playwright/test";

test.use({ actionTimeout: 10_000 });

test.beforeEach(async ({ context, baseURL }) => {
  if (!["localhost", "127.0.0.1"].includes(new URL(baseURL!).hostname)) throw new Error("Report flow tests require the disposable local fixture.");
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set FINANCE_E2E_PASSWORD for the synthetic fixture.");
  const response = await context.request.post("/api/auth/login", { data: { username: "synthetic-browser", password }, headers: { origin: baseURL! } });
  expect(response.status()).toBe(200);
});

test("library, builder and saved results have distinct routes", async ({ page, context, baseURL }, info) => {
  const name = `Synthetic report ${info.project.name} ${Date.now()}`;
  const ids: string[] = [];
  try {
    await page.goto("/custom-reports");
    await expect(page.getByLabel("Search reports", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Report name", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "New report", exact: true }).click();
    await expect(page).toHaveURL(/\/custom-reports\/new$/);
    await page.getByLabel("Report name", { exact: true }).fill(name);
    await expect(page.getByRole("heading", { name: "Live preview", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save report", exact: true }).click();
    await expect(page).toHaveURL(/\/custom-reports\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!; ids.push(id);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByLabel("Report name", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove from report", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Show transactions", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Manage transactions", exact: true }).click();
    await expect(page.getByLabel("Show transactions", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Done managing transactions", exact: true }).click();
    await expect(page.getByLabel("Show transactions", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export CSV", exact: true })).toBeEnabled();
    await page.getByRole("link", { name: "Edit report", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/custom-reports/${id}/edit$`));
    await page.getByLabel("Report name", { exact: true }).fill(`${name} edited`);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/custom-reports/${id}$`));
    await expect(page.getByRole("heading", { name: `${name} edited`, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "All custom reports", exact: false }).click();
    await page.getByLabel("Search reports", { exact: true }).fill(name);
    const row = page.locator(".report-library-row").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole("link", { name: "View report", exact: true }).click();
    await page.getByRole("link", { name: "All custom reports", exact: false }).click();
    await expect(page.getByLabel("Search reports", { exact: true })).toHaveValue(name);
    await row.getByRole("button", { name: `More actions for ${name} edited`, exact: true }).click();
    await row.getByRole("link", { name: "Duplicate", exact: true }).click();
    await page.getByLabel("Report name", { exact: true }).fill(`${name} copy`);
    await page.getByRole("button", { name: "Save report", exact: true }).click();
    await expect(page).toHaveURL(/\/custom-reports\/[0-9a-f-]{36}$/);
    const copyId = new URL(page.url()).pathname.split("/").at(-1)!; ids.push(copyId);
    expect(copyId).not.toBe(id);
    await expect(page.getByRole("heading", { name: `${name} copy`, exact: true })).toBeVisible();
  } finally {
    for (const id of ids) await context.request.delete(`/api/backend/api/reports/saved/${id}/`, { headers: { origin: baseURL! } });
  }
});

test("account statements retain report-only reported and editable opening balances", async ({ page, context, baseURL }, info) => {
  const name = `Synthetic statement ${info.project.name} ${Date.now()}`;
  const headers = { origin: baseURL! };
  const accounts: string[] = [], transactions: string[] = [];
  let reportId = "";
  try {
    for (const [suffix, type, starting_balance] of [["bank", "bank", "1000.00"], ["cash", "cash", "0.00"]]) {
      const response = await context.request.post("/api/backend/api/accounts/", { headers, data: { name: `${name} ${suffix}`, type, currency: "BDT", starting_balance } });
      expect(response.status()).toBe(201); accounts.push((await response.json()).id);
    }
    for (const data of [
      { date: "2025-12-31", type: "expense", amount: "100.00", balance_after: "800.00" },
      { date: "2026-01-01", type: "expense", amount: "100.00" },
      { date: "2026-01-02", type: "income", amount: "50.00" },
      { date: "2026-01-03", type: "transfer", amount: "50.00", transfer_account: accounts[1] },
    ]) {
      const response = await context.request.post("/api/backend/api/transactions/", { headers, data: { account: accounts[0], time: "12:00:00", source: "web", direction: data.type === "income" ? "credit" : "debit", ...data } });
      expect(response.status()).toBe(201); transactions.push((await response.json()).id);
    }
    const response = await context.request.post("/api/backend/api/reports/saved/", { headers, data: { name, start_date: "2026-01-01", end_date: "2026-01-31", date_view: "monthly", currency: "BDT", report_view: "account_statement", filters: { accounts } } });
    expect(response.status()).toBe(201); reportId = (await response.json()).id;
    await page.goto(`/custom-reports/${reportId}?statement_account=${accounts[0]}`);
    const summary = page.getByRole("table", { name: "Opening and closing balance by account" }).getByRole("row").filter({ hasText: `${name} bank` });
    await expect(summary).toContainText("BDT 900.00");
    await expect(summary).toContainText("BDT 800.00");
    await page.getByRole("button", { name: "Edit opening balance", exact: true }).click();
    await page.getByLabel("Starting balance basis", { exact: true }).selectOption("reported");
    await expect(page.getByRole("dialog")).toContainText("BDT 700.00");
    await page.getByRole("button", { name: "Save opening balance", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(summary).toContainText("BDT 700.00");
    await page.getByRole("button", { name: "Edit opening balance", exact: true }).click();
    await page.getByLabel("Starting balance basis", { exact: true }).selectOption("manual");
    await expect(page.getByLabel("Starting balance (BDT, signed)", { exact: true })).toHaveValue("800.00");
    await page.getByLabel("Starting balance (BDT, signed)", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Save opening balance", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(summary).toContainText("BDT 0.00");
    await expect(summary).toContainText("−BDT 100.00");
    const savedAccount = await context.request.get(`/api/backend/api/accounts/${accounts[0]}/`);
    expect((await savedAccount.json()).ledger_balance).toBe("800.00");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export statement CSV", exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("account-statement.csv");
    await page.getByRole("link", { name: "Open account transactions", exact: true }).click();
    await page.getByRole("link", { name: "Back to report", exact: false }).click();
    await expect(page.getByLabel("Statement account", { exact: true })).toHaveValue(accounts[0]);
  } finally {
    if (reportId) await context.request.delete(`/api/backend/api/reports/saved/${reportId}/`, { headers });
    for (const id of transactions) await context.request.delete(`/api/backend/api/transactions/${id}/`, { headers });
    for (const id of accounts) await context.request.delete(`/api/backend/api/accounts/${id}/`, { headers });
  }
});

test("analysis has inspectable chart and table views and the builder validates amount bounds", async ({ page, context, baseURL }, info) => {
  const headers = { origin: baseURL! };
  const response = await context.request.post("/api/backend/api/reports/saved/", { headers, data: { name: `Synthetic charts ${info.project.name} ${Date.now()}`, start_date: "2026-01-01", end_date: "2026-01-31", date_view: "monthly", currency: "BDT", filters: {} } });
  expect(response.status()).toBe(201); const { id } = await response.json();
  try {
    await page.goto(`/custom-reports/${id}`);
    await expect(page.getByRole("heading", { name: "Activity over time", exact: true })).toBeVisible();
    await page.getByRole("group", { name: "Activity view", exact: true }).getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.getByRole("table", { name: "Report activity by day", exact: true })).toBeVisible();
    await page.getByLabel("Interval", { exact: true }).selectOption("month");
    await expect(page.getByRole("table", { name: "Report activity by month", exact: true })).toBeVisible();
    await page.getByRole("group", { name: "Breakdown view", exact: true }).getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.getByRole("table", { name: "Net spending by categories compared with the previous period", exact: true })).toBeVisible();
    await page.getByLabel("Group by", { exact: true }).selectOption("merchants");
    await expect(page.getByRole("table", { name: "Net spending by merchants compared with the previous period", exact: true })).toBeVisible();
    await page.goto("/custom-reports/new?template=spending");
    await expect(page.getByLabel("Report name", { exact: true })).toHaveValue("Spending review");
    await page.getByRole("button", { name: "Last month", exact: true }).click();
    await page.getByText("Transaction filters and amount limits", { exact: true }).click();
    await page.getByLabel("Minimum amount (BDT)", { exact: true }).fill("20");
    await page.getByLabel("Maximum amount (BDT)", { exact: true }).fill("10");
    await expect(page.getByRole("alert").filter({ hasText: "Maximum amount must be at least" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save report", exact: true })).toBeDisabled();
    await page.getByLabel("Maximum amount (BDT)", { exact: true }).fill("30");
    await expect(page.getByRole("button", { name: "Save report", exact: true })).toBeEnabled();
  } finally { await context.request.delete(`/api/backend/api/reports/saved/${id}/`, { headers }); }
});

test("cancel discards editing without changing the saved report", async ({ page, context, baseURL }, info) => {
  const name = `Synthetic discard ${info.project.name} ${Date.now()}`;
  const response = await context.request.post("/api/backend/api/reports/saved/", { data: { name, start_date: "2026-01-01", end_date: "2026-01-31", date_view: "monthly", currency: "BDT", account: null, filters: {} }, headers: { origin: baseURL! } });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  try {
    await page.goto(`/custom-reports/${id}/edit`);
    await page.getByLabel("Report name", { exact: true }).fill(`${name} unsaved`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Discard unsaved report changes?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel("Report name", { exact: true })).toHaveValue(`${name} unsaved`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.getByRole("button", { name: "Discard changes and leave", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/custom-reports/${id}$`));
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const saved = await context.request.get(`/api/backend/api/reports/saved/${id}/`);
    expect((await saved.json()).name).toBe(name);
  } finally {
    await context.request.delete(`/api/backend/api/reports/saved/${id}/`, { headers: { origin: baseURL! } });
  }
});
