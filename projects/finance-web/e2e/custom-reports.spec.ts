import { test, expect } from "@playwright/test";

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
