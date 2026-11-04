import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * S13.9 QA sweep for the screens a visitor can reach: the landing page and the two account pages, on a phone (360 px) and a desktop
 * (1280 px), with reduced motion, and by keyboard alone. The signed-in screens have their own phone, offline and axe checks in the
 * s13-2 to s13-6 specs; this file adds the desktop width, reduced motion and keyboard paths that those do not cover.
 */

test.use({ serviceWorkers: "block" });

const WIDTHS = [
  { name: "phone", width: 360, height: 740 },
  { name: "desktop", width: 1280, height: 800 },
] as const;
const PAGES = ["/", "/sign-in", "/sign-up"] as const;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

for (const { name, width, height } of WIDTHS) {
  for (const path of PAGES) {
    test(`${path} at ${name} width: one h1, no sideways scroll, no accessibility violation`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axe(page);
    });
  }
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 360, height: 740 } });
  test("nothing on the landing page, sign in or sign up animates or transitions", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const moving = await page.evaluate(() =>
        Array.from(document.querySelectorAll("*")).filter((el) => {
          const style = getComputedStyle(el);
          const animated = style.animationName !== "none" && parseFloat(style.animationDuration) > 0.01;
          const transitioned = parseFloat(style.transitionDuration) > 0.01;
          return animated || transitioned;
        }).length,
      );
      expect(moving, path).toBe(0);
    }
  });
});

test.describe("keyboard only", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the landing page's course finder can be used and its account button reached without a mouse", async ({ page }) => {
    await page.goto("/");
    const select = page.getByTestId("course-finder").getByLabel("Course");
    await select.focus();
    await expect(select).toBeFocused();
    // One step down from "Choose a course" is the first course on the list, computer science, which the fixture's first university offers.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("finder-count")).toBeVisible();
    await page.keyboard.press("Tab");
    // Tab moves on through the universities that were listed, then to the account button.
    for (let i = 0; i < 20; i += 1) {
      if (await page.getByTestId("finder-cta").evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(page.getByTestId("finder-cta")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-up\?course=/);
  });

  test("the first Tab on any of these pages reaches the skip link or the first control, and focus is always visible", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return { tag: el.tagName, outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== "none" };
      });
      expect(focused, path).not.toBeNull();
      expect(focused!.outline || focused!.shadow, `${path}: the focused ${focused!.tag} shows no focus ring`).toBe(true);
    }
  });
});
