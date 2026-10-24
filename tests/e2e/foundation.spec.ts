import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SECURITY_HEADERS } from "../../src/lib/security-headers";

/**
 * S1.5 and S1.6 on a production build (`next start`): accessibility with axe, the security headers of architecture
 * 13.1 including CSP in report-only mode, and the locale rewrite that serves unprefixed paths from `/en`.
 */

const PUBLIC_PAGES = ["/", "/offline"];

for (const path of PUBLIC_PAGES) {
  test(`axe finds no WCAG 2.1 A or AA violation on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });

  test(`${path} has a language, a title and one main landmark`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator("main")).toHaveCount(1);
  });
}

for (const path of [...PUBLIC_PAGES, "/api/v1/health"]) {
  test(`${path} carries the security headers, with the CSP in report-only mode`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers[name.toLowerCase()], name).toBe(value);
    // Enforced: only framing is blocked. Everything else is observed, not enforced.
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["content-security-policy-report-only"]).toContain("default-src 'self'");
  });
}

test("the viewport is the device width, so the layout works at 375 px without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("unprefixed paths are served from /en, and /en itself still works", async ({ request }) => {
  expect((await request.get("/offline")).status()).toBe(200);
  expect((await request.get("/en/offline")).status()).toBe(200);
  expect((await request.get("/me/phase0")).status()).toBe(200); // a nested route, through the generalised rewrite
  expect((await request.get("/no-such-page")).status()).toBe(404);
});
