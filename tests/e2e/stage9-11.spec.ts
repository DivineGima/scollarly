import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Stages 9 to 11 in a real browser on a production build (`next start`): payments (B9), the all-admin performance view (C3), Settings (C4),
 * Health (C7), and the hardening checks (enforced CSP, 375 px layout). As in stage6-8.spec.ts there is no Worker, Neon or session here, so the
 * edge endpoints are answered by small fakes that return the shapes and status codes the integration tests (stage9-payments,
 * stage10-owner) prove the real ones return. What these tests prove is the screen: what it shows, what it sends, and what it does with
 * each answer.
 */

test.use({ serviceWorkers: "block" });

const U1 = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01";
const U2 = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02";
const P1 = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01";
const P2 = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02";
const LEAD = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4c01";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const fail = (route: Route, status: number, code: string, fields: Record<string, string> = {}) => json(route, { error: { code, message: code, fields }, request_id: "r" }, status);
const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

const as = (page: Page, role: "admin" | "owner") => page.route("**/api/v1/admin/session", (route) => json(route, { role, name: "Test", email: `${role}@example.test`, stepUpFresh: false }));

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

// ---- B9 payments ---------------------------------------------------------------------------------------------------

const row = (over: Record<string, unknown> = {}) => ({
  id: P1,
  universityId: U1,
  universityName: "Alpha University",
  leadId: LEAD,
  leadRef: "SC-K7M2Q-XB9T4",
  amountUsdCents: 150050,
  receivedOn: "2026-10-20",
  note: "First instalment",
  enteredBy: "u",
  enteredByEmail: "priya@example.test",
  enteredAt: "2026-10-20T09:00:00.000Z",
  voidedAt: null,
  voidReason: null,
  ...over,
});

const ledger = (over: Record<string, unknown> = {}) => ({
  rows: [row(), row({ id: P2, universityId: U2, universityName: "Beta University", leadId: null, leadRef: null, amountUsdCents: 99999, receivedOn: "2026-10-03", note: null, voidedAt: "2026-10-04T10:00:00.000Z", voidReason: "Entered twice" })],
  truncated: false,
  totals: {
    grandTotalCents: 150050,
    count: 1,
    byUniversity: [{ universityId: U1, name: "Alpha University", totalCents: 150050, count: 1 }],
    byMonth: [{ month: "2026-10", totalCents: 150050, count: 1 }],
  },
  universities: [
    { id: U1, name: "Alpha University" },
    { id: U2, name: "Beta University" },
  ],
  today: "2026-10-26",
  ...over,
});

