import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S13.5 (architecture 21.8): the Notifications page and the dot on the round button, in a real browser at phone width. The two data calls are
 * stubbed (what each person is shown is proven against a real database in tests/integration/s13-5-notifications.test.ts).
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const studentItems = [
  { id: "reply", kind: "reply_logged", at: iso(5), unread: true, ref: "SC-ABCDE-FGHJK" },
  { id: "stage", kind: "stage_changed", at: iso(60), unread: true, ref: "SC-ABCDE-FGHJK", stage: "choose_course" },
  { id: "match", kind: "new_match", at: iso(60 * 24 * 3), unread: false, slug: "alpha-university", university: "Alpha University" },
];

const staffItems = [
  { id: "sla", kind: "sla_due", at: iso(10), unread: true, leadId: "11111111-1111-4111-8111-111111111111", ref: "SC-ABCDE-FGHJK", name: "Ama Mensah", overdue: true },
  { id: "link_requests", kind: "link_requests", at: iso(30), unread: true, count: 2 },
  { id: "payment", kind: "payment", at: iso(60 * 24 * 2), unread: false, amountUsdCents: 150000, university: "Alpha University" },
];

async function stubStudent(page: Page, items = studentItems) {
  let unread = items.filter((i) => i.unread).length;
  const posts: string[] = [];
  await page.route("**/api/v1/me/notifications*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("count") === "1") return json(route, { unread });
    return json(route, { items: items.map((i) => ({ ...i, unread: unread > 0 && i.unread })), unread });
  });
  await page.route("**/api/v1/me/notifications.seen", (route) => {
    posts.push(route.request().method());
    unread = 0;
    return json(route, { seen: true });
  });
  await page.route("**/api/v1/me/home", (route) => json(route, { userId: "s1", onboarded: true, relationship: "student", firstName: "Ada", courseFields: [], level: null, intakeYear: null, lead: null, stages: [], whatsappE164: null }));
  return { posts };
}

