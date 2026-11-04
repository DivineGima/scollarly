import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * S13.7 (architecture 21.12; F13): the landing page at phone width, on the prerendered fixture catalogue (alpha: computer science and
 * business; beta: commerce; gamma: no course field). The finder is the page's only script, so with JavaScript off it is simply not there and
 * the university list below it is the way in. The confirmed-only rule for statistics, testimonials and bios is proven where it is applied
 * (`modules/content/builders.ts`); here we check that the landing page shows nothing beyond what the snapshot confirms and never a team bio.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

test("the finder lists the right universities for a chosen course and carries the course into sign-up", async ({ page }) => {
  await page.goto("/");
  const finder = page.getByTestId("course-finder");
  await expect(finder).toBeVisible();
  await expect(finder.getByText("Pick a course to see which universities offer it.")).toBeVisible();

  await finder.getByLabel("Course").selectOption("business_management");
  await expect(page.getByTestId("finder-university")).toHaveCount(1);
  await expect(page.getByTestId("finder-university").first()).toContainText("Alpha University");
  await expect(page.getByTestId("finder-count")).toHaveText("1 university offers this course");

  await finder.getByLabel("Course").selectOption("commerce");
  await expect(page.getByTestId("finder-university").first()).toContainText("Beta University");

  await expect(page.getByTestId("finder-cta")).toHaveAttribute("href", "/sign-up?course=commerce");
});

test("a course no university lists says so and offers WhatsApp; 'Choose' clears the list and the course", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("course-finder").getByLabel("Course");
  await select.selectOption("law");
  await expect(page.getByTestId("finder-university")).toHaveCount(0);
  await expect(page.getByTestId("finder-none")).toBeVisible();
  await expect(page.getByTestId("finder-whatsapp")).toHaveAttribute("href", /wa\.me\//);
  await expect(page.getByTestId("finder-cta")).toHaveAttribute("href", "/sign-up?course=law");
  await select.selectOption("commerce");
  await expect(page.getByTestId("finder-university")).toHaveCount(1);
  await expect(page.getByTestId("finder-whatsapp")).toHaveCount(0);
  await select.selectOption("");
  await expect(page.getByTestId("finder-university")).toHaveCount(0);
  await expect(page.getByTestId("finder-cta")).toHaveAttribute("href", "/sign-up");
});

test("the sign-up page passes a carried course on to Google's start link", async ({ page }) => {
  await page.goto("/sign-up?course=commerce");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The course is added to the links once the page has loaded, so wait for it.
  const links = page.locator("a[href^='/auth/start']");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) await expect(link).toHaveAttribute("href", /course=commerce/);
});

test("a tampered course is dropped by the sign-up page", async ({ page }) => {
  await page.goto("/sign-up?course=%3Cscript%3E");
  await page.waitForLoadState("networkidle");
  const links = await page.locator("a[href^='/auth/start']").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href") ?? ""));
  expect(links.length).toBeGreaterThan(0);
  for (const href of links) expect(href).not.toContain("course=");
});

test("the landing page shows no team bios and only the statistic the snapshot confirms", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#team-heading")).toHaveCount(0);
  await expect(page.locator(".stat")).toHaveCount(1);
  await expect(page.locator(".stat")).toContainText("120+");
});

test("every image on the page comes from our own storage", async ({ page }) => {
  await page.goto("/");
  const sources = await page.locator("img").evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).getAttribute("src") ?? ""));
  for (const src of sources) expect(src.startsWith("/")).toBe(true);
});

test("axe finds no WCAG 2.1 A or AA violation and nothing scrolls sideways at 360 px", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("course-finder").getByLabel("Course").selectOption("business_management");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });
  test("the finder is hidden and the universities are still listed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("course-finder")).toBeHidden();
    await expect(page.locator("main").getByText("Alpha University").first()).toBeVisible();
  });
});
