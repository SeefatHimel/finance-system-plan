import { test, expect, type APIRequestContext } from "@playwright/test";

test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ context, baseURL }) => {
  if (!["localhost", "127.0.0.1"].includes(new URL(baseURL!).hostname)) throw new Error("Use disposable local fixtures only.");
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set FINANCE_E2E_PASSWORD for the synthetic fixture.");
  const response = await context.request.post("/api/auth/login", { data: { username: "synthetic-browser", password }, headers: { origin: baseURL! } });
  expect(response.status()).toBe(200);
});

async function fixture(request: APIRequestContext, origin: string, name: string, manualCash = false) {
  const headers = { origin }, accounts: string[] = [], transactions: string[] = [], categories: string[] = [];
  let report = "";
  const cleanup = async () => {
    if (report) await request.delete(`/api/backend/api/reports/saved/${report}/`, { headers });
    for (const id of transactions) await request.delete(`/api/backend/api/transactions/${id}/`, { headers });
    for (const id of accounts) await request.delete(`/api/backend/api/accounts/${id}/`, { headers });
    for (const id of categories) await request.delete(`/api/backend/api/categories/${id}/`, { headers });
  };
  try {
    for (const [suffix, type, starting_balance] of [["bank", "bank", "1000.00"], ["cash", "cash", "500.00"]]) {
      const response = await request.post("/api/backend/api/accounts/", { headers, data: { name: `${name} ${suffix}`, type, currency: "BDT", starting_balance } });
      expect(response.status()).toBe(201); accounts.push((await response.json()).id);
    }
    const category = await request.post("/api/backend/api/categories/", { headers, data: { name: `${name} spending`, kind: "expense" } });
    expect(category.status()).toBe(201); categories.push((await category.json()).id);
    for (const data of [
      { date: "2025-12-31", type: "expense", amount: "100.00", counterparty_text: `${name} prior` },
      { date: "2026-01-10", type: "expense", amount: "100.00", counterparty_text: `${name} purchase`, category: categories[0] },
      { date: "2026-01-12", type: "income", amount: "50.00", counterparty_text: `${name} income` },
      { date: "2026-01-13", type: "transfer", amount: "25.00", counterparty_text: `${name} transfer`, transfer_account: accounts[1] },
    ]) {
      const response = await request.post("/api/backend/api/transactions/", { headers, data: { account: accounts[0], time: "12:00:00", source: "web", direction: data.type === "income" ? "credit" : "debit", ...data } });
      expect(response.status()).toBe(201); transactions.push((await response.json()).id);
    }
    const response = await request.post("/api/backend/api/reports/saved/", { headers, data: { name, start_date: "2026-01-01", end_date: "2026-01-31", date_view: "monthly", currency: "BDT", filters: { accounts }, report_view: manualCash ? "account_statement" : "analysis", opening_balances: manualCash ? { [accounts[1]]: { mode: "manual", amount: "600.00" } } : {} } });
    expect(response.status()).toBe(201); report = (await response.json()).id;
    return { accounts, transactions, report, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

test("edit inside report details refreshes totals, selection and balances and preserves failed drafts", async ({ page, context, baseURL }, info) => {
  const name = `Synthetic report edit ${info.project.name} ${Date.now()}`;
  const data = await fixture(context.request, baseURL!, name);
  let summaries = 0, patches = 0;
  page.on("request", request => {
    if (request.url().includes("/api/backend/api/reports/monthly/") && request.method() === "GET") summaries++;
    if (request.url().includes(`/api/transactions/${data.transactions[1]}/`) && request.method() === "PATCH") patches++;
  });
  try {
    await page.goto(`/custom-reports/${data.report}`);
    await page.getByLabel("Interval", { exact: true }).selectOption("month");
    await page.getByRole("link", { name: `${name} spending`, exact: true }).click();
    const detail = page.getByRole("dialog");
    await detail.getByRole("button", { name: `${name} purchase`, exact: true }).click();
    await page.getByRole("button", { name: "Edit transaction", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit transaction", exact: true });
    const amount = editor.locator('input[name="amount"]');
    await expect(amount).toHaveValue("100.00");
    await amount.fill("999");
    page.once("dialog", dialog => dialog.accept());
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toHaveCount(0); expect(patches).toBe(0);
    await expect(page.locator(".report-transaction-facts")).toContainText("BDT 100.00");
    await page.getByRole("button", { name: "Edit transaction", exact: true }).click();
    await expect(amount).toHaveValue("100.00");
    await expect(editor.getByRole("button", { name: "Update transaction", exact: true })).toBeEnabled();
    await amount.fill("0");
    await editor.getByRole("button", { name: "Update transaction", exact: true }).click();
    await expect(editor.locator("p.form-error[role=alert]")).toBeVisible(); expect(patches).toBe(0);
    let fail = true;
    await page.route(`**/api/backend/api/transactions/${data.transactions[1]}/`, async route => {
      if (route.request().method() === "PATCH" && fail) { fail = false; await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ amount: ["Synthetic save failure; retry."] }) }); }
      else await route.continue();
    });
    await amount.fill("175.00");
    await editor.getByRole("button", { name: "Update transaction", exact: true }).click();
    await expect(editor.locator("p.form-error[role=alert]")).toContainText("Synthetic save failure");
    await expect(amount).toHaveValue("175.00");
    await expect(page.locator(".report-metric").filter({ hasText: "Net spending" })).toContainText("BDT 100.00");
    await editor.getByRole("button", { name: "Update transaction", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator(".report-transaction-facts")).toContainText("BDT 175.00");
    await expect.poll(() => page.getByRole("dialog", { name: "Transaction details", exact: true }).evaluate(element => element.contains(document.activeElement))).toBe(true);
    await expect(page.locator(".report-metric").filter({ hasText: "Net spending" })).toContainText("BDT 175.00");
    await expect.poll(() => summaries).toBe(2);
    await expect(page).toHaveURL(new RegExp(`/custom-reports/${data.report}$`));
    await page.getByRole("button", { name: `Back to ${name} spending`, exact: true }).click();
    await expect(page.getByRole("table", { name: `Transactions for ${name} spending`, exact: true })).toContainText("BDT 175.00");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByLabel("Interval", { exact: true })).toHaveValue("month");
    await page.getByRole("button", { name: "Account statements", exact: true }).click();
    const bank = page.locator(".report-statement-accounts tbody tr").filter({ hasText: `${name} bank` });
    await expect(bank).toContainText("BDT 750.00");
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    await page.getByRole("link", { name: `${name} spending`, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: `${name} purchase`, exact: true }).click();
    await page.getByRole("button", { name: "Edit transaction", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Update transaction", exact: true })).toBeEnabled();
    await editor.getByPlaceholder("dd/mm/yyyy").fill("10/02/2026");
    await editor.getByRole("button", { name: "Update transaction", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator(".report-metric").filter({ hasText: "Net spending" })).toContainText("BDT 0.00");
    await page.getByRole("button", { name: `Back to ${name} spending`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("No transactions match this selection.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Report overview", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Account statements", exact: true }).click();
    await expect(bank).toContainText("BDT 925.00");
    expect(summaries).toBe(3);
  } finally { await data.cleanup(); }
});

test("editing a transfer from an account statement refreshes both accounts and supports Undo", async ({ page, context, baseURL }, info) => {
  const name = `Synthetic statement edit ${info.project.name} ${Date.now()}`;
  const data = await fixture(context.request, baseURL!, name, true);
  try {
    await page.goto(`/custom-reports/${data.report}`);
    const bank = page.locator(".report-statement-accounts tbody tr").filter({ hasText: `${name} bank` });
    const cash = page.locator(".report-statement-accounts tbody tr").filter({ hasText: `${name} cash` });
    await expect(bank).toContainText("BDT 825.00"); await expect(cash).toContainText("BDT 625.00");
    await bank.getByRole("button", { name: `${name} bank`, exact: true }).click();
    await page.getByRole("button", { name: `Edit transaction: ${name} transfer`, exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit transaction", exact: true });
    await expect(editor.getByRole("button", { name: "Update transaction", exact: true })).toBeEnabled();
    await editor.locator('input[name="amount"]').fill("50.00");
    await editor.getByRole("button", { name: "Update transaction", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: `${name} bank`, exact: true })).toBeVisible();
    await expect(bank).toContainText("BDT 800.00"); await expect(cash).toContainText("BDT 650.00");
    await expect.poll(() => page.getByRole("dialog", { name: `${name} bank`, exact: true }).evaluate(element => element.contains(document.activeElement))).toBe(true);
    const transfer = page.getByRole("table", { name: `${name} bank transactions and running balance, oldest first`, exact: true }).getByRole("row").filter({ hasText: `${name} transfer` });
    await expect(transfer).toContainText("BDT 50.00"); await expect(transfer).toContainText("BDT 800.00");
    const savedCash = await context.request.get(`/api/backend/api/accounts/${data.accounts[1]}/`);
    expect((await savedCash.json()).ledger_balance).toBe("550.00");
    await page.locator(".action-toast").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(bank).toContainText("BDT 825.00"); await expect(cash).toContainText("BDT 625.00");
    await expect(transfer).toContainText("BDT 25.00");
    await expect(page).toHaveURL(new RegExp(`/custom-reports/${data.report}\\?`));
  } finally { await data.cleanup(); }
});

test("a transaction opened from the report list stays current after save and Undo", async ({ page, context, baseURL }, info) => {
  const name = `Synthetic direct edit ${info.project.name} ${Date.now()}`;
  const data = await fixture(context.request, baseURL!, name);
  let entryReads = 0;
  page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === `/api/backend/api/transactions/${data.transactions[1]}/`) entryReads++; });
  try {
    await page.goto(`/custom-reports/${data.report}`);
    await page.getByRole("table", { name: `Transactions selected by ${name}`, exact: true }).getByRole("button", { name: `${name} purchase`, exact: true }).click();
    await page.getByRole("button", { name: "Edit transaction", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Edit transaction", exact: true });
    await expect(editor.getByRole("button", { name: "Update transaction", exact: true })).toBeEnabled();
    await editor.locator('input[name="amount"]').fill("120.00");
    await editor.getByRole("button", { name: "Update transaction", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator(".report-transaction-facts")).toContainText("BDT 120.00");
    await expect(page.locator(".report-metric").filter({ hasText: "Net spending" })).toContainText("BDT 120.00");
    expect(entryReads).toBe(1);
    await page.locator(".action-toast").getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".report-transaction-facts")).toContainText("BDT 100.00");
    await expect(page.locator(".report-metric").filter({ hasText: "Net spending" })).toContainText("BDT 100.00");
    expect(entryReads).toBe(2);
    await expect(page).toHaveURL(new RegExp(`/custom-reports/${data.report}$`));
  } finally { await data.cleanup(); }
});
