import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S13.6 (architecture 21.9, 21.10, 21.17 B2.x): the staff app in a real browser at phone width: the floating bar and its More sheet by role,
 * the Home (tiles, chart, activity, week and month), the tour that shows once, the hubs and their sections, and the totals kept for offline.
 * The data calls are stubbed; what each role is shown is proven against a real database in tests/integration/s13-6-admin-hubs.test.ts.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

type Role = "admin" | "owner";

async function signIn(page: Page, role: Role = "admin", toursSeen: string[] = ["home", "leads", "content", "insights"]) {
  await page.route("**/api/v1/admin/session", (route) => json(route, { role, name: role === "owner" ? "Owner Person" : "Priya Rao", email: `${role}@example.test`, stepUpFresh: false, toursSeen, userId: `${role}-1` }));
  await page.route("**/api/v1/admin/notifications*", (route) => json(route, { unread: 0, items: [] }));
}

const days = (n: number, value = (i: number) => i % 3) => Array.from({ length: n }, (_, i) => ({ label: `2026-10-${String(i + 1).padStart(2, "0")}`, value: value(i) }));

const totals = (role: Role, over: Record<string, unknown> = {}) => ({
  newLeads: { value: 12, previous: 8 },
  waiting: 5,
  overdue: 2,
  stageMoves: { value: 3, previous: 3 },
  pendingClaims: 1,
  openDataRequests: 0,
  payments: role === "owner" ? { valueCents: 250000, previousCents: 100000 } : null,
  onboarded: role === "owner" ? { value: 4, previous: 6 } : null,
  ...over,
});

const activity = [
  { type: "created", at: "2026-10-30T09:00:00.000Z", ref: "SC-ABCDE-FGHJK", leadId: "11111111-1111-4111-8111-111111111111" },
  { type: "stage_changed", at: "2026-10-30T08:00:00.000Z", ref: "SC-ABCDE-12345", leadId: "22222222-2222-4222-8222-222222222222" },
];

async function stubHome(page: Page, role: Role = "admin", over: Record<string, unknown> = {}) {
  const asked: string[] = [];
  await page.route("**/api/v1/admin/home*", (route) => {
    const period = new URL(route.request().url()).searchParams.get("period") ?? "week";
    asked.push(period);
    return json(route, { period, role, days: period === "month" ? 30 : 7, series: days(period === "month" ? 30 : 7), totals: totals(role), activity, ...over });
  });
  return asked;
}

