import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Stage 5 screens in a real browser on a production build (`next start`): Overview (B1), Leads (B2), Lead detail (B3), Link
 * requests (B4) and Data requests (B5). As in stage2-auth.spec.ts there is no Worker, Neon or session here, so the edge
 * endpoints are answered by a small stateful fake that returns the shapes and status codes tests/integration/stage5-leads.test.ts
 * proves the real ones return. What these tests prove is the screen: what it shows, what it sends, what it does with each answer.
 */

test.use({ serviceWorkers: "block" });

const LEAD_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const ME = "admin-me";
const VERSION_1 = "2026-10-21T12:00:00.000001Z";
const VERSION_2 = "2026-10-21T12:05:00.000002Z";

const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const fail = (route: Route, status: number, code: string, fields: Record<string, string> = {}) => json(route, { error: { code, message: code, fields }, request_id: "r" }, status);

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

// Exact routes: a glob such as "leads?*" would also match "leads.changeStage".
const LIST_WITH_QUERY = /\/api\/v1\/admin\/leads\?/;
const LIST_PLAIN = /\/api\/v1\/admin\/leads$/;
const LIST_ANY = /\/api\/v1\/admin\/leads(\?|$)/;
const ONE_LEAD = /\/api\/v1\/admin\/lead\?/;
const LEAD_OPERATION = /\/api\/v1\/admin\/leads\.[A-Za-z]+$/;

const STAGES = [
  { code: "share_results", name: { en: "Share results" } },
  { code: "choose_course", name: { en: "Choose course" } },
  { code: "offer_letter", name: { en: "Offer letter" } },
];

const item = (id: string, ref: string, name: string | null, over: Record<string, unknown> = {}) => ({
  id,
  ref,
  name,
  country: "GH",
  stage: "share_results",
  assigned: null,
  sla: { status: "open", dueAt: "2026-10-22T10:00:00.000Z" },
  receivedAt: "2026-10-21T08:00:00.000Z",
  erased: false,
  quick: false,
  ...over,
});

interface DetailData {
  lead: Record<string, unknown>;
  prefs: unknown[];
  timeline: Record<string, unknown>[];
  pendingClaims: number;
  duplicates: unknown[];
  stages: unknown[];
  admins: unknown[];
  template: string | null;
  you: string;
}

const detail = (over: Partial<DetailData> = {}, leadOver: Record<string, unknown> = {}): DetailData => ({
  lead: {
    id: LEAD_ID,
    ref: "SC-ABCDE-FGHJK",
    name: "Ama Mensah",
    whatsapp: "+233201111111",
    email: "ama@example.test",
    country: "GH",
    intakeKind: "full",
    qualificationType: "olevel_alevel",
    results: [{ subject: "Maths", grade: "A" }],
    locale: "en",
    stage: "share_results",
    assigned: null,
    linkedAccount: false,
    receivedAt: "2026-10-21T08:00:00.000Z",
    sla: { status: "open", dueAt: "2026-10-22T10:00:00.000Z" },
    slaHours: 4,
    firstResponseAt: null,
    erased: false,
    mergedInto: null,
    source: { page: "/universities/alpha", university: "Alpha University" },
    version: VERSION_1,
    ...leadOver,
  },
  prefs: [{ rank: 1, programmeId: "p1", programmeName: "B.Tech Computer Science", universityName: "Alpha University" }],
  timeline: [{ id: "t1", type: "created", at: "2026-10-21T08:00:00.000Z", by: null, data: {} }],
  pendingClaims: 0,
  duplicates: [],
  stages: STAGES,
  admins: [
    { id: ME, label: "Priya" },
    { id: "admin-2", label: "Kofi" },
  ],
  template: null,
  you: ME,
  ...over,
});

async function signIn(page: Page, role: "admin" | "owner" = "admin") {
  await page.route("**/api/v1/admin/session", (route) => json(route, { role, name: "Priya", email: "priya@example.test", stepUpFresh: false }));
}

// ---- B1 ------------------------------------------------------------------------------------------------------------

