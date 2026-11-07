import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S18.3 (architecture 24.11, PRD_5 FR-52): the student's Progress with the seven steps and the manager's WhatsApp, and the signed-out pages with the
 * seven steps and the fees wording. The public pages come from the content fixture build, so what they say about the steps is the translation
 * keys', not the old content rows'.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

const CODES = ["course_interest", "documents", "university_review", "offer_letter", "registration", "visa", "arrived"];

test.describe("the student's Progress", () => {
  test("shows seven steps with where the student is, and a WhatsApp button that says manager", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) =>
      json(route, {
        userId: "student-1",
        lead: { id: "l1", ref: "SC-ABCDE-FGHJK", stage: "university_review", updatedAt: "2026-11-07T10:00:00.000Z" },
        stages: CODES.map((code, i) => ({ code, position: i + 1 })),
        otherLeads: 0,
        pendingClaims: 0,
        whatsappE164: "+237612345678",
      }),
    );
    await page.goto("/me/progress");
    const bar = page.getByTestId("stage-bar");
    await expect(bar.getByRole("listitem")).toHaveCount(7);
    await expect(page.getByRole("list", { name: "The seven steps of your application" })).toBeVisible();
    await expect(bar.getByRole("listitem").nth(2)).toHaveAttribute("aria-current", "step");
    await expect(bar.getByRole("listitem").nth(0)).toHaveAttribute("data-state", "done");
    await expect(bar.getByRole("listitem").nth(6)).toHaveAttribute("data-state", "todo");
    await expect(page.getByTestId("whatsapp")).toHaveText("Message your manager on WhatsApp");
    await expect(page.getByTestId("next-step")).toContainText("university");
    await expect(page.getByText(/six steps/i)).toHaveCount(0);
    await axe(page);
  });
});

test.describe("the signed-out pages", () => {
  test("/process shows the seven steps in order and the fees wording, and nothing of the old text", async ({ page }) => {
    await page.goto("/process");
    await expect(page.getByRole("heading", { name: "How it works", level: 1 })).toBeVisible();
    const steps = page.locator("ol.steps > li");
    await expect(steps).toHaveCount(7);
    await expect(steps.nth(0)).toContainText("Tell us what you want to study");
    await expect(steps.nth(4)).toContainText("Register to secure your place");
    await expect(steps.nth(6)).toContainText("Arrive and settle in");
    const fees = page.getByRole("region", { name: "What does it cost?" });
    await expect(fees).toContainText("The only payment is the university's registration fee");
    await expect(fees).toContainText("never take money");
    const text = await page.locator("main").innerText();
    for (const old of ["Share your results", "Choose your course", "Fees to be confirmed", "six steps"]) expect(text).not.toContain(old);
    await axe(page);
  });

  test("the home page lists the same seven steps, each a link to its place on /process", async ({ page }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: /How it works|process/i });
    const links = section.locator("ol.steps.compact a");
    await expect(links).toHaveCount(7);
    await expect(links.nth(1)).toHaveAttribute("href", /\/process#step-2$/);
    await expect(links.nth(1)).toContainText("Send your documents");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("/visa keeps its own steps (the visa paperwork)", async ({ page }) => {
    await page.goto("/visa");
    await expect(page.getByText("Collect your documents")).toBeVisible();
  });
});
