import { expect, test, type Page } from "@playwright/test";

/**
 * S14.3 (PRD_3 F20, architecture 22.2): every action needs an account. A signed-out visitor who taps Apply, a WhatsApp button or the
 * course finder's link sees the sign-in pop-up with both choices, and never reaches the form or the chat. A signed-in person (the
 * browser's hint, which the server does not trust) goes straight through. Public information stays readable without an account.
 */

test.use({ serviceWorkers: "block" });

const HINT = "scollarly:signed-in";

async function signedIn(page: Page) {
  await page.addInitScript((key) => window.localStorage.setItem(key, "1"), HINT);
}

test("public pages stay readable and show no form or chat to a signed-out visitor", async ({ page }) => {
  await page.goto("/universities/alpha-university");
  await expect(page.getByRole("heading", { name: "Alpha University" })).toBeVisible();
  const chat = page.locator("a[data-wa-chat]").first();
  await expect(chat).toHaveAttribute("href", /^\/sign-in\?next=/);
  await expect(chat).toHaveAttribute("data-gate", "chat");
});

test("tapping Apply signed out opens the pop-up with Sign up and Sign in that return to the page", async ({ page }) => {
  await page.goto("/process");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Start your application" }).first().click();
  const dialog = page.getByTestId("gate-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("gate-sign-up")).toHaveAttribute("href", "/sign-up?next=%2Fapply");
  await expect(dialog.getByTestId("gate-sign-in")).toHaveAttribute("href", "/sign-in?next=%2Fapply");
  await expect(page).toHaveURL(/\/process$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("tapping a WhatsApp button signed out shows the pop-up and never opens the chat", async ({ page, context }) => {
  const outside: string[] = [];
  await context.route("https://wa.me/**", (route) => {
    outside.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>whatsapp</body></html>" });
  });
  await page.goto("/universities/alpha-university");
  await page.waitForLoadState("networkidle");
  await page.locator("a[data-wa-chat]").first().click();
  await expect(page.getByTestId("gate-dialog")).toBeVisible();
  await expect(page.getByTestId("gate-sign-in")).toHaveAttribute("href", /^\/sign-in\?next=%2Funiversities%2Falpha-university$/);
  expect(outside).toEqual([]);
  await expect(page.getByRole("dialog", { name: /quick/i })).toHaveCount(0);
});

test("the course finder's link also asks for an account", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("course-finder").getByLabel("Course").selectOption("commerce");
  await page.getByTestId("finder-cta").click();
  await expect(page.getByTestId("gate-dialog")).toBeVisible();
});

test("/apply signed out shows the account panel and no form", async ({ page }) => {
  await page.goto("/apply");
  const panel = page.getByTestId("require-account");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/sign-up?next=%2Fapply");
  await expect(page.getByLabel("Your full name")).toHaveCount(0);
});

test("a signed-in person goes straight to /apply and sees the form", async ({ page }) => {
  await signedIn(page);
  await page.goto("/process");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Start your application" }).first().click();
  await expect(page).toHaveURL(/\/apply$/);
  await expect(page.getByTestId("require-account")).toHaveCount(0);
  await expect(page.getByTestId("gate-dialog")).toBeHidden();
});

test("the return trip fragment becomes the signed-in hint and leaves the address clean", async ({ page }) => {
  await page.goto("/apply#signed-in");
  await expect(page.getByTestId("require-account")).toHaveCount(0);
  await expect(page).toHaveURL(/\/apply$/);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), HINT)).toBe("1");
});

test("the sign-in page carries a valid next and drops an invalid one", async ({ page }) => {
  await page.goto("/sign-in?next=%2Fapply");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/start?next=%2Fapply");
  await page.goto("/sign-in?next=https%3A%2F%2Fevil.example%2F");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/start");
});
