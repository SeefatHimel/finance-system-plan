import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("saved ride categories refresh pending SMS and pairs without changing Food or manual edits", async ({
  page,
  context,
  baseURL,
}, info) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname))
    throw new Error("Use the disposable local fixture.");
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set the synthetic fixture password.");
  const headers = { origin: baseURL! };
  expect(
    (
      await context.request.post("/api/auth/login", {
        data: { username: "synthetic-browser", password },
        headers,
      })
    ).status(),
  ).toBe(200);
  const post = async (path: string, data: unknown) => {
    const response = await context.request.post(`/api/backend/api/${path}`, {
      data,
      headers,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const tag = `Synthetic category ${info.project.name} ${Date.now()}`;
  const account = await post("accounts/", {
    name: tag,
    type: "mobile_wallet",
    currency: "BDT",
  });
  const transport = await post("categories/", {
    name: `${tag} transport`,
    kind: "expense",
  });
  const food = await post("categories/", {
    name: `${tag} food`,
    kind: "expense",
  });
  const manual = await post("categories/", {
    name: `${tag} manual`,
    kind: "expense",
  });
  const sender = `SYNTH-CATEGORY-${info.project.name}-${Date.now()}`;
  await post("messages/sender-rules/", {
    account: account.id,
    name: tag,
    sender,
    provider: "pathao_pay",
  });
  const imported = async (
    merchant: string,
    amount: number,
    reference: string,
  ) =>
    (
      await post("messages/import/", {
        sender,
        body: `Payment of BDT ${amount}.00 to ${merchant} successful. Balance BDT 1100.00. TrxID ${reference}`,
        received_at: "2026-01-02T16:55:00+06:00",
        device_message_id: `${sender}-${reference}`,
      })
    ).candidate;
  const first = await imported("Pathao Car", 10, "SYNTH-FIRST");
  const ride = await imported("Pathao Bike", 100, "SYNTH01");
  const meal = await imported("Pathao Food", 20, "SYNTH-FOOD");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`/messages/review?candidate=${first.id}`);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Account involved", exact: true })
    .selectOption(account.id);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const category = page.getByLabel("Category", { exact: true });
  await category.selectOption(transport.id);
  await page
    .getByRole("button", { name: "Confirm & add", exact: true })
    .click();
  const save = page.getByRole("button", {
    name: "Save for similar SMS",
    exact: true,
  });
  await expect(save).toBeVisible();
  await page
    .locator(".review-queue-item")
    .filter({ hasText: "Pathao Bike" })
    .first()
    .click();
  await expect(category).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Ledger note", exact: true })
    .fill("Keep my synthetic note");
  await save.click();
  await expect(category).toHaveValue(transport.id);
  await expect(
    page.getByRole("textbox", { name: "Ledger note", exact: true }),
  ).toHaveValue("Keep my synthetic note");
  await page
    .locator(".review-queue-item")
    .filter({ hasText: "Pathao Food" })
    .first()
    .click();
  await expect(category).toHaveValue("");
  const stored = await (
    await context.request.get(`/api/backend/api/messages/review/${ride.id}/`)
  ).json();
  expect(stored.category).toBeNull();
  expect(stored.suggested_category).toBe(transport.id);
  // Generate an in-memory synthetic PDF with the existing provider-layout fixture.
  const pdf = execFileSync(
    process.env.FINANCE_E2E_PYTHON ?? "python",
    [
      "-c",
      `
import sys, django
django.setup()
from unittest.mock import patch
from reportlab.pdfgen import canvas
from apps.statements.test_pathao import pathao_pdf
original = canvas.Canvas.drawString
def draw(self, x, y, value, *args, **kwargs):
    return original(self, x, y, "Pathao Bike" if value == "Synthetic Ride" else value, *args, **kwargs)
with patch.object(canvas.Canvas, "drawString", draw):
    sys.stdout.buffer.write(pathao_pdf())
`,
    ],
    {
      cwd: resolve(process.cwd(), "../finance-api"),
      env: {
        ...process.env,
        DJANGO_SETTINGS_MODULE: "config.settings",
        DJANGO_DEBUG: "true",
      },
    },
  );
  const upload = await context.request.post(
    "/api/backend/api/statements/imports/",
    {
      headers,
      multipart: {
        account: account.id,
        file: {
          name: "synthetic-category.pdf",
          mimeType: "application/pdf",
          buffer: pdf,
        },
      },
    },
  );
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const batch = await upload.json();
  const rows = await (
    await context.request.get(
      `/api/backend/api/statements/imports/${batch.id}/rows/`,
    )
  ).json();
  const row = rows.results.find(
    (item: { direction: string; component: string }) =>
      item.direction === "debit" && item.component === "principal",
  );
  expect(row).toBeTruthy();
  await page.goto(`/review?statement=${row.id}&sms=${ride.id}`);
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Review SMS + statement",
      exact: true,
    }),
  });
  const pairedCategory = dialog.getByLabel("Category", { exact: true });
  await expect(pairedCategory).toHaveValue(transport.id);
  if (!(await pairedCategory.isVisible()))
    await dialog
      .getByText("Review or edit transaction details", { exact: true })
      .click();
  await pairedCategory.selectOption(manual.id);
  await post(`messages/review/${meal.id}/confirm/`, { category: food.id });
  await post(`messages/review/${meal.id}/remember/`, {});
  await page.evaluate(() =>
    window.dispatchEvent(new Event("finance:category-rules-changed")),
  );
  await expect(pairedCategory).toHaveValue(manual.id);
  await pairedCategory.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/private/tmp/finance-saved-category-${info.project.name}.png`,
  });
  expect(errors).toEqual([]);
});