test.describe("the student's Notifications", () => {
  test("lists what happened, newest first, grouped Today and Earlier, each with one action", async ({ page }) => {
    await stubStudent(page);
    await page.goto("/me/notifications");
    await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    await expect(page.getByText("What needs your attention")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Earlier", level: 2 })).toBeVisible();
    const items = page.locator(".notif-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("Your adviser replied");
    await expect(items.nth(1)).toContainText("Your application moved to Choose course.");
    await expect(items.nth(2)).toContainText("Alpha University now offers a course you chose.");
    await expect(items.nth(0).getByRole("link", { name: "Open My progress" })).toHaveAttribute("href", "/me/progress");
    await expect(items.nth(2).getByRole("link", { name: "View university" })).toHaveAttribute("href", "/universities/alpha-university");
    await expect(page.getByRole("status").filter({ hasText: "2 new" })).toBeVisible();
    await axe(page);
  });

  test("marks the unread ones with a dot and a word for screen readers, and the read ones with neither", async ({ page }) => {
    await stubStudent(page);
    await page.goto("/me/notifications");
    const items = page.locator(".notif-item");
    await expect(items.nth(0).locator(".notif-dot")).toHaveCount(1);
    await expect(items.nth(0).locator(".sr-only")).toHaveText(/New:/);
    await expect(items.nth(2).locator(".notif-dot")).toHaveCount(0);
  });

  test("Mark all read clears the unread marks and the dot on the round button, and keeps the list", async ({ page }) => {
    const stub = await stubStudent(page);
    await page.goto("/me/notifications");
    const more = page.getByRole("button", { name: /^More/ });
    await expect(more).toHaveAccessibleName("More (2)");
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.locator(".notif-dot")).toHaveCount(0);
    await expect(page.locator(".notif-item")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Mark all read" })).toBeDisabled();
    await expect(more).toHaveAccessibleName("More");
    expect(stub.posts).toEqual(["POST"]);
  });

  test("says what to expect when there is nothing, without a bare 'no data'", async ({ page }) => {
    await stubStudent(page, []);
    await page.goto("/me/notifications");
    await expect(page.getByRole("heading", { name: "You are all caught up" })).toBeVisible();
    await expect(page.getByText("When your application moves")).toBeVisible();
    await axe(page);
  });

  test("shows the error and a retry when the list cannot be read", async ({ page }) => {
    await page.route("**/api/v1/me/notifications*", (route) => json(route, { error: { code: "INTERNAL", message: "x" }, request_id: "r" }, 500));
    await page.goto("/me/notifications");
    await expect(page.locator(".notif-error")).toContainText("We could not load your notifications.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("sends someone whose session ended to sign in", async ({ page }) => {
    await page.route("**/api/v1/me/notifications*", (route) => json(route, { error: { code: "UNAUTHENTICATED", message: "Sign in required." }, request_id: "r" }, 401));
    await page.route("**/sign-in", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>sign in</title>" }));
    await page.goto("/me/notifications");
    await page.waitForURL("**/sign-in");
  });
});

test.describe("the dot on the round button", () => {
  test("appears on every student screen, from one small call, and not more than once a minute", async ({ page }) => {
    let counts = 0;
    await page.route("**/api/v1/me/notifications*", (route) => {
      if (new URL(route.request().url()).searchParams.get("count") === "1") counts += 1;
      return json(route, { unread: 3 });
    });
    await page.route("**/api/v1/me/home", (route) => json(route, { userId: "s1", onboarded: true, relationship: "student", firstName: "Ada", courseFields: [], level: null, intakeYear: null, lead: null, stages: [], whatsappE164: null }));
    await page.goto("/me");
    await expect(page.getByRole("button", { name: "More (3)" })).toBeVisible();
    expect(counts).toBe(1);
    // Coming back into view straight away does not ask again.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(300);
    expect(counts).toBe(1);
  });

  test("opens from the More sheet, which says how many are new", async ({ page }) => {
    await stubStudent(page);
    await page.goto("/me");
    await page.getByRole("button", { name: /^More/ }).click();
    const link = page.getByRole("dialog").getByRole("link", { name: /Notifications/ });
    await expect(link).toContainText("2 new");
    await expect(link).toHaveAttribute("href", "/me/notifications");
  });

  test("shows no dot, and no error, when the count cannot be read", async ({ page }) => {
    await page.route("**/api/v1/me/notifications*", (route) => route.abort("internetdisconnected"));
    await page.route("**/api/v1/me/home", (route) => json(route, { userId: "s1", onboarded: true, relationship: "student", firstName: "Ada", courseFields: [], level: null, intakeYear: null, lead: null, stages: [], whatsappE164: null }));
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    await expect(page.locator(".app-nav-dot")).toHaveCount(0);
  });
});

test.describe("staff Notifications", () => {
  test("shows a lead due for a reply, the requests waiting and, for the owner, a payment, each with its own action", async ({ page }) => {
    await page.route("**/api/v1/admin/session", (route) => json(route, { role: "owner", name: "Owner", email: "owner@example.test", stepUpFresh: false }));
    await page.route("**/api/v1/admin/notifications*", (route) => json(route, { items: staffItems, unread: 2 }));
    await page.goto("/admin/notifications");
    await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    await expect(page.getByText("What needs you")).toBeVisible();
    const items = page.locator(".notif-item");
    await expect(items.nth(0)).toContainText("Ama Mensah (SC-ABCDE-FGHJK) is overdue for a reply.");
    await expect(items.nth(0).getByRole("link", { name: "Open lead" })).toHaveAttribute("href", "/admin/leads/11111111-1111-4111-8111-111111111111");
    await expect(items.nth(1)).toContainText("2 link requests are waiting.");
    await expect(items.nth(1).getByRole("link", { name: "Open requests" })).toHaveAttribute("href", "/admin/leads?view=link-requests");
    await expect(items.nth(2)).toContainText("Payment of $1,500.00 recorded for Alpha University.");
    await axe(page);
  });

  test("is linked from the admin menu", async ({ page }) => {
    await page.route("**/api/v1/admin/session", (route) => json(route, { role: "admin", name: "Priya", email: "p@example.test", stepUpFresh: false }));
    await page.route("**/api/v1/admin/home*", (route) =>
      json(route, {
        period: "week",
        role: "admin",
        days: 7,
        series: [],
        totals: { newLeads: { value: 0, previous: 0 }, waiting: 0, overdue: 0, stageMoves: { value: 0, previous: 0 }, pendingClaims: 0, openDataRequests: 0, payments: null, onboarded: null },
        activity: [],
      }),
    );
    await page.goto("/admin");
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/admin/notifications");
  });
});
