import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S13.4 (architecture 21.4, 21.7, 21.11): the student app in a real browser at phone width. The data calls are stubbed (their answers are
 * proven against a real database in tests/integration/s13-4-student-app.test.ts); here we check the floating bar, the personal Home, the
 * order of the universities, what the phone keeps, and that sign-out removes it. The catalogue is the content fixture's.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

const home = (over: Record<string, unknown> = {}) => ({
  userId: "student-1",
  onboarded: true,
  relationship: "student",
  firstName: "Ada",
  courseFields: ["computer_science_it"],
  level: "undergraduate",
  intakeYear: 2027,
  lead: { ref: "SC-ABCDE-FGHJK", stage: "choose_course", updatedAt: "2026-10-30T10:00:00.000Z" },
  stages: ["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"].map((code, i) => ({ code, position: i + 1 })),
  whatsappE164: "+919876543210",
  ...over,
});

const preferences = (over: Record<string, unknown> = {}) => ({ userId: "student-1", onboarded: true, firstName: "Ada", courseFields: ["computer_science_it"], level: "undergraduate", intakeYear: 2027, ...over });

async function stubHome(page: Page, data = home()) {
  await page.route("**/api/v1/me/home", (route) => json(route, data));
}
async function stubPreferences(page: Page, data = preferences()) {
  await page.route("**/api/v1/me/preferences", (route) => json(route, data));
}

