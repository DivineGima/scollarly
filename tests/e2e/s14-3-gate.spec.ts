import { expect, test, type Page } from "@playwright/test";

/**
 * S14.3 changed by S15.4 (PRD_4 F24, F26; architecture 23.5): the public site offers one action, "Create an account". There is no Apply
 * form, no quick WhatsApp form, no chat link and no sign-in pop-up on any public page: applying and chatting live inside the account.
 * Public information stays readable without an account. (The Worker's forward from the old `/apply` address is not there under
 * `next start`; it is proven in tests/unit/s14-3-gate.test.ts. The return trip's `#signed-in` fragment becoming the signed-in hint was read
 * by the pop-up script; the "My account" swap of S15.5 reads it again; its test is in tests/e2e/s15-5-account.spec.ts.)
 */

test.use({ serviceWorkers: "block" });

const PAGES = ["/", "/universities", "/universities/alpha-university", "/process", "/about", "/faq", "/visa", "/contact"];

const bodyLinks = (page: Page) => page.locator("main a, header a, footer a");

test("every public page stays readable and offers Create an account, with no form, no chat link and no pop-up", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" }).first(), path).toHaveAttribute("href", /^\/sign-up(\?|$)/);
    await expect(page.locator('a[href*="wa.me"]'), `${path}: a chat link`).toHaveCount(0);
    await expect(page.locator("a[data-wa-chat], [data-gate], [data-gate-href]"), `${path}: a gate hook`).toHaveCount(0);
    await expect(page.locator("dialog"), `${path}: a pop-up`).toHaveCount(0);
    await expect(page.getByLabel("Your WhatsApp number"), `${path}: a form`).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Apply$|Start your application|Chat on WhatsApp|Ask about this university on WhatsApp/ }), path).toHaveCount(0);
  }
});

test("the header offers Sign in and Create an account to a signed-out visitor", async ({ page }) => {
  await page.goto("/process");
  const header = page.locator("header.site-header");
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/account");
  await expect(header.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2F");
});

test("Create an account returns the person to the page they were on", async ({ page }) => {
  await page.goto("/process");
  await expect(page.locator("main").getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2Fprocess");
  await page.goto("/universities/alpha-university");
  await expect(page.locator("main").getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2Funiversities%2Falpha-university");
  await page.goto("/faq");
  await expect(page.locator("main").getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2Ffaq");
});

test("the Contact page still shows the WhatsApp number as text to copy, but no chat link", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByText("+14155550100")).toBeVisible();
  await expect(page.getByRole("button", { name: /copy/i })).toBeVisible();
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
  await expect(bodyLinks(page).filter({ hasText: "WhatsApp" })).toHaveCount(0);
});

test("the course finder's link goes to sign-up with the course, and a course nobody lists points to it", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const select = page.getByTestId("course-finder").getByLabel("Course");
  await select.selectOption("commerce");
  await page.getByTestId("finder-cta").click();
  await expect(page).toHaveURL(/\/sign-up\?course=commerce$/);
  await page.goBack();
  await page.getByTestId("course-finder").getByLabel("Course").selectOption("law");
  await expect(page.getByTestId("finder-none")).toContainText("Create an account");
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0);
});

test("the sign-in page carries a valid next and drops an invalid one", async ({ page }) => {
  await page.goto("/sign-in?next=%2Fapply");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/start?next=%2Fapply");
  await page.goto("/sign-in?next=https%3A%2F%2Fevil.example%2F");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/start");
});
