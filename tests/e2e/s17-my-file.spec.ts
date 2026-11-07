import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * S17.1 to S17.3 (PRD_5 FR-43 to FR-46; architecture 24.5 to 24.7): "My file" in a real browser at phone width. The data calls and the storage
 * are stubbed (their answers are proven against a real database in tests/integration/s17-*.test.ts); here we check the prefilled form, the passport
 * field that appears only when the university asks, an upload that fails and is tried again alone, a letter the student downloads, and axe.
 */

test.use({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

const FORM = (over: Record<string, unknown> = {}) => ({
  fixed: { name: "Ada Eze", whatsapp: "+2348031234567", email: "ada@example.test", courseFields: ["law"], academicYear: 2027 },
  values: { dateOfBirth: "", gender: "", nationality: "NG", residenceState: "", city: "", address: "", guardianName: "", guardianPhone: "", motherName: "", motherPhone: "", passportNumber: "" },
  completed: false,
  application: { id: "lead-1", ref: "SC-ABCDE-FGHJK", stageCode: "documents", status: "open" },
  passportRequired: false,
  editable: true,
  ...over,
});

const doc = (kind: string, state: string, over: Record<string, unknown> = {}) => ({ id: `doc-${kind}`, kind, state, contentType: "image/png", byteSize: 100, rejectionNote: null, createdAt: "2026-11-07T10:00:00.000Z", reviewedAt: null, ...over });

async function stub(page: Page, form = FORM(), documents: unknown[] = []) {
  await page.route("**/api/v1/me/application-form", (route) => json(route, form));
  await page.route("**/api/v1/me/documents", (route) => json(route, { documents }));
}

const PNG = { name: "id.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) };

test("opens prefilled with what the student gave at sign-up, and the whole screen passes axe at 360 px", async ({ page }) => {
  await stub(page);
  await page.goto("/me/file");
  await expect(page.getByRole("heading", { name: "My file" })).toBeVisible();
  const form = page.getByTestId("file-form");
  await expect(form).toContainText("Ada Eze");
  await expect(form).toContainText("+2348031234567");
  await expect(form).toContainText("ada@example.test");
  await expect(form.getByLabel("Nationality")).toHaveValue("NG");
  await expect(form.getByLabel("City")).toHaveValue("");
  await expect(form.getByLabel("Passport number")).toHaveCount(0); // the university does not ask
  await axe(page);
  // Nothing needs a sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("asks for the passport number only when the university's switch is on", async ({ page }) => {
  await stub(page, FORM({ passportRequired: true }));
  await page.goto("/me/file");
  await expect(page.getByLabel("Passport number")).toBeVisible();
  await expect(page.getByTestId("doc-passport")).toBeVisible();
});

test("says which fields are missing instead of sending, then saves a complete form", async ({ page }) => {
  await stub(page);
  let sent: Record<string, string> | null = null;
  await page.route("**/api/v1/me/applicationForm.save", (route) => {
    sent = route.request().postDataJSON() as Record<string, string>;
    return json(route, { saved: true });
  });
  await page.goto("/me/file");
  await page.getByTestId("file-form-save").click();
  await expect(page.getByTestId("file-form-status")).toContainText("Please check the fields");
  await expect(page.getByLabel("City")).toHaveAttribute("aria-invalid", "true");
  expect(sent).toBeNull();

  const fill: [string, string][] = [["Date of birth", "2005-03-14"], ["State or region where you live", "Lagos"], ["City", "Ikeja"], ["Home address", "12 Allen Avenue"], ["Father or guardian: full name", "Chidi Eze"], ["Father or guardian: phone", "+2348031111111"], ["Mother: full name", "Ngozi Eze"], ["Mother: phone", "+2348032222222"]];
  for (const [label, value] of fill) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Gender").selectOption("female");
  await page.getByTestId("file-form-save").click();
  await expect(page.getByTestId("file-form-status")).toContainText("Saved");
  expect(sent).toMatchObject({ city: "Ikeja", gender: "female", nationality: "NG", guardianPhone: "+2348031111111" });
  expect(sent).not.toHaveProperty("passportNumber");
});

test("shows the server's field error under the field and keeps what was typed", async ({ page }) => {
  await stub(page, FORM({ values: { ...FORM().values, dateOfBirth: "2005-03-14", gender: "female", residenceState: "Lagos", city: "Ikeja", address: "x", guardianName: "A", guardianPhone: "12", motherName: "B", motherPhone: "+2348032222222" } }));
  await page.route("**/api/v1/me/applicationForm.save", (route) => json(route, { error: { code: "VALIDATION", message: "Check", fields: { guardianPhone: "PHONE_INVALID" } }, request_id: "r" }, 400));
  await page.goto("/me/file");
  await page.getByTestId("file-form-save").click();
  await expect(page.getByText("This phone number does not look right")).toBeVisible();
  await expect(page.getByLabel("Father or guardian: phone")).toHaveValue("12");
});

test("is read-only before the student applies and after the application is closed", async ({ page }) => {
  await stub(page, FORM({ application: null, editable: false }));
  await page.goto("/me/file");
  await expect(page.getByTestId("file-not-applied")).toBeVisible();
  await expect(page.getByRole("link", { name: "Apply now" })).toHaveAttribute("href", "/me/apply");

  const closed = await page.context().newPage();
  await stub(closed, FORM({ application: { id: "l", ref: "SC-AAAAA-BBBBB", stageCode: "documents", status: "closed" }, editable: false }));
  await closed.goto("/me/file");
  await expect(closed.getByTestId("file-form-save")).toHaveCount(0);
  await expect(closed.getByText("This application is closed")).toBeVisible();
});

test("an upload that fails is tried again alone, with the same file and no new choice", async ({ page }) => {
  await stub(page);
  let signs = 0;
  let puts = 0;
  let confirms = 0;
  await page.route("**/api/v1/me/documents.sign", (route) => {
    signs += 1;
    return json(route, { id: "doc-id", url: "https://br-shiny-resonance-b9kn9vx1.storage.c-7.eu-central-1.aws.neon.tech/student-docs/s/d?sig=1", headers: { "content-type": "image/png" }, expiresInSeconds: 600 }, 201);
  });
  await page.route("https://br-shiny-resonance-b9kn9vx1.storage.c-7.eu-central-1.aws.neon.tech/**", (route) => {
    puts += 1;
    return puts === 1 ? route.abort("connectionfailed") : route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
  await page.route("**/api/v1/me/documents.confirm", (route) => {
    confirms += 1;
    return json(route, { id: "doc-id", state: "uploaded" });
  });

  await page.goto("/me/file");
  await page.getByTestId("doc-id-input").setInputFiles(PNG);
  await expect(page.getByTestId("doc-id-error")).toContainText("We could not send it");
  expect(confirms).toBe(0); // a file that did not arrive is not confirmed
  // The other documents were not touched.
  await expect(page.getByTestId("doc-results-error")).toHaveCount(0);

  await page.getByTestId("doc-id-retry").click();
  await expect(page.getByTestId("doc-id-error")).toHaveCount(0);
  await expect.poll(() => ({ signs, puts, confirms })).toEqual({ signs: 2, puts: 2, confirms: 1 });
});

test("refuses a file that is too big or not an allowed type before sending anything", async ({ page }) => {
  await stub(page);
  let signs = 0;
  await page.route("**/api/v1/me/documents.sign", (route) => {
    signs += 1;
    return json(route, {}, 500);
  });
  await page.goto("/me/file");
  await page.getByTestId("doc-id-input").setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.getByTestId("doc-id-error")).toContainText("too big");
  await page.getByTestId("doc-results-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByTestId("doc-results-error")).toContainText("Only JPG, PNG or PDF");
  expect(signs).toBe(0);
});

test("shows each document's state, the adviser's reason for a refusal, and no choose button once approved", async ({ page }) => {
  await stub(page, FORM(), [doc("results", "approved"), doc("id", "uploaded"), doc("birth_certificate", "rejected", { rejectionNote: "Too dark" })]);
  await page.goto("/me/file");
  await expect(page.getByTestId("doc-results-state")).toHaveText("Approved");
  await expect(page.getByTestId("doc-results-input")).toHaveCount(0);
  await expect(page.getByTestId("doc-id-state")).toContainText("Waiting for your manager");
  await expect(page.getByTestId("doc-birth_certificate")).toContainText("Your manager says: Too dark");
  await expect(page.getByTestId("doc-signature-state")).toHaveText("Not sent yet");
});

test("shows the proof of payment from the offer-letter step on, and a letter the student can download", async ({ page }) => {
  await stub(page, FORM({ application: { id: "l", ref: "SC-AAAAA-BBBBB", stageCode: "offer_letter", status: "open" } }), [doc("offer_letter", "uploaded", { id: "letter-1", contentType: "application/pdf" })]);
  await page.route("**/api/v1/me/document-link?id=letter-1", (route) => json(route, { url: "http://localhost:3100/api/v1/health", expiresInSeconds: 300 }));
  await page.goto("/me/file");
  await expect(page.getByTestId("file-proof")).toBeVisible();
  await expect(page.getByTestId("file-proof")).toContainText("never ask for payment details");
  await expect(page.getByTestId("file-letters")).toContainText("Offer letter");
  const navigation = page.waitForURL("**/api/v1/health");
  await page.getByTestId("letter-letter-1-open").click();
  await navigation; // the link replaces the page, as a download would
});

test("does not show the proof of payment before the offer-letter step", async ({ page }) => {
  await stub(page);
  await page.goto("/me/file");
  await expect(page.getByTestId("file-proof")).toHaveCount(0);
  await expect(page.getByTestId("file-letters")).toHaveCount(0);
});

test("My file is a tab of the bar, and the tab is lit on the page", async ({ page }) => {
  await stub(page);
  await page.route("**/api/v1/me/home", (route) => json(route, { userId: "s", onboarded: true, relationship: "student", firstName: "Ada", courseFields: [], level: "undergraduate", intakeYear: 2027, lead: null, stages: [], whatsappE164: null }));
  await page.goto("/me");
  const bar = page.getByRole("navigation", { name: "Main tabs" });
  await expect(bar.getByRole("link", { name: "My file" })).toHaveAttribute("href", "/me/file");
  await page.goto("/me/file");
  await expect(bar.getByRole("link", { name: "My file" })).toHaveAttribute("aria-current", "page");
});
