import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S14.7 (PRD_3 F18 amended, architecture 22.8): the CRM overview with its charts and filters, the pipeline board with its stage change, and the
 * export link, in a real browser at phone width. The data calls are stubbed; what each number counts is proven against a real database in
 * tests/integration/s14-7-crm.test.ts.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function signIn(page: Page, role: "manager" | "admin" = "manager") {
  await page.route("**/api/v1/admin/session", (route) => json(route, { role, name: role === "admin" ? "Owner Person" : "Priya Rao", email: `${role}@example.test`, stepUpFresh: false, toursSeen: ["home", "leads", "content", "insights"], userId: `${role}-1` }));
  await page.route("**/api/v1/admin/notifications*", (route) => json(route, { unread: 0, items: [] }));
}

const series = Array.from({ length: 30 }, (_, i) => ({ label: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, value: i % 4 }));

const overview = (over: Record<string, unknown> = {}) => ({
  range: { from: "2026-09-27", to: "2026-10-26" },
  filters: { country: null, source: null, assigned: "all" },
  totals: { leads: 40, previousLeads: 30, answered: 28, previousAnswered: 20, answeredPercent: 70, avgFirstResponse: { unit: "hours", value: 2.5 }, previousAvgFirstResponseMinutes: 200, overdue: 3, arrived: 4, arrivedPercent: 10 },
  series,
  stages: [
    { code: "share_results", label: "Share results", count: 20 },
    { code: "choose_course", label: "Choose course", count: 10 },
    { code: "offer_letter", label: "Offer letter", count: 6 },
    { code: "confirm_admission", label: "Confirm admission", count: 0 },
    { code: "visa", label: "Visa", count: 0 },
    { code: "arrived", label: "Arrived", count: 4 },
  ],
  funnel: [
    { code: "share_results", label: "Share results", reached: 40, ofAll: 100, ofPrevious: null },
    { code: "choose_course", label: "Choose course", reached: 20, ofAll: 50, ofPrevious: 50 },
    { code: "offer_letter", label: "Offer letter", reached: 10, ofAll: 25, ofPrevious: 50 },
    { code: "arrived", label: "Arrived", reached: 4, ofAll: 10, ofPrevious: 40 },
  ],
  countries: [{ key: "CM", count: 24 }, { key: "NG", count: 12 }, { key: "other", count: 4 }],
  sources: [{ key: "/apply", count: 25 }, { key: "onboarding", count: 10 }, { key: "unknown", count: 5 }],
  admins: null,
  ...over,
});

