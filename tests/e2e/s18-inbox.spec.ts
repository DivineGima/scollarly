import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S18.1 (architecture 24.9, 24.10): the Inbox and the student screen in a real browser at phone width. The data calls are stubbed (their answers
 * are proven against a real database in tests/integration/s18-1-inbox.test.ts); here we check what each role is shown, what the screen sends,
 * the refetch after the 120-second timer sees the count rise, and axe.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const fail = (route: Route, status: number, code: string, fields: Record<string, string> = {}) => json(route, { error: { code, message: code, fields }, request_id: "r" }, status);

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

type Role = "manager" | "admin";

async function signIn(page: Page, role: Role, unread: () => number = () => 0) {
  await page.route("**/api/v1/admin/session", (route) => json(route, { role, name: "Priya Rao", email: `${role}@example.test`, stepUpFresh: false, toursSeen: ["home", "leads", "content", "insights"], userId: `${role}-1` }));
  await page.route("**/api/v1/admin/notifications*", (route) => json(route, { unread: unread(), items: [] }));
}

const COUNTS = { new: 2, to_review: 1, overdue: 0, letter_ready: 0, payment_proof: 0, quiet: 1, unassigned: 0 };
const ROW = (id: string, over: Record<string, unknown> = {}) => ({ id, ref: "SC-ABCDE-FGHJK", name: "Ada Eze", stageCode: "documents", at: "2026-11-07T08:00:00.000Z", waiting: null, idleDays: null, ...over });
const A = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const B = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

async function stubInbox(page: Page, answer: (section: string) => Record<string, unknown>) {
  const asked: string[] = [];
  await page.route("**/api/v1/admin/inbox*", (route) => {
    const section = new URL(route.request().url()).searchParams.get("section") ?? "new";
    asked.push(section);
    return json(route, { section, counts: COUNTS, rows: [], more: false, ...answer(section) });
  });
  return asked;
}

