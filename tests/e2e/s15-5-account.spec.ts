import { expect, test } from "@playwright/test";

/**
 * S15.5 (PRD_4 F25, FR-36; architecture 23.7): the public header and footer say "Sign in" with the address `/account`, and a browser that has the
 * signed-in hint sees "My account" instead, with the same address. The pages are the same cached HTML for everyone; only the label changes in the
 * browser. (The Worker's `/account` redirects are not there under `next start`; they are proven in tests/unit/s15-5-account.test.ts.)
 */

test.use({ serviceWorkers: "block" });

const HINT_KEY = "scollarly:signed-in";

test("a visitor with no hint sees Sign in and Create an account, both leading to the account flow", async ({ page }) => {
  await page.goto("/process");
  const header = page.locator("header.site-header");
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/account");
  await expect(header.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2F");
  await expect(page.locator("footer").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/account");
  await expect(page.getByRole("link", { name: "My account" })).toHaveCount(0);
});

test("a browser with the signed-in hint sees My account in the header, the page and the footer", async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, "1"), HINT_KEY);
  await page.goto("/process");
  const header = page.locator("header.site-header");
  await expect(header.getByRole("link", { name: "My account" })).toHaveAttribute("href", "/account");
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(page.locator("footer").getByRole("link", { name: "My account" })).toHaveAttribute("href", "/account");
  await expect(page.locator("main").getByRole("link", { name: "My account" }).first()).toHaveAttribute("href", "/account");
  await expect(page.getByRole("link", { name: "Create an account" })).toHaveCount(0);
});

test("the return trip's #signed-in fragment becomes the hint and leaves the address clean", async ({ page }) => {
  await page.goto("/process#signed-in");
  await expect(page.locator("header.site-header").getByRole("link", { name: "My account" })).toBeVisible();
  await expect(page).toHaveURL(/\/process$/);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), HINT_KEY)).toBe("1");
});

test("blocked storage leaves the page as served, with Sign in", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new Error("blocked"); } });
  });
  await page.goto("/process");
  await expect(page.locator("header.site-header").getByRole("link", { name: "Sign in" })).toBeVisible();
});