test.describe("B1 Overview", () => {
  const overview = { unanswered: 7, overdue: 2, mine: 3, unassigned: 4, today: 5, pendingClaims: 1, openDataRequests: 2, funnel: STAGES.map((s, i) => ({ code: s.code, name: s.name, count: [4, 2, 0][i] })) };

  test("shows the counts, each tile opens its filtered list, and the funnel opens a stage", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/overview", (route) => json(route, overview));
    await page.goto("/admin");
    await expect(page.getByTestId("tile-unanswered")).toHaveText("7");
    await expect(page.getByTestId("tile-overdue")).toHaveText("2");
    await expect(page.getByRole("link", { name: /Overdue/ })).toHaveAttribute("href", "/admin/leads?view=overdue");
    await expect(page.getByRole("link", { name: /Assigned to me/ })).toHaveAttribute("href", "/admin/leads?assigned=me");
    await expect(page.getByRole("link", { name: /Unassigned/ })).toHaveAttribute("href", "/admin/leads?view=unassigned");
    await expect(page.getByRole("link", { name: /Link requests/ })).toHaveAttribute("href", "/admin/leads/link-requests");
    await expect(page.getByRole("link", { name: /Data requests/ }).last()).toHaveAttribute("href", "/admin/data-requests");
    await expect(page.getByRole("link", { name: /Choose course/ })).toHaveAttribute("href", "/admin/leads?stage=choose_course");
    await axe(page);
  });

  test("says so when there are no leads yet, and shows an error with a retry when the counts cannot be read", async ({ page }) => {
    await signIn(page);
    let calls = 0;
    await page.route("**/api/v1/admin/overview", (route) => {
      calls += 1;
      return calls === 1 ? fail(route, 500, "INTERNAL") : json(route, { ...overview, funnel: overview.funnel.map((f) => ({ ...f, count: 0 })) });
    });
    await page.goto("/admin");
    await expect(alerts(page)).toContainText("We could not load this page.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("No leads yet.")).toBeVisible();
  });
});

// ---- B2 ------------------------------------------------------------------------------------------------------------