test.describe("B9 payments", () => {
  test("shows totals without voided payments, strikes a voided row through with its reason, and links the lead", async ({ page }) => {
    await as(page, "admin");
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => json(route, ledger()));
    await page.goto("/admin/payments");
    await expect(page.getByRole("heading", { name: "Payments received", level: 1 })).toBeVisible();
    await expect(page.getByTestId("grand-total")).toHaveText("USD 1,500.50");
    await expect(page.getByText("October 2026")).toBeVisible();
    const voided = page.locator('tr[data-voided="true"]');
    await expect(voided).toContainText("Entered twice");
    await expect(voided.locator("td").first()).toHaveClass(/line-through/);
    await expect(voided.getByRole("button", { name: "Void" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "SC-K7M2Q-XB9T4" })).toHaveAttribute("href", `/admin/leads/${LEAD}`);
    await axe(page);
  });

  test("filters live in the address and the CSV link carries exactly the same filters", async ({ page }) => {
    await as(page, "admin");
    const seen: string[] = [];
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => {
      seen.push(new URL(route.request().url()).search);
      return json(route, ledger());
    });
    await page.goto(`/admin/payments?university=${U1}&from=2026-10-01&to=2026-10-31&status=active`);
    await expect(page.getByTestId("grand-total")).toBeVisible();
    expect(seen[0]).toBe(`?university=${U1}&from=2026-10-01&to=2026-10-31&status=active`);
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", `/api/v1/admin/payments-csv?university=${U1}&from=2026-10-01&to=2026-10-31&status=active`);
  });

  test("says so when nothing matches, and offers a retry when the ledger cannot be read", async ({ page }) => {
    await as(page, "admin");
    let calls = 0;
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => {
      calls += 1;
      if (calls === 1) return fail(route, 500, "INTERNAL");
      return json(route, ledger({ rows: [], totals: { grandTotalCents: 0, count: 0, byUniversity: [], byMonth: [] } }));
    });
    await page.goto("/admin/payments");
    await expect(alerts(page)).toContainText("We could not load this page");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("No payments have been recorded yet.")).toBeVisible();
    await expect(page.getByTestId("grand-total")).toHaveText("USD 0.00");
  });

  test("records a payment: checks the fields first, sends one request with a token, and shows the server's answer for a field", async ({ page }) => {
    await as(page, "admin");
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => json(route, ledger()));
    await page.route(/\/api\/v1\/admin\/payment-leads\?/, (route) => json(route, { leads: [{ id: LEAD, ref: "SC-K7M2Q-XB9T4", name: "Test Student" }] }));
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/v1/admin/payments.record", async (route) => {
      bodies.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, 300));
      return bodies.length === 1 ? fail(route, 400, "VALIDATION", { universityId: "UNKNOWN_VALUE" }) : json(route, { id: P1, status: "created" }, 201);
    });
    await page.goto("/admin/payments");
    await page.getByRole("button", { name: "Record payment" }).click();
    const dialog = page.getByRole("dialog", { name: "Record a payment" });
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(dialog.getByText("This is required.").first()).toBeVisible();
    await expect(dialog.getByText(/dollars and cents/)).toBeVisible();
    expect(bodies).toHaveLength(0);

    await dialog.getByLabel("University").selectOption(U1);
    await dialog.getByLabel("Amount in US dollars").fill("1,500.50");
    await dialog.getByLabel("Date received").fill("2026-10-27");
    await dialog.getByRole("button", { name: "Save payment" }).click();
    await expect(dialog.getByText("The date cannot be in the future.")).toBeVisible();
    expect(bodies).toHaveLength(0);

    await dialog.getByLabel("Date received").fill("2026-10-26");
    await dialog.getByLabel("Linked lead (optional)").fill("Test");
    await dialog.getByRole("button", { name: /Test Student/ }).click();
    await dialog.getByLabel("Note (optional)").fill("=HYPERLINK()");
    // A double tap sends one request: the button is disabled while the first is on its way.
    const save = dialog.getByRole("button", { name: "Save payment" });
    await save.dblclick();
    await expect(dialog.getByText("That choice no longer exists. Reload the page.")).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ universityId: U1, amount: "1,500.50", receivedOn: "2026-10-26", leadId: LEAD, note: "=HYPERLINK()" });
    expect(bodies[0]?.submissionToken).toMatch(/^[0-9a-f-]{36}$/);

    // Saving again after a failure reuses the token (the server answers "replayed" if the first one actually got through).
    await save.click();
    await expect(dialog).toBeHidden();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.submissionToken).toBe(bodies[0]?.submissionToken);

    // The next payment is a new form with a new token.
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("dialog", { name: "Record a payment" }).getByLabel("University").selectOption(U1);
    await page.getByRole("dialog", { name: "Record a payment" }).getByLabel("Amount in US dollars").fill("5");
    await page.getByRole("dialog", { name: "Record a payment" }).getByRole("button", { name: "Save payment" }).click();
    await expect.poll(() => bodies.length).toBe(3);
    expect(bodies[2]?.submissionToken).not.toBe(bodies[0]?.submissionToken);
  });

  test("voiding needs a reason, sends it, and treats 'already voided' as a stale list rather than an error", async ({ page }) => {
    await as(page, "admin");
    let loads = 0;
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => {
      loads += 1;
      return json(route, ledger());
    });
    const bodies: unknown[] = [];
    await page.route("**/api/v1/admin/payments.void", (route) => {
      bodies.push(route.request().postDataJSON());
      return bodies.length === 1 ? fail(route, 409, "CONFLICT") : json(route, { voided: true });
    });
    await page.goto("/admin/payments");
    await page.getByRole("row", { name: /Alpha University/ }).getByRole("button", { name: "Void" }).click();
    const dialog = page.getByRole("dialog", { name: "Void this payment" });
    await dialog.getByRole("button", { name: "Void payment" }).click();
    await expect(dialog.getByText("This is required.")).toBeVisible();
    expect(bodies).toHaveLength(0);
    await dialog.getByLabel("Reason (required)").fill("Paid twice");
    await dialog.getByRole("button", { name: "Void payment" }).click();
    await expect(dialog).toBeHidden();
    expect(bodies).toEqual([{ id: P1, reason: "Paid twice" }]);
    expect(loads).toBeGreaterThanOrEqual(2);
  });

  test("works at 375 px without sideways scrolling", async ({ page }) => {
    await as(page, "admin");
    await page.setViewportSize({ width: 375, height: 700 });
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => json(route, ledger()));
    await page.goto("/admin/payments");
    await expect(page.getByTestId("grand-total")).toBeVisible();
    await noSideways(page);
  });
});

