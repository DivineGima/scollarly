import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S15.6 (PRD_4 F27, FR-38; architecture 23.6): the "Not applied yet" tab of Leads and the onboarded numbers of the Insights overview, in a real
 * browser at phone width. The data calls are stubbed; what they count and who may read them is proven against a real database in
 * tests/integration/s15-6-not-applied.test.ts.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function signIn(page: Page) {
  await page.route("**/api/v1/admin/session", (route) => json(route, { role: "manager", name: "Priya Rao", email: "admin@example.test", stepUpFresh: false, toursSeen: ["home", "leads", "content", "insights"], userId: "admin-1" }));
  await page.route("**/api/v1/admin/notifications*", (route) => json(route, { unread: 0, items: [] }));
}

const student = (n: number) => ({ id: `u${n}`, name: `Student ${n}.`, country: "CM", courseFields: ["law"], onboardedAt: "2026-11-01T10:00:00.000Z", whatsapp: "+237612345678" });

test.describe("Not applied yet", () => {
  test("lists the students with a WhatsApp link, a WAT time, no lead reference, and passes the accessibility check", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/not-applied", (route) => json(route, { students: [student(1), student(2)], total: 2 }));
    await page.goto("/admin/leads?view=not-applied");
    await expect(page.getByRole("heading", { name: "Not applied yet", level: 1 })).toBeVisible();
    await expect(page.getByTestId("not-applied-count")).toContainText("2 students have not applied yet");
    const items = page.getByTestId("not-applied-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Student 1.");
    await expect(items.first()).toContainText("2026-11-01 11:00 WAT");
    const chat = items.first().getByRole("link", { name: "Message on WhatsApp" });
    await expect(chat).toHaveAttribute("href", /^https:\/\/wa\.me\/237612345678\?text=/);
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Not applied yet" })).toHaveAttribute("aria-current", "page");
    await axe(page);
  });

  test("says so when everyone has applied, says how many are hidden when the list is capped, and offers a retry when the call fails", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/not-applied", (route) => json(route, { students: [], total: 0 }));
    await page.goto("/admin/leads?view=not-applied");
    await expect(page.getByTestId("not-applied-empty")).toBeVisible();

    await page.unroute("**/api/v1/admin/not-applied");
    await page.route("**/api/v1/admin/not-applied", (route) => json(route, { students: [student(1)], total: 140 }));
    await page.reload();
    await expect(page.getByTestId("not-applied-count")).toContainText("Showing the newest 1 of 140");

    await page.unroute("**/api/v1/admin/not-applied");
    await page.route("**/api/v1/admin/not-applied", (route) => json(route, { error: { code: "TEMPORARILY_UNAVAILABLE", message: "Try again." } }, 503));
    await page.reload();
    await expect(page.getByRole("button", { name: /try again|retry/i })).toBeVisible();
  });
});

test.describe("Insights overview, onboarded numbers", () => {
  const base = {
    range: { from: "2026-09-27", to: "2026-10-26" },
    filters: { country: null, source: null, assigned: "all" },
    series: [{ label: "2026-10-01", value: 1 }],
    stages: [{ code: "share_results", label: "Share results", count: 2 }],
    countries: [],
    sources: [],
    admins: null,
  };
  const totals = { leads: 2, previousLeads: 1, answered: 1, previousAnswered: 1, answeredPercent: 50, avgFirstResponse: null, previousAvgFirstResponseMinutes: null, overdue: 0, arrived: 0, arrivedPercent: 0 };

  test("shows the onboarded tile, the share who applied, and the first funnel step", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/crm*", (route) =>
      json(route, {
        ...base,
        totals: { ...totals, onboarded: 8, appliedOfOnboarded: 2, appliedOfOnboardedPercent: 25 },
        funnel: [
          { code: "profile_onboarded", label: "Onboarded", reached: 8, ofAll: null, ofPrevious: null },
          { code: "share_results", label: "Share results", reached: 2, ofAll: 100, ofPrevious: null },
        ],
      }),
    );
    await page.goto("/admin/insights?view=overview");
    await expect(page.getByTestId("tile-onboarded")).toContainText("8");
    await expect(page.getByTestId("tile-applied-of-onboarded")).toContainText("25%");
    await expect(page.getByTestId("tile-applied-of-onboarded")).toContainText("2 of 8 students");
    await expect(page.getByText("Finished their profile").first()).toBeVisible();
    await axe(page);
  });

  test("hides the onboarded tiles when a filter a profile does not have is set", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/crm*", (route) =>
      json(route, { ...base, totals: { ...totals, onboarded: null, appliedOfOnboarded: null, appliedOfOnboardedPercent: null }, funnel: [{ code: "share_results", label: "Share results", reached: 2, ofAll: 100, ofPrevious: null }] }),
    );
    await page.goto("/admin/insights?view=overview&source=%2Fapply");
    await expect(page.getByTestId("tile-leads")).toBeVisible();
    await expect(page.getByTestId("tile-onboarded")).toHaveCount(0);
  });
});
