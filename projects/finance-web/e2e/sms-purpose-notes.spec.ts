import { test, expect } from "@playwright/test";

test("SMS purpose prefills an editable note and queue navigation retains edits", async ({
  page,
  context,
  baseURL,
}, info) => {
  if (!["127.0.0.1", "localhost"].includes(new URL(baseURL!).hostname))
    throw new Error("SMS note tests require the disposable local fixture.");
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set the synthetic fixture password.");
  const headers = { origin: baseURL! };
  const login = await context.request.post("/api/auth/login", {
    data: { username: "synthetic-browser", password },
    headers,
  });
  expect(login.status()).toBe(200);
  const accounts = await (
    await context.request.get("/api/backend/api/accounts/")
  ).json();
  const account = accounts.find(
    (item: { name: string }) => item.name === "Synthetic QA Bank",
  );
  expect(account).toBeTruthy();
  const sender = `SYNTH-NOTE-${info.project.name}-${Date.now()}`;
  const rule = await context.request.post(
    "/api/backend/api/messages/sender-rules/",
    {
      data: { account: account.id, provider: "ebl", sender, name: sender },
      headers,
    },
  );
  expect(rule.status()).toBe(201);
  const purposes = [
    "Account Maintenance Service Charges",
    "Monthly Account Fees",
  ];
  for (const [index, purpose] of purposes.entries()) {
    const imported = await context.request.post(
      "/api/backend/api/messages/import/",
      {
        data: {
          sender,
          body: `AC ***1234 is debited with BDT ${45 + index} as ${purpose} on 02-JAN-26 09:12:00 AM Balance is BDT 955.00 Thanks.`,
          received_at: `2026-01-02T09:1${index}:00+06:00`,
          device_message_id: `${sender}-${index}`,
        },
        headers,
      },
    );
    expect(imported.status()).toBe(201);
    const { candidate } = await imported.json();
    expect(candidate.suggested_note).toBe(purpose);
    expect(candidate.transaction_type).toBe("fee");
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/messages/review");
  await expect(page).toHaveURL(/\/messages\/review/);
  await expect(page).toHaveTitle(/Finance/);
  const queue = page.locator(".review-queue-item");
  await queue.filter({ hasText: purposes[0] }).first().click();
  const expand = page.getByRole("button", {
    name: /Show all transaction fields/,
  });
  if (await expand.isVisible()) await expand.click();
  const note = page.getByRole("textbox", { name: "Ledger note", exact: true });
  await expect(note).toHaveValue(purposes[0]);
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("fee");
  await note.fill("My reviewed service charge");
  await queue.filter({ hasText: purposes[1] }).first().click();
  if (await expand.isVisible()) await expand.click();
  await expect(note).toHaveValue(purposes[1]);
  await queue.filter({ hasText: purposes[0] }).first().click();
  await expect(note).toHaveValue("My reviewed service charge");
  await note.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `/private/tmp/finance-sms-note-${info.project.name}.png`,
  });
  expect(errors).toEqual([]);
});
