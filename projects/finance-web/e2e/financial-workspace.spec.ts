import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({context,baseURL}) => {
  const password = process.env.FINANCE_E2E_PASSWORD;
  if (!password) throw new Error("Set FINANCE_E2E_PASSWORD for the disposable synthetic fixture.");
  const response = await context.request.post("/api/auth/login", {data:{username:"synthetic-browser",password},headers:{origin:baseURL!}});
  expect(response.status()).toBe(200);
});

test("pagination, editor cancellation and reload preserve active work", async ({page},testInfo) => {
  await page.goto("/transactions?month=2026-01&page=2");
  await expect(page.getByText("Showing 26–50 of 143 transactions",{exact:true})).toBeVisible();
  const row = testInfo.project.name === "mobile" ? page.locator(".transaction-card").first() : page.locator("table tbody tr").first();
  await row.getByRole("button",{name:/More actions/}).click();
  await page.getByRole("button",{name:"Edit transaction",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(page).toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByText("Showing 26–50 of 143 transactions",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"View transaction: Synthetic pagination 117",exact:true})).toBeVisible();
});

test("quick-add uses a targeted refresh and preserves filters", async ({page}) => {
  await page.goto("/transactions?month=2026-01&page=2");
  await expect(page.getByText("143 transactions",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Quick Add",exact:true}).first().click();
  await page.getByRole("button",{name:"Blank entry",exact:true}).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Quick entry amount").fill("2.50");
  await dialog.getByPlaceholder("dd/mm/yyyy").fill("01/02/2026");
  await dialog.getByRole("button",{name:"Synthetic QA Bank",exact:true}).click();
  let routeRefreshes=0;
  page.on("request",request=>{if(request.headers().rsc==="1" && new URL(request.url()).pathname==="/transactions")routeRefreshes++;});
  await dialog.getByRole("button",{name:"Save transaction",exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Showing 26–50 of 143 transactions",{exact:true})).toBeVisible();
  expect(routeRefreshes).toBe(0);
  await expect(page).toHaveURL(/month=2026-01.*page=2/);
});

test("late timeline account responses cannot overwrite a newer refresh", async ({page}) => {
  let release!:()=>void, ready!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const started=new Promise<void>(resolve=>{ready=resolve;});
  let first=true;
  await page.route("**/api/backend/api/accounts**", async route=>{
    if(!first)return route.continue();
    first=false;
    try {
      const response=await route.fetch();
      const body=await response.json();body[0].name="Synthetic obsolete response";
      ready();await held;await route.fulfill({response,json:body});
    } catch {ready();}
  });
  try {
    await page.goto("/timeline");
    await started;
    await page.evaluate(()=>window.dispatchEvent(new Event("finance:transactions-changed")));
    await expect(page.getByRole("button",{name:"Refresh timeline",exact:true})).toBeEnabled();
    await page.getByRole("button",{name:/^Accounts ·/}).click();
    await expect(page.getByText("Synthetic QA Bank",{exact:true}).first()).toBeVisible();
    release();
    await expect(page.getByRole("button",{name:"Refresh timeline",exact:true})).toBeEnabled();
    await expect(page.getByText("Synthetic obsolete response",{exact:true})).toHaveCount(0);
  } finally {release();}
});

test("workspace and quick-entry forms meet critical keyboard and WCAG checks", async ({page}) => {
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  for (const theme of ["light", "dark"]) {
    await page.addInitScript(value=>localStorage.setItem("finance.theme.v1",value),theme);
    await page.goto("/transactions?month=2026-01");
    await expect(page.getByText("143 transactions",{exact:true})).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    const result = await new AxeBuilder({page}).include(".app-content").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
    await page.getByRole("button",{name:"Quick Add",exact:true}).first().click();
    await page.getByRole("button",{name:"Blank entry",exact:true}).click();
    const dialog=page.getByRole("dialog");
    await expect(dialog.getByLabel("Quick entry amount")).toBeFocused();
    const form = await new AxeBuilder({page}).include('dialog[open]').withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
    expect(form.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  expect(errors).toEqual([]);
});