test.describe("the Inbox", () => {
  test("is what Leads opens, with the day's summary, a count on each section and the files, and passes axe at 360 px", async ({ page }) => {
    await signIn(page, "manager");
    await stubInbox(page, () => ({ rows: [ROW(A), ROW(B, { name: null, ref: "SC-ZZZZZ-YYYYY" })] }));
    await page.goto("/admin/leads");
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
    await expect(page.getByTestId("inbox-summary")).toHaveText("4 students need your action.");
    await expect(page.getByTestId("inbox-tab-new")).toContainText("2");
    await expect(page.getByTestId("inbox-tab-new")).toHaveAttribute("aria-current", "true");
    const rows = page.getByTestId("inbox-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first().getByRole("link", { name: "Ada Eze" })).toHaveAttribute("href", `/admin/leads/${A}`);
    await expect(rows.nth(1)).toContainText("No name");
    await expect(rows.first()).toContainText("Documents");
    await axe(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("shows a manager six sections and the Admin the seventh, Unassigned", async ({ page }) => {
    await signIn(page, "manager");
    await stubInbox(page, () => ({}));
    await page.goto("/admin/leads");
    await expect(page.getByTestId("inbox-tab-quiet")).toBeVisible();
    await expect(page.getByTestId("inbox-tab-unassigned")).toHaveCount(0);

    const other = await page.context().newPage();
    await signIn(other, "admin");
    await stubInbox(other, () => ({}));
    await other.goto("/admin/leads");
    await expect(other.getByTestId("inbox-tab-unassigned")).toBeVisible();
  });

  test("opens a section on a tap, asks only for that section, keeps it in the address, and says so when it is empty", async ({ page }) => {
    await signIn(page, "manager");
    const asked = await stubInbox(page, (section) => (section === "to_review" ? { rows: [ROW(A, { waiting: 2 })] } : {}));
    await page.goto("/admin/leads");
    await page.getByTestId("inbox-tab-to_review").click();
    await expect(page.getByTestId("inbox-row")).toHaveCount(1);
    await expect(page.getByTestId("inbox-row")).toContainText("2 documents waiting");
    expect(page).toHaveURL(/section=to_review/);
    await page.getByTestId("inbox-tab-overdue").click();
    await expect(page.getByTestId("inbox-empty")).toBeVisible();
    expect(asked).toEqual(["new", "to_review", "overdue"]);

    // A bookmarked section opens on reload.
    await page.goto("/admin/leads?section=quiet");
    await expect(page.getByTestId("inbox-tab-quiet")).toHaveAttribute("aria-current", "true");
  });

  test("offers an Admin to close a file that has been quiet for 45 days, and never offers a manager", async ({ page }) => {
    await signIn(page, "admin");
    await stubInbox(page, () => ({ rows: [ROW(A, { idleDays: 50 }), ROW(B, { idleDays: 20, ref: "SC-ZZZZZ-YYYYY" })] }));
    await page.goto("/admin/leads?section=quiet");
    await expect(page.getByText("No action for 50 days")).toBeVisible();
    await expect(page.getByText("Consider closing this file")).toHaveCount(1);

    const manager = await page.context().newPage();
    await signIn(manager, "manager");
    await stubInbox(manager, () => ({ rows: [ROW(A, { idleDays: 50 })] }));
    await manager.goto("/admin/leads?section=quiet");
    await expect(manager.getByText("No action for 50 days")).toBeVisible();
    await expect(manager.getByText("Consider closing this file")).toHaveCount(0);
  });

  test("keeps the list on screen and tells the person when a refresh fails", async ({ page }) => {
    await signIn(page, "manager");
    let calls = 0;
    await page.route("**/api/v1/admin/inbox*", (route) => {
      calls += 1;
      return calls === 1 ? json(route, { section: "new", counts: COUNTS, rows: [ROW(A)], more: false }) : fail(route, 500, "INTERNAL");
    });
    await page.goto("/admin/leads");
    await expect(page.getByTestId("inbox-row")).toHaveCount(1);
    await page.evaluate(() => window.dispatchEvent(new Event("scollarly:inbox-refresh")));
    await expect(page.getByRole("alert").filter({ hasText: /went wrong|try again/i }).first()).toBeVisible();
    await expect(page.getByTestId("inbox-row")).toHaveCount(1);
  });

  test("fetches itself again, without a reload, when the 120-second check sees the count rise", async ({ page }) => {
    await page.clock.install();
    let unread = 0;
    await signIn(page, "manager", () => unread);
    let version = 0;
    await page.route("**/api/v1/admin/inbox*", (route) => json(route, { section: "new", counts: { ...COUNTS, new: version === 0 ? 1 : 2 }, rows: version === 0 ? [ROW(A)] : [ROW(A), ROW(B, { ref: "SC-ZZZZZ-YYYYY", name: "Kofi Mensah" })], more: false }));
    await page.goto("/admin/leads");
    await expect(page.getByTestId("inbox-row")).toHaveCount(1);
    await expect(page.getByTestId("tab-badge-leads")).toHaveCount(0);

    unread = 1;
    version = 1;
    await page.clock.fastForward(121_000);
    await expect(page.getByTestId("inbox-row")).toHaveCount(2);
    await expect(page.getByTestId("tab-badge-leads")).toContainText("1");
    await expect(page.getByRole("link", { name: /Kofi Mensah/ })).toBeVisible();
  });
});

// ---- the student screen ------------------------------------------------------------------------------------------------------------------

const STAGES = ["course_interest", "documents", "university_review", "offer_letter", "registration", "visa", "arrived"].map((code, position) => ({ code, name: { en: code } }));
const VERSION = "2026-11-07T10:00:00.000001Z";

const doc = (kind: string, state: string, over: Record<string, unknown> = {}) => ({ id: `d-${kind}`, kind, state, contentType: "application/pdf", byteSize: 100, rejectionNote: null, createdAt: "2026-11-07T07:00:00.000Z", reviewedAt: null, ...over });

const lead = (over: Record<string, unknown> = {}, documents: unknown[] = []) => ({
  lead: {
    id: A, ref: "SC-ABCDE-FGHJK", name: "Ada Eze", whatsapp: "+2348031234567", email: "ada@example.test", country: "NG", intakeKind: "full", qualificationType: "olevel_alevel", results: [], locale: "en",
    stage: "documents", assigned: null, linkedAccount: true, studentId: "stu-1", status: "open", closedReason: null, clock: { state: "none" }, quiet: "active",
    receivedAt: "2026-11-01T08:00:00.000Z", sla: { status: "ok", dueAt: "2026-11-02T08:00:00.000Z" }, slaHours: 4, firstResponseAt: null, erased: false, mergedInto: null,
    source: { page: null, university: null, contactName: null }, version: VERSION, ...over,
  },
  prefs: [], timeline: [], pendingClaims: 0, duplicates: [], stages: STAGES, admins: [], template: null, documents, you: "manager-1",
});

async function stubLead(page: Page, body: unknown) {
  await page.route("**/api/v1/admin/lead?*", (route) => json(route, body));
}

test.describe("the student screen", () => {
  test("gives a manager one Next step button, held until the four required documents are approved", async ({ page }) => {
    await signIn(page, "manager");
    await stubLead(page, lead({}, [doc("results", "approved"), doc("id", "approved"), doc("birth_certificate", "uploaded")]));
    await page.goto(`/admin/leads/${A}`);
    const button = page.getByTestId("next-step-button");
    await expect(button).toBeDisabled();
    await expect(page.getByTestId("next-step")).toContainText("2 of 4 required documents are approved");
    await expect(page.getByLabel("Move back")).toHaveCount(0);
    await expect(page.getByTestId("letter-upload")).toHaveCount(0);
    await expect(page.getByTestId("close-button")).toHaveCount(0);
    await axe(page);
  });

  test("moves the file one step with the version it read, then reads again", async ({ page }) => {
    await signIn(page, "manager");
    const approved = ["results", "id", "birth_certificate", "signature"].map((k) => doc(k, "approved"));
    await stubLead(page, lead({}, approved));
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/v1/admin/leads.changeStage", (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      return json(route, { changed: true, version: "v2", from: "documents" });
    });
    await page.goto(`/admin/leads/${A}`);
    await expect(page.getByTestId("next-step-button")).toHaveText("Move to university_review");
    await page.getByTestId("next-step-button").click();
    await expect.poll(() => sent).toEqual({ leadId: A, stage: "university_review", version: VERSION });
  });

  test("says why when the server refuses the move for missing documents (for example a passport), and keeps the screen", async ({ page }) => {
    await signIn(page, "manager");
    await stubLead(page, lead({}, ["results", "id", "birth_certificate", "signature"].map((k) => doc(k, "approved"))));
    await page.route("**/api/v1/admin/leads.changeStage", (route) => fail(route, 400, "VALIDATION", { stage: "DOCUMENTS_MISSING" }));
    await page.goto(`/admin/leads/${A}`);
    await page.getByTestId("next-step-button").click();
    await expect(page.getByTestId("file-error")).toContainText("The four required documents must be approved first.");
    await expect(page.getByTestId("next-step-button")).toBeEnabled();
  });

  test("approves a document, and asks for a clearer copy only with a reason the student will see", async ({ page }) => {
    await signIn(page, "manager");
    await stubLead(page, lead({}, [doc("results", "uploaded"), doc("id", "uploaded")]));
    const reviews: Record<string, unknown>[] = [];
    await page.route("**/api/v1/admin/documents.review", (route) => {
      reviews.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { id: "x", state: "approved" });
    });
    await page.goto(`/admin/leads/${A}`);
    await page.getByTestId("doc-results").getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => reviews.length).toBe(1);
    expect(reviews[0]).toEqual({ id: "d-results", decision: "approved" });

    await page.getByTestId("doc-id").getByRole("button", { name: "Ask for a clearer copy" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled(); // no reason yet
    await page.getByLabel("What should the student fix?").fill("The photo is too dark");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => reviews.length).toBe(2);
    expect(reviews[1]).toEqual({ id: "d-id", decision: "rejected", note: "The photo is too dark" });
  });

  test("leaves the proof of payment to the Admin, and gives the Admin the letter upload, back one step and close", async ({ page }) => {
    await signIn(page, "manager");
    await stubLead(page, lead({ stage: "registration" }, [doc("payment_proof", "uploaded", { contentType: "image/png" })]));
    await page.goto(`/admin/leads/${A}`);
    await expect(page.getByTestId("doc-payment_proof")).toContainText("Only the Admin approves a proof of payment.");
    await expect(page.getByRole("button", { name: "Approve proof of payment" })).toHaveCount(0);

    const admin = await page.context().newPage();
    await signIn(admin, "admin");
    await stubLead(admin, lead({ stage: "registration" }, [doc("payment_proof", "uploaded", { contentType: "image/png" })]));
    let approved: Record<string, unknown> | null = null;
    await admin.route("**/api/v1/admin/payments.proofApprove", (route) => {
      approved = route.request().postDataJSON() as Record<string, unknown>;
      return json(route, { id: "d-payment_proof", state: "approved" });
    });
    await admin.goto(`/admin/leads/${A}`);
    await admin.getByRole("button", { name: "Approve proof of payment" }).click();
    await expect.poll(() => approved).toEqual({ id: "d-payment_proof" });
    await expect(admin.getByTestId("letter-upload")).toBeVisible();
    await expect(admin.getByTestId("back-button")).toBeDisabled(); // a reason is required
    await expect(admin.getByTestId("close-button")).toBeVisible();
  });

  test("uploads a letter for the student the Admin has open, and shows what went wrong without losing the screen", async ({ page }) => {
    await signIn(page, "admin");
    await stubLead(page, lead({ stage: "offer_letter" }));
    const signed: Record<string, unknown>[] = [];
    await page.route("**/api/v1/admin/documents.sign", (route) => {
      signed.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { id: "l1", url: "https://br-shiny-resonance-b9kn9vx1.storage.c-7.eu-central-1.aws.neon.tech/student-docs/stu-1/l1?sig=1", headers: { "content-type": "application/pdf" }, expiresInSeconds: 180 }, 201);
    });
    await page.route("https://br-shiny-resonance-b9kn9vx1.storage.c-7.eu-central-1.aws.neon.tech/**", (route) => route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "" }));
    await page.route("**/api/v1/admin/documents.confirm", (route) => json(route, { id: "l1", state: "uploaded" }));
    await page.goto(`/admin/leads/${A}`);
    await page.getByLabel("Which letter").selectOption("acceptance_letter");
    await page.getByTestId("letter-input").setInputFiles({ name: "offer.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
    await expect.poll(() => signed.length).toBe(1);
    expect(signed[0]).toMatchObject({ studentId: "stu-1", kind: "acceptance_letter", contentType: "application/pdf" });

    await page.getByTestId("letter-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    await expect(page.getByTestId("file-error")).toContainText("Only a PDF");
  });

  test("closes a file with a reason and reopens it, only for the Admin", async ({ page }) => {
    await signIn(page, "admin");
    await stubLead(page, lead({ quiet: "suggest_close" }));
    const sent: Record<string, unknown>[] = [];
    await page.route("**/api/v1/admin/leads.close", (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(route, { changed: true, version: "v2" });
    });
    await page.goto(`/admin/leads/${A}`);
    await expect(page.getByTestId("file-quiet")).toContainText("consider closing");
    await page.getByLabel("Reason for closing").selectOption("withdrew");
    await page.getByTestId("close-button").click();
    await expect.poll(() => sent).toEqual([{ leadId: A, version: VERSION, reason: "withdrew" }]);

    const closed = await page.context().newPage();
    await signIn(closed, "admin");
    await stubLead(closed, lead({ status: "closed", closedReason: "withdrew" }));
    await closed.goto(`/admin/leads/${A}`);
    await expect(closed.getByTestId("file-status")).toHaveText("Closed");
    await expect(closed.getByTestId("next-step")).toHaveCount(0);
    await expect(closed.getByTestId("reopen-button")).toBeVisible();
  });

  test("shows the overdue clock of the university, and a lead with no student account has no documents to show", async ({ page }) => {
    await signIn(page, "manager");
    await stubLead(page, lead({ stage: "university_review", clock: { state: "overdue", dueAt: "2026-11-05T08:00:00.000Z" } }));
    await page.goto(`/admin/leads/${A}`);
    await expect(page.getByTestId("file-clock")).toContainText("overdue");

    const none = await page.context().newPage();
    await signIn(none, "manager");
    await stubLead(none, lead({ studentId: null, linkedAccount: false }));
    await none.goto(`/admin/leads/${A}`);
    await expect(none.getByTestId("student-file")).toHaveCount(0);
  });
});