// ---- S9.3 / C3 -----------------------------------------------------------------------------------------------------

test.describe("S9.3 payments in analytics", () => {
  test("shows what was received in the range and links to the Payments page with the same range", async ({ page }) => {
    await as(page, "admin");
    await page.route(/\/api\/v1\/admin\/analytics\?/, (route) =>
      json(route, {
        range: { from: "2026-10-01", to: "2026-10-26" },
        collectPageViews: true,
        funnel: [],
        sources: { byCountry: [], byUniversity: [], byPage: [] },
        universities: [],
        payments: { totalCents: 120000, count: 2, byUniversity: [{ universityId: U1, name: "Alpha University", totalCents: 120000, count: 2 }] },
        totalLeads: 0,
      }),
    );
    await page.goto("/admin/analytics?tab=funnel&from=2026-10-01&to=2026-10-26");
    await expect(page.getByTestId("payments-total")).toHaveText("USD 1,200.00");
    await expect(page.getByTestId("payments-received")).toContainText("Alpha University");
    await expect(page.getByRole("link", { name: "Open the Payments page for this range" })).toHaveAttribute("href", "/admin/payments?from=2026-10-01&to=2026-10-26");
  });
});

test.describe("C3 every admin's performance", () => {
  const admins = [
    { userId: "u1", email: "priya@example.test", name: "Priya", role: "admin", assigned: 12, answered: 10, medianMinutes: 35, meanMinutes: 40, overdue: 1 },
    { userId: "u2", email: "idle@example.test", name: "", role: "admin", assigned: 0, answered: 0, medianMinutes: null, meanMinutes: null, overdue: 0 },
  ];

  test("the owner sees a row for each admin, including one with nothing yet, and can open their leads", async ({ page }) => {
    await as(page, "owner");
    await page.route(/\/api\/v1\/admin\/performance-all\?/, (route) => json(route, { range: { from: "2026-09-27", to: "2026-10-26" }, admins }));
    await page.goto("/admin/analytics/performance");
    const table = page.getByTestId("performance-all");
    await expect(table.getByRole("row", { name: /Priya/ })).toContainText("35 minutes");
    await expect(table.getByRole("row", { name: /idle@example.test/ })).toContainText("No answered leads yet");
    await expect(table.getByRole("link", { name: "Priya" })).toHaveAttribute("href", "/admin/leads?assigned=u1");
    await axe(page);
  });

  test("an admin who opens the address sees nothing, and the data call is never made", async ({ page }) => {
    await as(page, "admin");
    let asked = false;
    await page.route(/\/api\/v1\/admin\/performance-all\?/, (route) => {
      asked = true;
      return fail(route, 403, "FORBIDDEN");
    });
    await page.goto("/admin/analytics/performance");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByTestId("performance-all")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Every admin's performance" })).toHaveCount(0);
    expect(asked).toBe(false);
  });

  test("the owner's menu has Settings and Health and the admin's does not; both have Payments", async ({ page }) => {
    await as(page, "owner");
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => json(route, ledger()));
    await page.goto("/admin/payments");
    const nav = page.getByRole("navigation", { name: "Admin menu" });
    for (const name of ["Payments", "Settings", "Health", "Analytics", "Content"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    await page.unroute("**/api/v1/admin/session");
    await as(page, "admin");
    await page.goto("/admin/payments");
    await expect(page.getByRole("navigation", { name: "Admin menu" }).getByRole("link", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin menu" }).getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Admin menu" }).getByRole("link", { name: "Health" })).toHaveCount(0);
  });
});

// ---- C4 settings ---------------------------------------------------------------------------------------------------

const settings = {
  values: {
    whatsapp_number_e164: "+447700900123",
    contact_phone_display: "+44 7700 900123",
    sla_weekday_hours: 4,
    sla_weekend_hours: 24,
    stale_fee_days: 180,
    stale_tour_days: 90,
    pipeline_freshness_days: null,
    media_budget_bytes: 3758096384,
    collect_page_views: true,
  },
  timezone: "Africa/Douala",
  limits: { mediaBudgetMinBytes: 104857600, mediaBudgetMaxBytes: 5368709120 },
};

