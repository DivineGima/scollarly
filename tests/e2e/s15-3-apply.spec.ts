import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";

/**
 * S15.3 (PRD_4 F24, architecture 23.3): the Apply screen in a real browser at phone width. The two data calls are stubbed (what they answer
 * is proven against a real database in tests/integration/s15-3-apply.test.ts); here we check the list and its order, the three-programme
 * rule, what is sent, the already-applied states, and the offline queue. The programmes are the content fixture's.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

// The ids of the content fixture (tests/fixtures/content-snapshot.json).
const BTECH = "00000000-0000-4000-8000-0000000000a1";
const MBA = "00000000-0000-4000-8000-0000000000a2";
const BBA = "00000000-0000-4000-8000-0000000000a3";
const BCOM = "00000000-0000-4000-8000-0000000000b1";

const context = (over: Record<string, unknown> = {}) => ({ userId: "student-1", onboarded: true, relationship: "student", firstName: "Ada", courseFields: ["commerce"], lead: null, ...over });

interface Stub {
  posts: Request[];
  /** While true the POST fails like a lost connection. */
  blocked: boolean;
  answer: { status: number; body: unknown };
}

async function stub(page: Page, data = context()): Promise<Stub> {
  const handle: Stub = { posts: [], blocked: false, answer: { status: 201, body: { status: "created", ref: "SC-ABCDE-FGHJK" } } };
  await page.route("**/api/v1/me/application-context", (route) => json(route, data));
  await page.route("**/api/v1/me/application", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    if (handle.blocked) return route.abort("failed");
    handle.posts.push(route.request());
    return json(route, handle.answer.body, handle.answer.status);
  });
  return handle;
}

const tick = (page: Page, name: RegExp) => page.getByRole("checkbox", { name }).check();
async function tickThree(page: Page) {
  await tick(page, /MBA/);
  await tick(page, /B\.Com/);
  await tick(page, /BBA/);
}

async function setConnection(context: BrowserContext, server: Stub, online: boolean) {
  server.blocked = !online;
  await context.setOffline(!online);
}

test.describe("choosing the programmes", () => {
  test("lists every programme with the ones in the chosen courses first, and passes the accessibility check", async ({ page }) => {
    await stub(page);
    await page.goto("/me/apply");
    await expect(page.getByRole("heading", { name: "Apply", level: 1 })).toBeVisible();
    const rows = page.locator(".apply-row");
    await expect(rows).toHaveCount(4);
    // The student chose commerce, so B.Com comes first and is marked; the rest follow by the university's NAAC grade, then by name.
    await expect(rows.nth(0)).toContainText("B.Com");
    await expect(rows.nth(0)).toContainText("Suggested for you");
    await expect(rows.nth(1)).toContainText("B.Tech Computer Science");
    await expect(rows.nth(2)).toContainText("BBA");
    await expect(rows.nth(3)).toContainText("MBA");
    await expect(page.getByTestId("apply-count")).toHaveText("0 chosen (at least 3 needed)");
    await axe(page);
  });

  test("does not ask again for what the profile already holds", async ({ page }) => {
    await stub(page);
    await page.goto("/me/apply");
    await expect(page.getByLabel(/name/i)).toHaveCount(0);
    await expect(page.getByLabel(/WhatsApp/i)).toHaveCount(0);
    await expect(page.getByLabel(/country/i)).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(4);
  });

  test("says what is missing when fewer than three are chosen, and sends nothing", async ({ page }) => {
    const server = await stub(page);
    await page.goto("/me/apply");
    await tick(page, /MBA/);
    await tick(page, /BBA/);
    await expect(page.getByTestId("apply-count")).toHaveText("2 chosen (at least 3 needed)");
    await page.getByTestId("apply-send").click();
    await expect(page.getByTestId("apply-problem")).toHaveText("Choose at least 3 programmes to continue.");
    expect(server.posts).toHaveLength(0);
    await tick(page, /B\.Com/);
    await expect(page.getByTestId("apply-problem")).toHaveCount(0);
  });

  test("shows the order chosen, and lets a choice be taken back", async ({ page }) => {
    await stub(page);
    await page.goto("/me/apply");
    await tick(page, /MBA/);
    await tick(page, /BBA/);
    await expect(page.locator(".apply-row", { hasText: "MBA" })).toContainText("Choice 1");
    await expect(page.locator(".apply-row", { hasText: "BBA" })).toContainText("Choice 2");
    await page.getByRole("checkbox", { name: /MBA/ }).uncheck();
    await expect(page.locator(".apply-row", { hasText: "BBA" })).toContainText("Choice 1");
    await expect(page.getByTestId("apply-count")).toHaveText("1 chosen (at least 3 needed)");
  });
});