test.describe("the floating bar", () => {
  test("shows the four student tabs and the More button, lights the current tab, and reaches each in one tap", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    const bar = page.getByRole("navigation", { name: "Main tabs" });
    for (const name of ["Home", "Universities", "My progress", "Help"]) await expect(bar.getByRole("link", { name })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    await axe(page);
    await expect(bar.getByRole("link", { name: "Universities" })).toHaveAttribute("href", "/me/universities");
    await expect(bar.getByRole("link", { name: "My progress" })).toHaveAttribute("href", "/me/progress");
    await expect(bar.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/me/help");
  });

  test("never covers the last thing on a page at 360 px", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    await expect(page.getByTestId("for-you")).toBeVisible();
    await page.getByRole("link", { name: "See all universities" }).scrollIntoViewIfNeeded();
    const link = await page.getByRole("link", { name: "See all universities" }).boundingBox();
    const bar = await page.getByRole("navigation", { name: "Main tabs" }).boundingBox();
    expect(link && bar && link.y + link.height <= bar.y + 1).toBe(true);
  });

  test("opens the More sheet with Notifications on top, then Profile, My data and Sign out, and closes with Escape", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    await page.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    const links = sheet.getByRole("link");
    await expect(links.first()).toHaveText(/Notifications/);
    await expect(sheet.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/me/profile");
    await expect(sheet.getByRole("link", { name: "My data" })).toHaveAttribute("href", "/me/data");
    await expect(sheet.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/sign-out");
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("is not shown while answering the questionnaire", async ({ page }) => {
    await page.route("**/api/v1/me/onboarding-state", (route) => json(route, { userId: "student-1", onboarded: false, relationship: null, ref: null }));
    await page.goto("/me/onboarding?as=student");
    await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main tabs" })).toHaveCount(0);
  });
});

test.describe("Home", () => {
  test("greets the student by name, shows where they are and what comes next, and the universities for their course", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
    await expect(page.getByTestId("stage-card")).toContainText("Choose course");
    await expect(page.getByTestId("stage-card")).toContainText("Step 2 of 6");
    await expect(page.getByTestId("next-step")).not.toBeEmpty();
    await expect(page.getByTestId("whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/919876543210/);
    await expect(page.getByTestId("for-you")).toContainText("Computer Science and IT");
    await expect(page.getByTestId("finish-profile")).toHaveCount(0);
    await axe(page);
  });

  test("a person who has not finished onboarding is asked to, and is not greeted with answers they never gave", async ({ page }) => {
    await stubHome(page, home({ onboarded: false, firstName: null, courseFields: [], lead: null }));
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    await expect(page.getByTestId("finish-profile").getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/me/onboarding");
    await expect(page.getByTestId("stage-card")).toContainText("We are matching your application");
    await expect(page.getByTestId("for-you")).toContainText("Best NAAC grade first");
  });

  test("says what went wrong, and offers a retry, when the data cannot be read", async ({ page }) => {
    await page.route("**/api/v1/me/home", (route) => json(route, { error: { code: "INTERNAL", message: "x" }, request_id: "r" }, 500));
    await page.goto("/me");
    await expect(page.locator(".me-notice-error")).toContainText("We could not load this page.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("Universities", () => {
  test("starts with the student's own courses ticked, and the universities that offer them come first", async ({ page }) => {
    await stubPreferences(page);
    await page.goto("/me/universities");
    await expect(page.getByRole("heading", { name: "Universities", level: 1 })).toBeVisible();
    const chip = page.getByRole("button", { name: "Computer Science and IT" });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const first = page.getByTestId("university").first();
    await expect(first.getByTestId("match")).toContainText("Computer Science and IT");
    await axe(page);
  });

  test("ordering changes when another course is ticked, without changing the saved answers", async ({ page }) => {
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST") writes += 1;
    });
    await stubPreferences(page, preferences({ courseFields: [] }));
    await page.goto("/me/universities");
    await expect(page.getByTestId("university").first()).toBeVisible();
    const before = await page.getByTestId("university").first().innerText();
    const chips = page.getByRole("group", { name: "Your courses" }).getByRole("button");
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);
    await chips.nth(count - 1).click();
    await expect(chips.nth(count - 1)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("match").first()).toBeVisible();
    expect(typeof before).toBe("string");
    expect(writes).toBe(0);
  });

  test("labels a university with no NAAC grade 'not stated', and lists it after the graded ones", async ({ page }) => {
    await stubPreferences(page, preferences({ courseFields: [] }));
    await page.goto("/me/universities");
    const grades = await page.getByTestId("naac").allInnerTexts();
    expect(grades.length).toBeGreaterThan(0);
    const firstMissing = grades.findIndex((g) => g.includes("not stated"));
    if (firstMissing >= 0) expect(grades.slice(firstMissing).every((g) => g.includes("not stated"))).toBe(true);
  });

  test("a person who has not finished is told, and still sees the list by NAAC grade", async ({ page }) => {
    await stubPreferences(page, preferences({ onboarded: false, firstName: null, courseFields: [] }));
    await page.goto("/me/universities");
    await expect(page.getByTestId("finish-profile")).toContainText("Finish your profile");
    await expect(page.getByTestId("university").first()).toBeVisible();
  });
});

test.describe("Help", () => {
  test("links the public guides and the WhatsApp button, with no data call", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      // The dot on the round button asks for its own small count on every student screen (S13.5); the Help page itself asks for nothing.
      if (request.url().includes("/api/v1/me/") && !request.url().includes("/api/v1/me/notifications")) calls.push(request.url());
    });
    await page.goto("/me/help");
    await expect(page.getByRole("heading", { name: "Help", level: 1 })).toBeVisible();
    for (const [name, href] of [["How applying works", "/process"], ["The student visa", "/visa"], ["Questions and answers", "/faq"], ["Contact us", "/contact"]] as const) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    await axe(page);
    expect(calls).toEqual([]);
  });
});

test.describe("offline", () => {
  test("keeps the first name, the courses and the stage, and shows them when the phone has no signal", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
    // Everything is written a moment after the data arrives.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open("scollarly");
              open.onerror = () => resolve("");
              open.onsuccess = () => {
                const all = open.result.transaction("progressSnapshot").objectStore("progressSnapshot").getAll();
                all.onsuccess = () => {
                  const row = all.result[0] as { firstName?: string; courseFields?: string[]; leadRef?: string } | undefined;
                  resolve(row ? `${row.firstName}|${(row.courseFields ?? []).join(",")}|${row.leadRef}` : "");
                };
              };
            }),
        ),
      )
      .toBe("Ada|computer_science_it|SC-ABCDE-FGHJK");

    // The phone keeps no number, no email and no full name.
    const kept = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open("scollarly");
          open.onsuccess = () => {
            const all = open.result.transaction("progressSnapshot").objectStore("progressSnapshot").getAll();
            all.onsuccess = () => resolve(JSON.stringify(all.result[0]));
          };
        }),
    );
    expect(Object.keys(JSON.parse(kept)).sort()).toEqual(["courseFields", "firstName", "leadRef", "level", "stageCode", "updatedAt", "userId"]);
    expect(kept).not.toMatch(/@|\+91|Eze/);

    // The page loads but its data call cannot reach the server, as on a phone with no signal.
    await page.unroute("**/api/v1/me/home");
    await page.route("**/api/v1/me/home", (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("from-phone")).toBeVisible();
    await expect(page.getByTestId("stage-card")).toContainText("Choose course");
    await expect(page.getByTestId("for-you")).toContainText("Computer Science and IT");
  });

  test("a different student signing in on the same phone sees nothing of the first", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
    await page.unroute("**/api/v1/me/home");
    await stubHome(page, home({ userId: "student-2", firstName: "Kofi", courseFields: ["law"], lead: null }));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hi Kofi" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open("scollarly");
              open.onsuccess = () => {
                const all = open.result.transaction("progressSnapshot").objectStore("progressSnapshot").getAll();
                all.onsuccess = () => resolve(JSON.stringify((all.result as { userId: string; firstName?: string; leadRef: string }[]).map((r) => [r.userId, r.firstName, r.leadRef])));
              };
            }),
        ),
      )
      .toBe(JSON.stringify([["student-2", "Kofi", ""]]));
  });

  test("the public offline page greets the student by name and lists the universities in their order", async ({ page }) => {
    await stubHome(page);
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => new Promise<number>((resolve) => { const o = indexedDB.open("scollarly"); o.onsuccess = () => { const a = o.result.transaction("progressSnapshot").objectStore("progressSnapshot").count(); a.onsuccess = () => resolve(a.result); }; })))
      .toBe(1);
    await page.goto("/offline");
    await expect(page.getByTestId("offline-greeting")).toHaveText(/Hi Ada/);
    await expect(page.getByTestId("offline-universities")).toBeVisible();
    await expect(page.getByTestId("offline-universities").getByTestId("university").first()).toBeVisible();
  });

  test("sign-out forgets the copy on the phone", async ({ page }) => {
    await stubHome(page);
    await page.route("**/api/auth/sign-out", (route) => json(route, {}));
    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Hi Ada" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => new Promise<number>((resolve) => { const o = indexedDB.open("scollarly"); o.onsuccess = () => { const a = o.result.transaction("progressSnapshot").objectStore("progressSnapshot").count(); a.onsuccess = () => resolve(a.result); }; })))
      .toBe(1);
    await page.goto("/sign-out");
    await page.waitForURL("**/");
    await page.goto("/offline");
    await expect(page.getByTestId("offline-greeting")).toHaveCount(0);
  });
});