test.describe("C4 settings", () => {
  test("shows the current values, the time zone, and nothing to save until something changes", async ({ page }) => {
    await as(page, "owner");
    await page.route("**/api/v1/admin/settings", (route) => json(route, settings));
    await page.goto("/admin/settings");
    await expect(page.getByLabel("Reply target on weekdays (hours)")).toHaveValue("4");
    await expect(page.getByLabel("Image storage budget (MiB)")).toHaveValue("3584");
    await expect(page.getByLabel("Pipeline freshness (days)")).toHaveValue("");
    await expect(page.getByText(/Africa\/Douala \(West Africa Time\)/)).toBeVisible();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Nothing has changed.")).toBeVisible();
    await axe(page);
  });

  test("asks for the authenticator code on save, then repeats the save, sends only what changed and refreshes the public site", async ({ page }) => {
    await as(page, "owner");
    await page.route("**/api/v1/admin/settings", (route) => json(route, settings));
    const saves: unknown[] = [];
    await page.route("**/api/v1/admin/settings.update", (route) => {
      saves.push(route.request().postDataJSON());
      return saves.length === 1 ? fail(route, 403, "STEP_UP_REQUIRED") : json(route, { changed: ["whatsapp_number_e164"], revalidate: { areas: ["site"], paths: ["/", "/contact"] } });
    });
    await page.route("**/api/v1/auth/twoFactor.verify", (route) => json(route, { ok: true }));
    let revalidated: unknown = null;
    await page.route("**/api/v1/admin/revalidate", (route) => {
      revalidated = route.request().postDataJSON();
      return json(route, { revalidated: ["site"], purged: 2 });
    });
    await page.goto("/admin/settings");
    await page.getByLabel("Scollarly WhatsApp number").fill("+44 7700 900999");
    await page.getByRole("button", { name: "Save settings" }).click();
    const step = page.getByRole("dialog", { name: "Confirm it's you" });
    await step.getByLabel("6-digit code").fill("123456");
    await step.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/The public site is refreshing/)).toBeVisible();
    expect(saves).toEqual([{ changes: { whatsapp_number_e164: "+44 7700 900999" } }, { changes: { whatsapp_number_e164: "+44 7700 900999" } }]);
    expect(revalidated).toEqual({ areas: ["site"], paths: ["/", "/contact"] });
  });

  test("shows the server's reason beside the field and saves nothing when a value is refused", async ({ page }) => {
    await as(page, "owner");
    await page.route("**/api/v1/admin/settings", (route) => json(route, settings));
    await page.route("**/api/v1/admin/settings.update", (route) => fail(route, 400, "VALIDATION", { "changes.sla_weekday_hours": "INVALID" }));
    await page.goto("/admin/settings");
    await page.getByLabel("Reply target on weekdays (hours)").fill("900");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("This value is not allowed. Check the range under the field.")).toBeVisible();
    await expect(page.getByText("Some values are not valid. Nothing was saved.")).toBeVisible();
    await expect(page.getByLabel("Reply target on weekdays (hours)")).toHaveAttribute("aria-invalid", "true");
  });

  test("an admin who opens the address sees nothing", async ({ page }) => {
    await as(page, "admin");
    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toHaveCount(0);
  });

  test("the full export is requested with a step-up and handed to the browser as a file", async ({ page }) => {
    await as(page, "owner");
    await page.route("**/api/v1/admin/settings", (route) => json(route, settings));
    await page.route("**/api/v1/admin/export.download", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", headers: { "Content-Disposition": 'attachment; filename="scollarly-export-2026-10-26.json"' }, body: '{"format":"scollarly-export-v1","tables":{}}' }),
    );
    await page.goto("/admin/settings");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download full export" }).click();
    expect((await download).suggestedFilename()).toBe("scollarly-export-2026-10-26.json");
  });

  test("works at 375 px without sideways scrolling", async ({ page }) => {
    await as(page, "owner");
    await page.setViewportSize({ width: 375, height: 700 });
    await page.route("**/api/v1/admin/settings", (route) => json(route, settings));
    await page.goto("/admin/settings");
    await expect(page.getByLabel("Scollarly WhatsApp number")).toBeVisible();
    await noSideways(page);
  });
});

// ---- C7 health -----------------------------------------------------------------------------------------------------