test.describe("sending", () => {
  test("sends only the programmes in the order chosen, with the key in the header and no personal details or Turnstile token, then shows the reference", async ({ page }) => {
    const server = await stub(page);
    await page.goto("/me/apply");
    await tickThree(page);
    await page.getByTestId("apply-send").click();
    await expect(page.getByRole("heading", { name: "Your application is sent" })).toBeVisible();
    await expect(page.getByText("Your reference: SC-ABCDE-FGHJK")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to my page" })).toHaveAttribute("href", "/me");
    await axe(page);

    expect(server.posts).toHaveLength(1);
    const request = server.posts[0] as Request;
    expect(request.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    const sent = request.postDataJSON();
    expect(sent.programme_ids).toEqual([MBA, BCOM, BBA]);
    expect(Object.keys(sent).sort()).toEqual(["client_created_at", "client_ref", "locale", "programme_ids"]);
    expect(sent.client_ref).toMatch(/^SC-[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(sent.turnstile_token).toBeUndefined();
  });

  test("a second tap while it is sending does not send twice", async ({ page }) => {
    const server = await stub(page);
    await page.goto("/me/apply");
    await tickThree(page);
    const button = page.getByTestId("apply-send");
    await button.dblclick();
    await expect(page.getByRole("heading", { name: "Your application is sent" })).toBeVisible();
    expect(server.posts).toHaveLength(1);
  });

  test("goes back to the choice, keeping nothing half-sent, when the server cannot accept it", async ({ page }) => {
    const server = await stub(page);
    server.answer = { status: 400, body: { error: { code: "VALIDATION", message: "Check the highlighted fields.", fields: { programme_ids: "UNKNOWN_VALUE" } }, request_id: "r" } };
    await page.goto("/me/apply");
    await tickThree(page);
    await page.getByTestId("apply-send").click();
    await expect(page.getByRole("heading", { name: "We could not send your application" })).toBeVisible();
    await axe(page);
    await page.getByRole("button", { name: "Review my programmes" }).click();
    await expect(page.getByRole("heading", { name: "Apply", level: 1 })).toBeVisible();
    // A fresh key for the corrected application: the old one would be refused as reused.
    server.answer = { status: 201, body: { status: "created", ref: "SC-ABCDE-FGHJK" } };
    await tickThree(page);
    await page.getByTestId("apply-send").click();
    await expect(page.getByRole("heading", { name: "Your application is sent" })).toBeVisible();
    expect(new Set(server.posts.map((p) => p.headers()["idempotency-key"])).size).toBe(server.posts.length);
  });
});

test.describe("one application per account", () => {
  test("shows where the application stands, and no form, to someone who already applied", async ({ page }) => {
    const server = await stub(page, context({ lead: { ref: "SC-ABCDE-FGHJK", stage: "course_interest", updatedAt: "2026-11-01T10:00:00.000Z" } }));
    await page.goto("/me/apply");
    await expect(page.getByRole("heading", { name: "You already applied" })).toBeVisible();
    await expect(page.getByText("Your reference: SC-ABCDE-FGHJK")).toBeVisible();
    await expect(page.getByText("Current step: Course interest")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByTestId("apply-send")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go to my page" })).toHaveAttribute("href", "/me");
    await axe(page);
    expect(server.posts).toHaveLength(0);
  });

  test("treats 'already applied' from the server (a second device got there first) as done", async ({ page }) => {
    const server = await stub(page);
    server.answer = { status: 409, body: { error: { code: "ALREADY_APPLIED", message: "You already applied.", fields: { ref: "SC-OLDAP-PLIED" } }, request_id: "r" } };
    await page.goto("/me/apply");
    await tickThree(page);
    await page.getByTestId("apply-send").click();
    await expect(page.getByRole("heading", { name: "You already applied" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "We could not send your application" })).toHaveCount(0);
  });

  test("the Home shows an Apply button until the student has applied", async ({ page }) => {
    await page.route("**/api/v1/me/home", (route) =>
      json(route, { userId: "student-1", onboarded: true, relationship: "student", firstName: "Ada", courseFields: ["commerce"], level: "undergraduate", intakeYear: 2027, lead: null, stages: [], whatsappE164: "+919876543210" }),
    );
    await page.goto("/me");
    await expect(page.getByTestId("apply-button")).toHaveAttribute("href", "/me/apply");
    await expect(page.getByText("You have not applied yet.")).toBeVisible();
    await axe(page);
  });
});

test.describe("without a connection, and without a session", () => {
  test("offline: saves on the phone, then sends exactly once when the connection returns", async ({ page, context }) => {
    const server = await stub(page);
    await page.goto("/me/apply");
    await tickThree(page);
    await setConnection(context, server, false);
    await page.getByTestId("apply-send").click();
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    await expect(page.getByText(/You are offline/)).toBeVisible();
    expect(server.posts).toHaveLength(0);
    await axe(page);

    await setConnection(context, server, true);
    await expect(page.getByRole("heading", { name: "Your application is sent" })).toBeVisible({ timeout: 20_000 });
    expect(server.posts).toHaveLength(1);
  });

  test("an ended session keeps the application and asks the person to sign in", async ({ page }) => {
    const server = await stub(page);
    server.answer = { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Sign in required." }, request_id: "r" } };
    await page.goto("/me/apply");
    await tickThree(page);
    await page.getByTestId("apply-send").click();
    await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
    await expect(page.getByText("Your session ended. Sign in to send your application.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });
});