test.describe("B2 Leads list", () => {
  const universities = [{ id: "u1", name: "Alpha University" }];
  const admins = [{ id: ME, label: "Priya" }];

  async function serve(page: Page, rows: ReturnType<typeof item>[], seen: URL[], over: Record<string, unknown> = {}) {
    await page.route(LIST_WITH_QUERY, (route) => {
      const url = new URL(route.request().url());
      seen.push(url);
      const before = url.searchParams.get("before");
      const stage = url.searchParams.get("stage");
      const q = url.searchParams.get("q")?.toLowerCase();
      let list = rows.filter((r) => (!stage || r.stage === stage) && (!q || (r.name ?? "").toLowerCase().includes(q)));
      let nextBefore: string | null = null;
      if (list.length > 2 && !before) {
        nextBefore = list[1]?.id ?? null;
        list = list.slice(0, 2);
      } else if (before) list = rows.slice(2);
      return json(route, { leads: list, nextBefore, stages: STAGES, universities, admins, ...over });
    });
    await page.route(LIST_PLAIN, (route) => {
      seen.push(new URL(route.request().url()));
      return json(route, { leads: rows.slice(0, 2), nextBefore: rows.length > 2 ? (rows[1]?.id ?? null) : null, stages: STAGES, universities, admins });
    });
  }

  const rows = [
    item("l1", "SC-AAAAA-AAAAB", "Ama Mensah", { sla: { status: "overdue", dueAt: "2026-10-21T04:00:00.000Z" }, assigned: { id: ME, label: "Priya" } }),
    item("l2", "SC-AAAAA-AAAAC", "Kofi Boateng", { stage: "choose_course", sla: { status: "met", dueAt: "2026-10-21T04:00:00.000Z" } }),
    item("l3", "SC-AAAAA-AAAAD", "Ngozi Eze", { country: "NG" }),
    item("l4", "SC-AAAAA-AAAAE", null, { erased: true }),
  ];

  test("lists the leads with their SLA badge in WAT, links each to its detail, and pages with Show more", async ({ page }) => {
    await signIn(page);
    const seen: URL[] = [];
    await serve(page, rows, seen);
    await page.goto("/admin/leads");
    const table = page.getByRole("region", { name: "Leads" });
    await expect(table.getByRole("row")).toHaveCount(3); // header + 2
    await expect(table.getByText("Overdue since 2026-10-21 05:00 WAT")).toBeVisible();
    await expect(table.getByText("Met", { exact: true })).toBeVisible();
    await expect(table.getByRole("link", { name: "SC-AAAAA-AAAAB" })).toHaveAttribute("href", "/admin/leads/l1");
    await expect(table.getByText("Priya")).toBeVisible();
    await expect(table.getByText("Unassigned")).toBeVisible();
    await page.getByRole("button", { name: "Show more" }).click();
    await expect(table.getByRole("row")).toHaveCount(5);
    await expect(table.getByText("Erased")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
    await axe(page);
  });

  test("filters are in the address: applying one changes it, and opening it again keeps the filter", async ({ page }) => {
    await signIn(page);
    const seen: URL[] = [];
    await serve(page, rows, seen);
    await page.goto("/admin/leads");
    await page.getByLabel("Stage", { exact: true }).selectOption("choose_course");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/admin\/leads\?stage=choose_course$/);
    await expect(page.getByRole("link", { name: "SC-AAAAA-AAAAC" })).toBeVisible();
    await expect(page.getByRole("link", { name: "SC-AAAAA-AAAAB" })).toHaveCount(0);
    expect(seen.at(-1)?.searchParams.get("stage")).toBe("choose_course");

    // Search by name, then clear.
    await page.getByLabel("Search by name, WhatsApp number or reference").fill("  ngozi ");
    await page.getByLabel("Stage", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\?q=ngozi$/);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/admin\/leads$/);

    // The address alone restores the filter (a bookmark), and Back returns to the previous list.
    await page.goto("/admin/leads?stage=choose_course");
    await expect(page.getByLabel("Stage", { exact: true })).toHaveValue("choose_course");
    await expect(page.getByRole("link", { name: "SC-AAAAA-AAAAC" })).toBeVisible();
  });

  test("the Overdue and Unassigned tabs ask for their own view, and an empty Overdue view says so", async ({ page }) => {
    await signIn(page);
    const seen: URL[] = [];
    await serve(page, [], seen);
    await page.goto("/admin/leads");
    await page.getByRole("button", { name: "Overdue", exact: true }).click();
    await expect(page).toHaveURL(/\?view=overdue$/);
    await expect(page.getByText("Nothing is overdue.")).toBeVisible();
    expect(seen.at(-1)?.searchParams.get("view")).toBe("overdue");
    await page.getByRole("button", { name: "Unassigned", exact: true }).click();
    await expect(page).toHaveURL(/\?view=unassigned$/);
    expect(seen.at(-1)?.searchParams.get("view")).toBe("unassigned");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("No leads match.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Link requests" })).toHaveAttribute("href", "/admin/leads/link-requests");
  });

  test("shows an error with a retry, and a message for filters the server refuses", async ({ page }) => {
    await signIn(page);
    let calls = 0;
    await page.route(LIST_ANY, (route) => {
      calls += 1;
      if (calls === 1) return fail(route, 500, "INTERNAL");
      if (calls === 2) return json(route, { leads: [], nextBefore: null, stages: STAGES, universities, admins });
      return fail(route, 400, "VALIDATION");
    });
    await page.goto("/admin/leads");
    await expect(alerts(page)).toContainText("We could not load this page.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("No leads match.")).toBeVisible();
    await page.getByLabel("Search by name, WhatsApp number or reference").fill("x");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(alerts(page)).toHaveText("Check the filters.");
  });

  test("the Duplicates tab lists pairs and merges only when a person chooses", async ({ page }) => {
    await signIn(page);
    const pair = {
      a: { id: "d1", ref: "SC-DDDDD-DDDD1", name: "Dup One", receivedAt: "2026-10-21T08:00:00.000Z", stageCode: "share_results" },
      b: { id: "d2", ref: "SC-DDDDD-DDDD2", name: "Dup Two", receivedAt: "2026-10-21T09:00:00.000Z", stageCode: "choose_course" },
    };
    let pairs = [pair];
    let posted: unknown = null;
    await page.route("**/api/v1/admin/duplicates", (route) => json(route, { pairs, stages: STAGES }));
    await page.route(/\/api\/v1\/admin\/leads\.resolveDuplicate$/, (route) => {
      posted = route.request().postDataJSON();
      pairs = [];
      return json(route, { outcome: "merged" });
    });
    await page.goto("/admin/leads?view=duplicates");
    await expect(page.getByText("SC-DDDDD-DDDD1")).toBeVisible();
    expect(posted).toBeNull();
    await page.getByRole("button", { name: "Compare" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("These two leads have the same WhatsApp number.")).toBeVisible();
    await expect(dialog.getByText("Choose course")).toBeVisible();
    await dialog.getByRole("button", { name: "Merge into SC-DDDDD-DDDD2" }).click();
    expect(posted).toEqual({ keepId: "d2", otherId: "d1", decision: "merged" });
    await expect(page.getByText("No possible duplicates.")).toBeVisible();
  });
});