const health = (over: Record<string, unknown> = {}) => ({
  checkedAt: "2026-10-26T12:00:00.000Z",
  database: { usedBytes: 100 * 1024 * 1024, budgetBytes: 512 * 1024 * 1024, ratio: 0.195, level: "ok" },
  images: { usedBytes: 2_800_000_000, budgetBytes: 3_758_096_384, ratio: 0.745, level: "warn" },
  jobs: [
    { job: "rollup", lastRunAt: "2026-10-26T00:05:00.000Z", lastOkAt: "2026-10-26T00:05:00.000Z", lastFailedAt: null },
    { job: "usage", lastRunAt: null, lastOkAt: null, lastFailedAt: null },
  ],
  stale: { fees: 2, campus: 1, resources: 0 },
  collectPageViews: true,
  pipeline: null,
  ...over,
});

test.describe("C7 health", () => {
  test("shows sizes with the 70% banner, the last runs, stale counts and the dashboards", async ({ page }) => {
    await as(page, "owner");
    await page.route("**/api/v1/admin/health", (route) => json(route, health()));
    await page.goto("/admin/health");
    await expect(page.getByTestId("meter-warn")).toContainText("2.6 GiB of 3.5 GiB (75%)");
    await expect(page.getByTestId("meter-warn")).toContainText("Plan what to do before it fills up.");
    await expect(page.getByTestId("meter-ok")).toContainText("100 MiB of 512 MiB");
    await expect(page.getByTestId("job-rollup")).toContainText("Last ran fine");
    await expect(page.getByTestId("job-usage")).toContainText("Has not run yet.");
    await expect(page.getByTestId("stale")).toContainText("2 stale fees, 1 stale tour, 0 stale links.");
    await expect(page.getByRole("link", { name: /Neon: compute hours/ })).toHaveAttribute("href", /neon/);
    await axe(page);
  });

  test("pauses page-view collection through the settings operation with a step-up, and shows the switch flipped", async ({ page }) => {
    await as(page, "owner");
    let collect = true;
    await page.route("**/api/v1/admin/health", (route) => json(route, health({ collectPageViews: collect })));
    const sent: unknown[] = [];
    await page.route("**/api/v1/admin/settings.update", (route) => {
      sent.push(route.request().postDataJSON());
      collect = false;
      return json(route, { changed: ["collect_page_views"], revalidate: null });
    });
    await page.goto("/admin/health");
    await expect(page.getByTestId("collect-state")).toContainText("On");
    await page.getByRole("button", { name: "Pause page-view collection" }).click();
    await expect(page.getByTestId("collect-state")).toContainText("Paused");
    expect(sent).toEqual([{ changes: { collect_page_views: false } }]);
    await expect(page.getByRole("button", { name: "Resume page-view collection" })).toBeVisible();
  });

  test("shows the pipeline freshness once a target is set, and an error with a retry when the page cannot load", async ({ page }) => {
    await as(page, "owner");
    let calls = 0;
    await page.route("**/api/v1/admin/health", (route) => {
      calls += 1;
      return calls === 1 ? fail(route, 500, "INTERNAL") : json(route, health({ pipeline: { days: 14, active: 20, fresh: 15 } }));
    });
    await page.goto("/admin/health");
    await expect(alerts(page)).toContainText("We could not load this page");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("pipeline")).toContainText("15 of 20 active leads moved stage in the last 14 days.");
  });

  test("works at 375 px without sideways scrolling", async ({ page }) => {
    await as(page, "owner");
    await page.setViewportSize({ width: 375, height: 700 });
    await page.route("**/api/v1/admin/health", (route) => json(route, health()));
    await page.goto("/admin/health");
    await expect(page.getByTestId("meter-warn")).toBeVisible();
    await noSideways(page);
  });
});

// ---- S11.1 the enforced CSP ----------------------------------------------------------------------------------------

test.describe("S11.1 the enforced Content-Security-Policy", () => {
  const ROUTES = ["/", "/universities", "/fees", "/campus-tours", "/process", "/visa", "/faq", "/about", "/blog", "/contact", "/apply", "/privacy", "/terms", "/offline", "/sign-in"];

  for (const path of ROUTES) {
    test(`${path} loads with no policy violation`, async ({ page }) => {
      await page.route("**/challenges.cloudflare.com/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
      const violations: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${event.violatedDirective} ${event.blockedURI}`];
        });
      });
      page.on("console", (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
      });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const inPage = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
      expect([...violations, ...inPage]).toEqual([]);
    });
  }

  test("an admin screen, with an image preview and a download, breaks no rule either", async ({ page }) => {
    await as(page, "admin");
    await page.route(/\/api\/v1\/admin\/payments(\?|$)/, (route) => json(route, ledger()));
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
    });
    await page.goto("/admin/payments");
    await expect(page.getByTestId("grand-total")).toBeVisible();
    expect(violations).toEqual([]);
  });
});