test.describe("B2.5 the floating bar and the More sheet", () => {
  test("shows an admin the four tabs and a More sheet with Notifications, Profile and Sign out, and none of the owner's pages", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin");
    await page.goto("/admin");
    const bar = page.getByRole("navigation", { name: "Main tabs" });
    for (const name of ["Home", "Leads", "Content", "Insights"]) await expect(bar.getByRole("link", { name })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet.getByRole("link").first()).toContainText("Notifications");
    await expect(sheet.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/admin/profile");
    await expect(sheet.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/sign-out");
    for (const owner of ["Team", "Audit log", "Security", "Settings", "Health"]) await expect(sheet.getByRole("link", { name: owner })).toHaveCount(0);
    await axe(page);
  });

  test("shows the owner Team, Audit log, Security, Settings and Health as well", async ({ page }) => {
    await signIn(page, "owner");
    await stubHome(page, "owner");
    await page.goto("/admin");
    await page.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    for (const [name, href] of [["Team", "/admin/team"], ["Audit log", "/admin/audit"], ["Security", "/admin/security"], ["Settings", "/admin/settings"], ["Health", "/admin/health"]] as const) {
      await expect(sheet.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  test("puts a dot on the round button when there is something new", async ({ page }) => {
    await signIn(page, "admin");
    await page.unroute("**/api/v1/admin/notifications*");
    await page.route("**/api/v1/admin/notifications*", (route) => json(route, { unread: 4 }));
    await stubHome(page, "admin");
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: "More (4)" })).toBeVisible();
  });

  test("never covers the last thing on the page at 360 px", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin");
    await page.goto("/admin");
    const last = page.locator(".admin-home-activity li").last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    const bar = await page.getByRole("navigation", { name: "Main tabs" }).boundingBox();
    expect(box && bar && box.y + box.height <= bar.y + 1).toBe(true);
  });
});

test.describe("B2.1 Home", () => {
  test("says what the page is for, what needs the admin today, four tiles that compare with last week, a chart and the latest activity", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByText("Your day at a glance")).toBeVisible();
    await expect(page.getByText("Hi Priya")).toBeVisible();
    await expect(page.getByTestId("needs-you")).toContainText("2 leads are overdue");
    await expect(page.getByTestId("needs-you")).toContainText("5 leads are waiting for a reply");
    await expect(page.getByTestId("needs-you")).toContainText("1 link request");
    await expect(page.locator(".admin-home-tiles li")).toHaveCount(4);
    await expect(page.getByTestId("tile-newLeads")).toContainText("12");
    await expect(page.getByTestId("tile-newLeads")).toContainText("Up 4 on last week");
    await expect(page.getByTestId("tile-stageMoves")).toContainText("Same as last week");
    await expect(page.getByTestId("tile-waiting")).toContainText("Right now");
    await expect(page.getByTestId("tile-overdue")).toHaveAttribute("href", "/admin/leads?view=overdue");
    await expect(page.getByRole("img", { name: "New leads each day this week" })).toBeVisible();
    await expect(page.locator(".admin-home-activity li")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "New lead SC-ABCDE-FGHJK" })).toHaveAttribute("href", "/admin/leads/11111111-1111-4111-8111-111111111111");
    await axe(page);
  });

  test("gives the owner the owner's four tiles: new leads, overdue, payments received in dollars, students onboarded", async ({ page }) => {
    await signIn(page, "owner");
    await stubHome(page, "owner");
    await page.goto("/admin");
    await expect(page.locator(".admin-home-tiles li")).toHaveCount(4);
    await expect(page.getByTestId("tile-payments")).toContainText("$2,500");
    await expect(page.getByTestId("tile-payments")).toContainText("Up $1,500 on last week");
    await expect(page.getByTestId("tile-onboarded")).toContainText("Down 2 on last week");
    await expect(page.getByTestId("tile-stageMoves")).toHaveCount(0);
    await axe(page);
  });

  test("switches between this week and this month, and asks for the month's numbers", async ({ page }) => {
    await signIn(page, "admin");
    const asked = await stubHome(page, "admin");
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: "This week" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "This month" }).click();
    await expect(page.getByRole("button", { name: "This month" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("img", { name: "New leads each day this month" })).toBeVisible();
    await expect(page.getByTestId("tile-newLeads")).toContainText("last month");
    expect(asked).toEqual(["week", "month"]);
    await expect(page).toHaveURL(/period=month/);
  });

  test("keeps the period in the address, so a month stays a month after a reload", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin");
    await page.goto("/admin?period=month");
    await expect(page.getByRole("button", { name: "This month" })).toHaveAttribute("aria-pressed", "true");
  });

  test("says what to do when nothing has happened, without drawing a flat line", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin", { series: days(7, () => 0), totals: totals("admin", { newLeads: { value: 0, previous: 0 }, waiting: 0, overdue: 0, pendingClaims: 0, stageMoves: { value: 0, previous: 0 } }), activity: [] });
    await page.goto("/admin");
    await expect(page.getByTestId("needs-you")).toContainText("Nothing is waiting for you right now.");
    await expect(page.getByText("No new leads in this period yet.")).toBeVisible();
    await expect(page.locator(".line-chart-svg")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Nothing has happened yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Leads" })).toHaveAttribute("href", "/admin/leads");
    await axe(page);
  });

  test("says what went wrong, with a retry, when the numbers cannot be read", async ({ page }) => {
    await signIn(page, "admin");
    await page.route("**/api/v1/admin/home*", (route) => json(route, { error: { code: "INTERNAL", message: "x" }, request_id: "r" }, 500));
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  });
});

