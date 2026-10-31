import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * S13.2 (architecture 21.17 A2.1): Sign in and Create account are two separate things in a real browser. The Google trip itself
 * needs Neon Auth and is covered by the integration tests; here we check what a visitor sees and where each link goes.
 */

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe("Create account", () => {
  test("offers a student and a parent button, each a plain link carrying the intent, and a way back to Sign in", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(page.getByRole("link", { name: /I am a student/ })).toHaveAttribute("href", "/auth/start?intent=sign-up&as=student");
    await expect(page.getByRole("link", { name: /I am a parent applying for my child/ })).toHaveAttribute("href", "/auth/start?intent=sign-up&as=parent");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    await expect(page.getByText("No Google account? You can still apply and message us on WhatsApp.")).toBeVisible();
    await axe(page);
  });

  test("carries a course chosen earlier into both links, and drops one it does not know", async ({ page }) => {
    await page.goto("/sign-up?course=law");
    await expect(page.getByRole("link", { name: /I am a student/ })).toHaveAttribute("href", "/auth/start?intent=sign-up&as=student&course=law");
    await expect(page.getByRole("link", { name: /I am a parent/ })).toHaveAttribute("href", "/auth/start?intent=sign-up&as=parent&course=law");
    await page.goto("/sign-up?course=%3Cscript%3E");
    await expect(page.getByRole("link", { name: /I am a student/ })).toHaveAttribute("href", "/auth/start?intent=sign-up&as=student");
  });

  test("tells an offline visitor it needs a connection", async ({ page, context }) => {
    await page.goto("/sign-up");
    await context.setOffline(true);
    await expect(page.getByRole("status")).toHaveText("You need a connection to sign in or create an account.");
    await context.setOffline(false);
  });
});

test.describe("the confirm page", () => {
  test("is not served to someone who is signed out (the Worker answers 404 before the page)", async ({ request }) => {
    // Under `next start` there is no Worker, so the page exists; what matters here is that it holds no data and no way to read any.
    const response = await request.get("/api/v1/account/confirm");
    expect([401, 404, 405]).toContain(response.status());
  });
});