// ---- B3 ------------------------------------------------------------------------------------------------------------

test.describe("B3 Lead detail", () => {
  /** A fake server for one lead whose version moves forward on every accepted change. */
  async function lead(page: Page, data = detail()) {
    const state = { data, posts: [] as { op: string; body: Record<string, unknown> }[], version: VERSION_1, failNext: null as null | { status: number; code: string; fields?: Record<string, string> } };
    await page.route(ONE_LEAD, (route) => {
      const copy = JSON.parse(JSON.stringify(state.data)) as DetailData;
      copy.lead.version = state.version;
      return json(route, copy);
    });
    await page.route(LEAD_OPERATION, async (route) => {
      const op = new URL(route.request().url()).pathname.split("/").pop()?.replace("leads.", "") ?? "";
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.posts.push({ op, body });
      if (state.failNext) {
        const f = state.failNext;
        state.failNext = null;
        return fail(route, f.status, f.code, f.fields);
      }
      state.version = VERSION_2;
      const lead = state.data.lead as Record<string, unknown>;
      if (op === "changeStage") lead.stage = body.stage;
      if (op === "assign") lead.assigned = body.adminId === ME ? { id: ME, label: "Priya" } : body.adminId ? { id: String(body.adminId), label: "Kofi" } : null;
      if (op === "logReply") {
        lead.firstResponseAt = "2026-10-21T09:00:00.000Z";
        lead.sla = { status: "met", dueAt: "2026-10-22T10:00:00.000Z" };
        state.data.timeline.unshift({ id: `r${state.posts.length}`, type: "reply_logged", at: "2026-10-21T09:00:00.000Z", by: { id: ME, label: "Priya" }, data: { first: true } });
      }
      if (op === "addNote") state.data.timeline.unshift({ id: `n${state.posts.length}`, type: "note", at: "2026-10-21T09:01:00.000Z", by: { id: ME, label: "Priya" }, data: { note_id: "n" }, note: { body: String(body.body), erased: false } });
      if (op === "eraseLead") {
        lead.erased = true;
        lead.name = null;
        lead.whatsapp = null;
        lead.email = null;
        lead.results = [];
      }
      return json(route, op === "addNote" ? { id: "n" } : op === "logReply" ? { first: true, version: VERSION_2 } : { changed: true, version: VERSION_2 });
    });
    return state;
  }

  test("shows the profile, results, programmes and timeline, and passes axe", async ({ page }) => {
    await signIn(page);
    await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ama Mensah" })).toBeVisible();
    await expect(page.getByText("SC-ABCDE-FGHJK").first()).toBeVisible();
    await expect(page.getByText("+233201111111")).toBeVisible();
    await expect(page.getByText("Maths: A")).toBeVisible();
    await expect(page.getByText("B.Tech Computer Science")).toBeVisible();
    await expect(page.getByText("Lead created")).toBeVisible();
    await expect(page.getByText("Not assigned")).toBeVisible();
    await axe(page);
  });

  test("one tap on Log reply turns the SLA badge to Met", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await expect(page.getByText(/^Due /)).toBeVisible();
    await page.getByRole("button", { name: "Log reply" }).click();
    await expect(page.getByText("Met", { exact: true })).toBeVisible();
    await expect(page.getByText("First reply logged by Priya")).toBeVisible();
    expect(state.posts.map((p) => p.op)).toEqual(["logReply"]);
    expect(state.posts[0]?.body).toEqual({ leadId: LEAD_ID });
  });

  test("changing the stage asks first, sends the version it read, and shows the new stage", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("combobox", { name: "Change stage" }).selectOption("choose_course");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Move to Choose course?")).toBeVisible();
    expect(state.posts).toHaveLength(0); // nothing is sent until the person confirms
    await dialog.getByRole("button", { name: "Move" }).click();
    await expect(page.getByRole("combobox", { name: "Change stage" })).toHaveValue("choose_course");
    expect(state.posts[0]).toEqual({ op: "changeStage", body: { leadId: LEAD_ID, stage: "choose_course", version: VERSION_1 } });
  });

  test("cancelling the stage change sends nothing", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("combobox", { name: "Change stage" }).selectOption("offer_letter");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    expect(state.posts).toHaveLength(0);
  });

  test("when someone else changed the lead the screen says so and a Reload shows their version", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    state.failNext = { status: 409, code: "CONFLICT", fields: { version: "STALE" } };
    await page.getByRole("combobox", { name: "Change stage" }).selectOption("choose_course");
    await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
    await expect(alerts(page).first()).toContainText("This lead changed. Reload.");
    // Their change arrives with the reload.
    (state.data.lead as Record<string, unknown>).stage = "offer_letter";
    state.version = VERSION_2;
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByRole("combobox", { name: "Change stage" })).toHaveValue("offer_letter");
    await expect(alerts(page)).toHaveCount(0);
  });

  test("assigns to me, to another admin, and back to nobody", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByText("Assigned to Priya")).toBeVisible();
    expect(state.posts[0]).toEqual({ op: "assign", body: { leadId: LEAD_ID, adminId: ME, version: VERSION_1 } });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Assign to me" })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Kofi" }).click();
    await expect(page.getByText("Assigned to Kofi")).toBeVisible();
  });

  test("a note is added to the timeline and the box is cleared; a blank note cannot be sent", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    const add = page.getByRole("button", { name: "Add note" });
    await expect(add).toBeDisabled();
    await page.getByLabel("Add a note").fill("   ");
    await expect(add).toBeDisabled();
    await page.getByLabel("Add a note").fill("Called her mother");
    await add.click();
    await expect(page.getByText("Called her mother")).toBeVisible();
    await expect(page.getByLabel("Add a note")).toHaveValue("");
    expect(state.posts[0]).toEqual({ op: "addNote", body: { leadId: LEAD_ID, body: "Called her mother" } });
  });

  test("the WhatsApp drawer opens the student's chat with the editable stage message, logs it, and then asks 'Did you send it?'", async ({ page, context }) => {
    await signIn(page);
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>whatsapp</body></html>" }));
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("button", { name: "Message on WhatsApp" }).click();
    const dialog = page.getByRole("dialog");
    const box = dialog.getByLabel("Message");
    await expect(box).toHaveValue(/Hello Ama, this is Scollarly\. Thank you for your request SC-ABCDE-FGHJK\./);
    await box.fill("Hello Ama, can you send your results?");
    const popup = context.waitForEvent("page");
    await dialog.getByRole("link", { name: "Open WhatsApp" }).click();
    const wa = await popup;
    expect(wa.url()).toBe("https://wa.me/233201111111?text=Hello%20Ama%2C%20can%20you%20send%20your%20results%3F");
    await expect.poll(() => state.posts.map((p) => p.op)).toContain("logAdminWhatsAppOpen");

    // Coming back to the page asks the question; "Log reply" there is one tap.
    await expect(page.getByText("Did you send it?")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Did you send it?")).toBeVisible();
    await page.getByRole("status").getByRole("button", { name: "Log reply" }).click();
    await expect(page.getByText("Did you send it?")).toHaveCount(0);
    await expect.poll(() => state.posts.map((p) => p.op)).toContain("logReply");
  });

  test("a staff-written template for the stage replaces the built-in text", async ({ page }) => {
    await signIn(page);
    await lead(page, detail({ template: "Dear {name}, your file {ref} is ready for {university}." }));
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("button", { name: "Message on WhatsApp" }).click();
    await expect(page.getByRole("dialog").getByLabel("Message")).toHaveValue("Dear Ama, your file SC-ABCDE-FGHJK is ready for Alpha University.");
  });

  test("a lead with no number cannot be messaged", async ({ page }) => {
    await signIn(page);
    await lead(page, detail({}, { whatsapp: null }));
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await expect(page.getByRole("button", { name: "Message on WhatsApp" })).toBeDisabled();
  });

  test("a possible duplicate shows a banner that opens the comparison; nothing is merged until chosen", async ({ page }) => {
    await signIn(page);
    const pair = {
      a: { id: LEAD_ID, ref: "SC-ABCDE-FGHJK", name: "Ama Mensah", receivedAt: "2026-10-21T08:00:00.000Z", stageCode: "share_results" },
      b: { id: OTHER_ID, ref: "SC-ZZZZZ-ZZZZ1", name: "Ama M.", receivedAt: "2026-10-21T10:00:00.000Z", stageCode: "share_results" },
    };
    await lead(page, detail({ duplicates: [pair] }));
    let posted: unknown = null;
    await page.route(/\/api\/v1\/admin\/leads\.resolveDuplicate$/, (route) => {
      posted = route.request().postDataJSON();
      return json(route, { outcome: "dismissed" });
    });
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("button", { name: "Possible duplicate: SC-ZZZZZ-ZZZZ1" }).click();
    expect(posted).toBeNull();
    await page.getByRole("dialog").getByRole("button", { name: "Not a duplicate" }).click();
    expect(posted).toEqual({ keepId: LEAD_ID, otherId: OTHER_ID, decision: "not_duplicate" });
  });

  test("erasing needs the identity box ticked, then shows the erased lead with its history", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.getByRole("button", { name: "Erase personal data" }).click();
    const dialog = page.getByRole("dialog");
    const erase = dialog.getByRole("button", { name: "Erase" });
    await expect(erase).toBeDisabled();
    await dialog.getByLabel("I confirmed the student's identity").check();
    await erase.click();
    await expect(page.getByText("This lead's personal data was erased. Its history and counts remain.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Erased" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log reply" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
    expect(state.posts[0]).toEqual({ op: "eraseLead", body: { leadId: LEAD_ID, identityConfirmed: true } });
  });

  test("a merged lead points to the one it was merged into and cannot be edited", async ({ page }) => {
    await signIn(page);
    await lead(page, detail({}, { mergedInto: { id: OTHER_ID, ref: "SC-ZZZZZ-ZZZZ1" } }));
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await expect(page.getByText("This lead was merged into SC-ZZZZZ-ZZZZ1.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open it" })).toHaveAttribute("href", `/admin/leads/${OTHER_ID}`);
    await expect(page.getByRole("button", { name: "Log reply" })).toHaveCount(0);
  });

  test("an unknown lead says so instead of showing a blank page", async ({ page }) => {
    await signIn(page);
    await page.route(ONE_LEAD, (route) => fail(route, 404, "NOT_FOUND"));
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await expect(alerts(page)).toHaveText("That lead does not exist.");
  });

  test("a change that cannot reach the server says so and keeps the page as it was", async ({ page }) => {
    await signIn(page);
    const state = await lead(page);
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await page.route(/\/api\/v1\/admin\/leads\.logReply$/, (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Log reply" }).click();
    await expect(alerts(page).first()).toContainText("You are offline. Try again when you are back online.");
    expect(state.posts).toHaveLength(0);
    await expect(page.getByRole("heading", { level: 1, name: "Ama Mensah" })).toBeVisible();
  });
});

// ---- B4 ------------------------------------------------------------------------------------------------------------

test.describe("B4 Link requests", () => {
  const claim = (over: Record<string, unknown> = {}) => ({
    claimId: "c1",
    method: "ref",
    createdAt: "2026-10-21T08:00:00.000Z",
    userName: "Claim Er",
    userEmail: "claimer@example.test",
    emailVerified: true,
    leadId: LEAD_ID,
    leadRef: "SC-ABCDE-FGHJK",
    leadName: "Ama Mensah",
    leadCountry: "GH",
    emailMatches: false,
    linkedToOther: false,
    ...over,
  });

  test("approving needs a verification method, which the screen insists on before it sends anything", async ({ page }) => {
    await signIn(page);
    let claims = [claim()];
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/v1/admin/link-requests", (route) => json(route, { claims }));
    await page.route("**/api/v1/admin/leads.decideClaim", (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      claims = [];
      return json(route, { outcome: "approved", leadId: LEAD_ID });
    });
    await page.goto("/admin/leads/link-requests");
    await expect(page.getByText("Claim Er")).toBeVisible();
    await expect(page.getByText("claimer@example.test")).toBeVisible();
    await expect(page.getByRole("link", { name: "SC-ABCDE-FGHJK" })).toHaveAttribute("href", `/admin/leads/${LEAD_ID}`);
    await axe(page);
    await page.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog");
    const approve = dialog.getByRole("button", { name: "Approve" });
    await expect(approve).toBeDisabled();
    await dialog.getByLabel("Student replied on WhatsApp from the number on file").check();
    await approve.click();
    await expect(page.getByText("No link requests are waiting.")).toBeVisible();
    expect(posted).toEqual({ claimId: "c1", decision: "approve", verificationMethod: "whatsapp_confirmed" });
  });

  test("a matching email preselects 'Email matches the lead', and a mismatch the server finds is shown", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/link-requests", (route) => json(route, { claims: [claim({ emailMatches: true })] }));
    await page.route("**/api/v1/admin/leads.decideClaim", (route) => fail(route, 409, "CONFLICT", { verificationMethod: "EMAIL_MISMATCH" }));
    await page.goto("/admin/leads/link-requests");
    await expect(page.getByText("The account's verified email matches the lead's email.")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Email matches the lead")).toBeChecked();
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(dialog.getByRole("alert")).toContainText("does not match");
  });

  test("a lead that belongs to another account cannot be approved, and rejecting needs a reason", async ({ page }) => {
    await signIn(page);
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/v1/admin/link-requests", (route) => json(route, { claims: [claim({ linkedToOther: true })] }));
    await page.route("**/api/v1/admin/leads.decideClaim", (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return json(route, { outcome: "rejected", leadId: LEAD_ID });
    });
    await page.goto("/admin/leads/link-requests");
    await expect(page.getByText("This lead already belongs to another account.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
    await page.getByRole("button", { name: "Reject" }).click();
    const dialog = page.getByRole("dialog");
    const reject = dialog.getByRole("button", { name: "Reject" });
    await expect(reject).toBeDisabled();
    await dialog.getByLabel(/^Reason/).fill("  Numbers do not match ");
    await reject.click();
    await expect.poll(() => posted).toEqual({ claimId: "c1", decision: "reject", reason: "Numbers do not match" });
  });
});

// ---- B5 ------------------------------------------------------------------------------------------------------------

test.describe("B5 Data requests", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    kind: "erasure",
    channel: "whatsapp",
    status: "open",
    createdAt: "2026-10-21T08:00:00.000Z",
    completedAt: null,
    handledBy: null,
    lead: { id: LEAD_ID, ref: "SC-ABCDE-FGHJK", erased: false },
    accountLeads: [],
    ...over,
  });

  test("lists open requests, runs an erasure only after the identity box, and the request closes with it", async ({ page }) => {
    await signIn(page);
    let requests = [request()];
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/v1/admin/data-requests*", (route) => json(route, { requests }));
    await page.route("**/api/v1/admin/leads.eraseLead", (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      requests = [];
      return json(route, { erased: true });
    });
    await page.goto("/admin/data-requests");
    await expect(page.getByText("Erasure", { exact: true })).toBeVisible();
    await expect(page.getByText("WhatsApp", { exact: true })).toBeVisible();
    await axe(page);
    await page.getByRole("button", { name: "Run erasure for SC-ABCDE-FGHJK" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Erase" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("I confirmed the student's identity").check();
    await confirm.click();
    await expect(page.getByText("No requests.")).toBeVisible();
    expect(posted).toEqual({ leadId: LEAD_ID, identityConfirmed: true, dataRequestId: "r1" });
  });

  test("an export request is marked done by hand", async ({ page }) => {
    await signIn(page);
    let requests = [request({ id: "r2", kind: "export" })];
    await page.route("**/api/v1/admin/data-requests*", (route) => json(route, { requests }));
    await page.route("**/api/v1/admin/dataRequests.complete", (route) => {
      requests = [];
      return json(route, { done: true });
    });
    await page.goto("/admin/data-requests");
    await page.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByText("No requests.")).toBeVisible();
  });

  test("logging a request checks the reference's shape, then sends it and refreshes the list", async ({ page }) => {
    await signIn(page);
    let requests: ReturnType<typeof request>[] = [];
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/v1/admin/data-requests*", (route) => json(route, { requests }));
    await page.route("**/api/v1/admin/dataRequests.log", (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      requests = [request({ id: "r3", kind: "export" })];
      return json(route, { id: "r3" }, 201);
    });
    await page.goto("/admin/data-requests");
    await page.getByRole("button", { name: "Log request" }).click();
    const dialog = page.getByRole("dialog");
    const submit = dialog.getByRole("button", { name: "Log request" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Request type").selectOption("export");
    await dialog.getByLabel("Lead reference (SC-XXXXX-XXXXX)").fill("not a ref");
    await expect(dialog.getByText("A reference looks like SC-XXXXX-XXXXX.")).toBeVisible();
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Lead reference (SC-XXXXX-XXXXX)").fill("sc-abcde-fghjk");
    await submit.click();
    await expect(page.getByText("Data export")).toBeVisible();
    expect(posted).toEqual({ kind: "export", channel: "whatsapp", leadRef: "SC-ABCDE-FGHJK" });
  });

  test("an unknown reference is explained, and the open and all views ask for what they show", async ({ page }) => {
    await signIn(page);
    const seen: string[] = [];
    await page.route("**/api/v1/admin/data-requests*", (route) => {
      seen.push(new URL(route.request().url()).searchParams.get("status") ?? "");
      return json(route, { requests: [] });
    });
    await page.route("**/api/v1/admin/dataRequests.log", (route) => fail(route, 404, "NOT_FOUND", { leadRef: "NOT_FOUND" }));
    await page.goto("/admin/data-requests");
    await page.getByLabel("Show").selectOption("all");
    await expect.poll(() => seen).toEqual(["open", "all"]);
    await page.getByRole("button", { name: "Log request" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Lead reference (SC-XXXXX-XXXXX)").fill("SC-AAAAA-AAAAA");
    await dialog.getByRole("button", { name: "Log request" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("No lead has that reference.");
  });

  test("a failed refresh shows a retry instead of an empty list", async ({ page }) => {
    await signIn(page);
    await page.route("**/api/v1/admin/data-requests*", (route) => fail(route, 500, "INTERNAL"));
    await page.goto("/admin/data-requests");
    await expect(alerts(page)).toContainText("We could not load this page.");
  });
});

// ---- the menu ---------------------------------------------------------------------------------------------------------

test.describe("the menu", () => {
  test("keeps Leads lit on a lead's page and on the link requests page", async ({ page }) => {
    await signIn(page);
    await page.route(ONE_LEAD, (route) => json(route, detail()));
    await page.route("**/api/v1/admin/link-requests", (route) => json(route, { claims: [] }));
    const menu = page.getByRole("navigation", { name: "Admin menu" });
    await page.goto(`/admin/leads/${LEAD_ID}`);
    await expect(menu.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current", "page");
    await page.goto("/admin/leads/link-requests");
    await expect(menu.getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page");
  });
});