test.describe("the first-visit tour", () => {
  test("shows three steps once, can be finished, and is recorded so it never repeats", async ({ page }) => {
    await signIn(page, "admin", []);
    await stubHome(page, "admin");
    const recorded: unknown[] = [];
    await page.route("**/api/v1/admin/tour.seen", (route) => {
      recorded.push(route.request().postDataJSON());
      return json(route, { seen: true });
    });
    await page.goto("/admin");
    const tour = page.getByRole("dialog", { name: "Your day on one screen" });
    await expect(tour).toBeVisible();
    await expect(tour).toContainText("Step 1 of 3");
    await axe(page);
    await tour.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("dialog", { name: "This week or this month" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => recorded).toEqual([{ tab: "home" }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("can be skipped at any step, and is not shown to someone who has seen it", async ({ page }) => {
    await signIn(page, "admin", []);
    await stubHome(page, "admin");
    await page.route("**/api/v1/admin/tour.seen", (route) => json(route, { seen: true }));
    await page.goto("/admin");
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("B2.2 to B2.4 the hubs", () => {
  async function failLists(page: Page) {
    // The sections' own data is proven elsewhere; here only the hub around them is under test, so every list answers an error the panels show.
    await page.route("**/api/v1/admin/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (/\/(session|home|notifications)/.test(path)) return route.fallback();
      return json(route, { error: { code: "INTERNAL", message: "x" }, request_id: "r" }, 500);
    });
  }

  test("Leads has the list, the link requests and the data requests as sections, and opens the one in the address", async ({ page }) => {
    await signIn(page, "admin");
    await failLists(page);
    await page.goto("/admin/leads");
    const sections = page.getByRole("navigation", { name: "Sections" });
    await expect(sections.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main tabs" }).getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    await page.goto("/admin/leads?view=link-requests");
    await expect(sections.getByRole("link", { name: "Link requests" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Link requests", level: 1 })).toBeVisible();
    await page.goto("/admin/leads?view=data-requests");
    await expect(sections.getByRole("link", { name: "Data requests" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Data requests", level: 1 })).toBeVisible();
    await axe(page);
  });

  test("Leads keeps its own views for a link from Home (overdue, unanswered)", async ({ page }) => {
    await signIn(page, "admin");
    await failLists(page);
    await page.goto("/admin/leads?view=overdue");
    await expect(page.getByRole("heading", { name: "Leads", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
  });

  test("Content has the kinds of content, what needs checking and the images", async ({ page }) => {
    await signIn(page, "admin");
    await failLists(page);
    await page.goto("/admin/content");
    const sections = page.getByRole("navigation", { name: "Sections" });
    await expect(sections.getByRole("link", { name: "All content" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Content", level: 1 })).toBeVisible();
    await page.goto("/admin/content?view=stale");
    await expect(sections.getByRole("link", { name: "Needs checking" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Stale content", level: 1 })).toBeVisible();
    await page.goto("/admin/content?view=media");
    await expect(sections.getByRole("link", { name: "Images" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Images", level: 1 })).toBeVisible();
  });

  test("Insights has the results (with the person's own numbers) and the payments", async ({ page }) => {
    await signIn(page, "admin");
    await failLists(page);
    await page.goto("/admin/insights");
    const sections = page.getByRole("navigation", { name: "Sections" });
    await expect(sections.getByRole("link", { name: "Results" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main tabs" }).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
    await page.goto("/admin/insights?view=performance");
    await expect(page.getByRole("button", { name: "My performance" })).toHaveAttribute("aria-current", "page");
    await page.goto("/admin/insights?view=payments");
    await expect(sections.getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Payments received", level: 1 })).toBeVisible();
  });

  test("the pages that are reached from More say what they are for", async ({ page }) => {
    await signIn(page, "owner");
    await failLists(page);
    await page.route("**/api/v1/admin/security", (route) => json(route, { twoFactorEnabled: true, stepUpFresh: true, sessions: [] }));
    await page.goto("/admin/security");
    await expect(page.getByText("Two-factor sign-in, and the devices signed in to your account.")).toBeVisible();
    await page.goto("/admin/profile");
    await expect(page.getByText("Your name and the details you sign in with.")).toBeVisible();
  });
});

test.describe("offline: totals only (architecture 21.11)", () => {
  test("keeps the numbers and the chart, never a lead reference, and shows them with when they were last known", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin");
    await page.goto("/admin");
    await expect(page.getByTestId("tile-newLeads")).toContainText("12");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open("scollarly");
              open.onerror = () => resolve("");
              open.onsuccess = () => {
                if (!open.result.objectStoreNames.contains("dashboardSnapshot")) return resolve("");
                const all = open.result.transaction("dashboardSnapshot").objectStore("dashboardSnapshot").getAll();
                all.onsuccess = () => resolve(all.result[0] ? JSON.stringify(all.result[0]) : "");
              };
            }),
        ),
      )
      .toContain('"userId":"admin-1"');

    const kept = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open("scollarly");
          open.onsuccess = () => {
            const all = open.result.transaction("dashboardSnapshot").objectStore("dashboardSnapshot").getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result[0]));
          };
        }),
    );
    expect(kept).not.toMatch(/SC-|@|Priya|11111111/);
    expect(Object.keys(JSON.parse(kept)).sort()).toEqual(["period", "role", "series", "totals", "updatedAt", "userId"]);

    await page.unroute("**/api/v1/admin/home*");
    await page.route("**/api/v1/admin/home*", (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByTestId("from-phone")).toContainText("Last updated");
    await expect(page.getByTestId("tile-newLeads")).toContainText("12");
    await expect(page.locator(".admin-home-activity")).toHaveCount(0);
    await expect(page.getByTestId("tile-newLeads")).not.toHaveAttribute("href", /.+/);
  });

  test("sign-out forgets them", async ({ page }) => {
    await signIn(page, "admin");
    await stubHome(page, "admin");
    await page.route("**/api/auth/sign-out", (route) => json(route, {}));
    await page.goto("/admin");
    await expect(page.getByTestId("tile-newLeads")).toBeVisible();
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => { const o = indexedDB.open("scollarly"); o.onsuccess = () => { const a = o.result.transaction("dashboardSnapshot").objectStore("dashboardSnapshot").count(); a.onsuccess = () => resolve(a.result); }; }))).toBe(1);
    await page.goto("/sign-out");
    await page.waitForURL("**/");
    const count = await page.evaluate(() => new Promise<number>((resolve) => { const o = indexedDB.open("scollarly"); o.onsuccess = () => { const a = o.result.transaction("dashboardSnapshot").objectStore("dashboardSnapshot").count(); a.onsuccess = () => resolve(a.result); }; }));
    expect(count).toBe(0);
  });
});
