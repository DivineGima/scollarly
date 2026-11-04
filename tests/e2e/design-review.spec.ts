import { expect, test } from "@playwright/test";

/**
 * Design review of the live site (2026-11-04): four visible defects that were measured on the deployed pages, each with the check that would
 * have caught it. Phone widths are real browser widths; the 320 px one is the smallest phone the site is meant to work on.
 */

test.use({ serviceWorkers: "block" });

for (const path of ["/sign-in", "/sign-up"]) {
  test(`${path} has no sideways scroll at 320 px and the password row stays inside the form`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.evaluate(() => {
      const form = document.querySelector("form")!.getBoundingClientRect();
      const row = document.querySelector(".auth-password")!.getBoundingClientRect();
      return { formRight: Math.round(form.right), rowRight: Math.round(row.right) };
    });
    expect(box.rowRight).toBeLessThanOrEqual(box.formRight);
  });
}

test("the header and footer links are at least the site's own touch size (44 px)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".brand, .bar-actions .link-quiet, .footer-links a")]
      .map((e) => ({ text: (e.textContent ?? "").trim(), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((e) => e.h < 44),
  );
  expect(small).toEqual([]);
});

test("an address no page answers is a 404 in the page frame, with the page language set", async ({ page, request }) => {
  expect((await request.get("/en/no-such-page-at-all")).status()).toBe(404);
  const response = await page.goto("/en/no-such-page-at-all");
  expect(response?.status()).toBe(404);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "We could not find that page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
});

test("the pop-up title is balanced so a single word does not sit alone on the last line", async ({ page }) => {
  await page.goto("/");
  const wrap = await page.evaluate(() => getComputedStyle(document.querySelector(".gate-dialog h2")!).textWrap);
  expect(wrap).toBe("balance");
});