test.describe("the CRM overview", () => {
  test("shows the numbers, each chart with a sentence, a table for screen readers, and passes the accessibility check", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/crm*", (route) => json(route, overview()));
    await page.goto("/admin/insights?view=overview");
    await expect(page.getByTestId("tile-leads")).toContainText("40");
    await expect(page.getByTestId("tile-leads")).toContainText("Up 33% on the period before");
    await expect(page.getByTestId("tile-answered")).toContainText("70%");
    await expect(page.getByTestId("tile-response")).toContainText("2.5 h");
    await expect(page.getByTestId("tile-overdue")).toContainText("3");
    await expect(page.getByTestId("tile-arrived")).toContainText("10%");
    for (const heading of ["Leads per day", "Where leads are now", "How far leads get", "Where students are from", "Where leads come from"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByText("The percentage is how many of the step before made it.")).toBeVisible();
    await expect(page.locator(".bar-chart-label", { hasText: "Cameroon" })).toBeVisible();
    await expect(page.locator(".bar-chart-label", { hasText: "Not recorded" })).toBeVisible();
    await expect(page.getByTestId("crm-admins")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await axe(page);
  });

  test("passes the filters to the data call and to the export link", async ({ page }) => {
    await signIn(page);
    const asked: string[] = [];
    await page.route("**/api/v1/admin/crm*", (route) => {
      asked.push(new URL(route.request().url()).search);
      return json(route, overview());
    });
    await page.goto("/admin/insights?view=overview&country=NG&assigned=me&from=2026-10-01");
    await expect(page.getByTestId("tile-leads")).toBeVisible();
    expect(asked[0]).toContain("country=NG");
    expect(asked[0]).toContain("assigned=me");
    expect(asked[0]).toContain("from=2026-10-01");
    const href = await page.getByTestId("crm-export").getAttribute("href");
    expect(href).toMatch(/^\/api\/v1\/admin\/export\?/);
    expect(href).toContain("country=NG");
    expect(href).toContain("assigned=me");
    await expect(page.locator('select[name="country"]')).toHaveValue("NG");
    await expect(page.locator('select[name="assigned"]')).toHaveValue("me");
  });

  test("shows every adviser to the owner only", async ({ page }) => {
    await signIn(page, "admin");
    await page.route("**/api/v1/admin/crm*", (route) => json(route, overview({ admins: [{ userId: "a1", name: "Priya Rao", assigned: 12, answered: 10, overdue: 1, medianMinutes: 40 }] })));
    await page.goto("/admin/insights?view=overview");
    await expect(page.getByTestId("crm-admins")).toContainText("Priya Rao");
    await expect(page.getByTestId("crm-admins")).toContainText("10 answered, 1 overdue");
  });

  test("says so when there is nothing, and offers Try again when the call fails", async ({ page }) => {
    await signIn(page);
    let fail = true;
    await page.route("**/api/v1/admin/crm*", (route) =>
      fail ? json(route, { error: { code: "INTERNAL", message: "x" }, request_id: "r" }, 500) : json(route, overview({ totals: { ...overview().totals, leads: 0, answered: 0, answeredPercent: null, avgFirstResponse: null, arrivedPercent: null, arrived: 0, overdue: 0 }, series: series.map((p) => ({ ...p, value: 0 })), stages: [], funnel: [], countries: [], sources: [] })),
    );
    await page.goto("/admin/insights?view=overview");
    await expect(page.getByText("We could not load this page.")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("tile-response")).toContainText("No replies yet");
    await expect(page.getByText("Nothing to show for these filters.").first()).toBeVisible();
  });
});

const card = (id: string, ref: string, over: Record<string, unknown> = {}) => ({ id, ref, name: "Ada E.", country: "NG", receivedAt: "2026-10-25T09:00:00.000Z", answered: false, overdue: false, assigned: true, version: "2026-10-25T09:00:00.000000Z", ...over });

const board = () => ({
  filters: { country: null, source: null, assigned: "all" },
  columns: [
    { code: "share_results", label: "Share results", total: 12, cards: [card("11111111-1111-4111-8111-111111111111", "SC-AAAAA-AAAAB", { overdue: true, assigned: false }), card("22222222-2222-4222-8222-222222222222", "SC-AAAAA-AAAAC")] },
    { code: "choose_course", label: "Choose course", total: 0, cards: [] },
    { code: "offer_letter", label: "Offer letter", total: 0, cards: [] },
    { code: "confirm_admission", label: "Confirm admission", total: 0, cards: [] },
    { code: "visa", label: "Visa", total: 0, cards: [] },
    { code: "arrived", label: "Arrived", total: 0, cards: [] },
  ],
});

test.describe("the pipeline board", () => {
  test("has a column per stage with its total, flags overdue and unassigned, and passes the accessibility check", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/pipeline*", (route) => json(route, board()));
    await page.goto("/admin/leads?view=pipeline");
    await expect(page.getByTestId("pipeline-board")).toBeVisible();
    await expect(page.getByTestId("column-share_results")).toContainText("12");
    await expect(page.getByTestId("column-share_results").getByTestId("board-card")).toHaveCount(2);
    await expect(page.getByTestId("column-share_results")).toContainText("Overdue");
    await expect(page.getByTestId("column-share_results")).toContainText("Nobody yet");
    await expect(page.getByTestId("column-share_results").getByRole("link", { name: "10 more in the leads list" })).toBeVisible();
    await expect(page.getByTestId("column-choose_course")).toContainText("No leads here.");
    await expect(page.getByRole("link", { name: "SC-AAAAA-AAAAB" })).toHaveAttribute("href", "/admin/leads/11111111-1111-4111-8111-111111111111");
    await axe(page);
  });

  test("moves a lead with the Move to list, sending the lead, the stage and its version, then reloads the board", async ({ page }) => {
    await signIn(page);
    let loads = 0;
    await page.route("**/api/v1/admin/pipeline*", (route) => {
      loads += 1;
      return json(route, board());
    });
    const sent: unknown[] = [];
    await page.route("**/api/v1/admin/leads.changeStage", (route) => {
      sent.push(route.request().postDataJSON());
      return json(route, { changed: true, version: "v2", from: "share_results" });
    });
    await page.goto("/admin/leads?view=pipeline");
    await page.getByRole("combobox", { name: "Move lead SC-AAAAA-AAAAB to another step" }).selectOption("visa");
    await expect.poll(() => loads).toBeGreaterThanOrEqual(2);
    expect(sent).toEqual([{ leadId: "11111111-1111-4111-8111-111111111111", stage: "visa", version: "2026-10-25T09:00:00.000000Z" }]);
  });

  test("says so and refreshes when someone else changed the lead first", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/pipeline*", (route) => json(route, board()));
    await page.route("**/api/v1/admin/leads.changeStage", (route) => json(route, { error: { code: "CONFLICT", message: "This lead changed. Reload.", fields: { version: "STALE" } }, request_id: "r" }, 409));
    await page.goto("/admin/leads?view=pipeline");
    await page.getByRole("combobox", { name: "Move lead SC-AAAAA-AAAAC to another step" }).selectOption("arrived");
    await expect(page.getByTestId("board-notice")).toContainText("Someone changed that lead first");
  });

  test("shows an error next to the lead, and keeps it where it was, when the change cannot be saved", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/pipeline*", (route) => json(route, board()));
    await page.route("**/api/v1/admin/leads.changeStage", (route) => json(route, { error: { code: "INTERNAL", message: "x" }, request_id: "r" }, 500));
    await page.goto("/admin/leads?view=pipeline");
    await page.getByRole("combobox", { name: "Move lead SC-AAAAA-AAAAC to another step" }).selectOption("arrived");
    await expect(page.getByRole("alert").filter({ hasText: "That did not save" })).toBeVisible();
    await expect(page.getByTestId("column-share_results").getByTestId("board-card")).toHaveCount(2);
  });
});
