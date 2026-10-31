import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Stages 6 to 8 in a real browser on a production build (`next start`): content management and images (B6 to B8), analytics (B10) and
 * the student portal (A11 to A13). As in stage2-auth.spec.ts and stage5-leads.spec.ts there is no Worker, Neon or session here, so the
 * edge endpoints are answered by small fakes that return the shapes and status codes the integration tests
 * (stage6-content, stage7-analytics, stage8-student) prove the real ones return. What these tests prove is the screen: what it shows,
 * what it sends and what it does with each answer. The live check that a published change reaches the public page with no deploy
 * (FR-16) needs the deployed Worker and is made by the deploy workflow's probes.
 */

test.use({ serviceWorkers: "block" });

const ID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const V1 = "2026-10-26T12:00:00.000001Z";
const V2 = "2026-10-26T12:05:00.000002Z";
const SHA = "a".repeat(64);

const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const fail = (route: Route, status: number, code: string, fields: Record<string, string> = {}) => json(route, { error: { code, message: code, fields }, request_id: "r" }, status);

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function staff(page: Page) {
  await page.route("**/api/v1/admin/session", (route) => json(route, { role: "admin", name: "Priya", email: "priya@example.test", stepUpFresh: false }));
}

// A 1 x 1 PNG: the browser turns it into a WebP, which is all the upload screen needs to show a size and send a file.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const NO_OPTIONS = { universities: [], programmes: [], consents: [], stages: [], media: [] };
const ITEM = /\/api\/v1\/admin\/content-item\?/;

const faq = (over: Record<string, unknown> = {}) => ({
  id: ID,
  status: "draft",
  version: V1,
  values: { category: "Visa", question: "Do I need a visa?", answer: "Yes, a student visa.", sortOrder: 1 },
  steps: [],
  consentRevoked: false,
  slug: null,
  ...over,
});

// ---- Stage 6 -------------------------------------------------------------------------------------------------------

test.describe("B6 the content hub and lists", () => {
  test("shows a card for every kind of content with its counts, the image meter and the stale warning", async ({ page }) => {
    await staff(page);
    const types = ["universities", "programmes", "fees", "campus", "resources", "testimonials", "journeys", "team", "faqs", "stats", "steps", "copy", "blog", "templates"];
    await page.route("**/api/v1/admin/content-hub", (route) =>
      json(route, {
        cards: types.map((type) => ({ type, draft: 1, published: 2, archived: 0, warnings: type === "fees" ? 3 : 0 })),
        media: { usedBytes: 2_800_000_000, budgetBytes: 3_758_096_384 },
      }),
    );
    await page.goto("/admin/content");
    await expect(page.getByRole("heading", { name: "Content" })).toBeVisible();
    await expect(page.getByTestId("card-universities")).toContainText("2 live · 1 drafts · 0 archived");
    await expect(page.getByTestId("card-fees")).toContainText("3 to check");
    await expect(page.getByTestId("card-media")).toContainText("2.61 GB of 3.50 GB used");
    await expect(alerts(page)).toContainText("75% full");
    await expect(page.getByTestId("card-stale")).toContainText("3 to check");
    await expect(page.getByTestId("card-universities")).toHaveAttribute("href", "/admin/content/universities");
    await axe(page);
  });

  test("lists items with their status, filters by status and search, and unpublishes after a confirmation", async ({ page }) => {
    await staff(page);
    const requests: string[] = [];
    await page.route(/\/api\/v1\/admin\/content-list\?/, (route) => {
      requests.push(new URL(route.request().url()).search);
      return json(route, {
        type: "faqs",
        items: [
          { id: ID, label: "Do I need a visa?", status: "published", version: V1, publishedAt: "2026-10-20T10:00:00.000Z", flag: null },
          { id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c", label: "Is it free?", status: "draft", version: V1, publishedAt: null, flag: null },
        ],
        truncated: false,
      });
    });
    let body: unknown = null;
    await page.route("**/api/v1/admin/content.unpublish", (route) => {
      body = route.request().postDataJSON();
      return json(route, { id: ID, version: V2, status: "draft", revalidate: { areas: ["site"], paths: ["/faq", "/"] } });
    });
    const told: unknown[] = [];
    await page.route("**/api/v1/admin/revalidate", (route) => {
      told.push(route.request().postDataJSON());
      return json(route, { revalidated: ["site"], purged: 2 });
    });
    await page.goto("/admin/content/faqs");
    await expect(page.getByRole("heading", { name: "FAQs" })).toBeVisible();
    await expect(page.getByTestId("items").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("new")).toHaveAttribute("href", "/admin/content/faqs/new");

    await page.getByRole("button", { name: "Live", exact: true }).click();
    await expect.poll(() => requests.at(-1)).toContain("status=published");
    await page.getByLabel("Search").fill("visa");
    await page.getByRole("button", { name: "Search" }).click();
    await expect.poll(() => requests.at(-1)).toContain("q=visa");

    await page.getByRole("button", { name: "Unpublish" }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Take this off the site?");
    await page.getByRole("dialog").getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("It is off the site.")).toBeVisible();
    expect(body).toEqual({ type: "faqs", id: ID, version: V1 });
    expect(told).toEqual([{ areas: ["site"], paths: ["/faq", "/"] }]);
  });

  test("says what is wrong when a list cannot be read, and for a kind of content that does not exist", async ({ page }) => {
    await staff(page);
    await page.route(/\/api\/v1\/admin\/content-list\?/, (route) => fail(route, 500, "INTERNAL"));
    await page.goto("/admin/content/faqs");
    await expect(alerts(page)).toContainText("We could not load this page.");
    const response = await page.goto("/admin/content/nonsense");
    expect(response?.status()).toBe(404);
  });
});

test.describe("B6 the standard content flow", () => {
  test("a new item: checks the fields in the form, saves a draft, and Publish waits for the save", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, route.request().url().includes("id=") ? { type: "faqs", item: faq(), options: NO_OPTIONS } : { type: "faqs", item: null, options: NO_OPTIONS }));
    const saves: Record<string, unknown>[] = [];
    await page.route("**/api/v1/admin/content.save", (route) => {
      saves.push(route.request().postDataJSON());
      return json(route, { id: ID, version: V1, status: "draft", revalidate: null }, 201);
    });

    await page.goto("/admin/content/faqs/new");
    await expect(page.getByRole("heading", { name: "New question" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

    // The same checks as the server, before anything is sent.
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("This is required.")).toHaveCount(2);
    expect(saves).toHaveLength(0);
    await expect(page.getByLabel(/^Question/)).toBeFocused();

    await page.getByLabel(/^Question/).fill("Do I need a visa?");
    await page.getByLabel(/^Answer/).fill("Yes, a student visa.");
    // Moving to the new item's own address after the save is not "leaving with something to lose": no leave prompt may open.
    const prompts: string[] = [];
    page.on("dialog", (dialog) => {
      prompts.push(dialog.type());
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/content/faqs/${ID}$`));
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(prompts).toEqual([]);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ type: "faqs", values: { question: "Do I need a visa?", answer: "Yes, a student visa.", category: "" } });
    expect(saves[0]).not.toHaveProperty("id");
    await axe(page);
  });

  test("warns before leaving with unsaved changes", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "faqs", item: faq(), options: NO_OPTIONS }));
    await page.goto(`/admin/content/faqs/${ID}`);
    await expect(page.getByLabel(/^Question/)).toHaveValue("Do I need a visa?");
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
    const asksBefore = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(asksBefore).toBe(false);
    await page.getByLabel(/^Question/).fill("Do I need a visa to study in India?");
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    // The browser's own leave prompt is the guard; what is tested is that the page asks for it exactly when there is something to lose.
    const asksToStay = () =>
      page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await asksToStay()).toBe(true);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  test("a testimonial lists what is missing, then publishes once verified with a consent record, and tells the public site", async ({ page }) => {
    await staff(page);
    const consent = { id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d", subjectName: "Ama Mensah", scope: "testimonial", grantedOn: "2026-10-01", revoked: false };
    const values = { studentName: "Ama Mensah", country: "GH", universityId: "", quote: "Great help.", photoMediaId: null, verified: false, consentId: null, sortOrder: 0 };
    await page.route(ITEM, (route) =>
      json(route, { type: "testimonials", item: { id: ID, status: "draft", version: V1, values, steps: [], consentRevoked: false, slug: null }, options: { ...NO_OPTIONS, consents: [consent] } }),
    );
    const saved: Record<string, unknown>[] = [];
    await page.route("**/api/v1/admin/content.save", (route) => {
      saved.push(route.request().postDataJSON());
      return json(route, { id: ID, version: V2, status: "draft", revalidate: null });
    });
    let published: unknown = null;
    await page.route("**/api/v1/admin/content.publish", (route) => {
      published = route.request().postDataJSON();
      return json(route, { id: ID, version: "2026-10-26T12:10:00.000003Z", status: "published", revalidate: { areas: ["trust"], paths: ["/", "/about"] } });
    });
    const told: unknown[] = [];
    await page.route("**/api/v1/admin/revalidate", (route) => {
      told.push(route.request().postDataJSON());
      return json(route, { revalidated: ["trust"], purged: 2 });
    });

    await page.goto(`/admin/content/testimonials/${ID}`);
    await page.getByRole("button", { name: "Publish" }).click();
    const gates = page.getByTestId("gate-list");
    await expect(gates).toContainText("Verified as a real student: Tick Verified first.");
    await expect(gates).toContainText("Consent record: Attach a consent record.");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Publish" })).toBeDisabled();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await page.getByLabel("Verified as a real student").check();
    await page.getByLabel(/^Consent record/).selectOption(consent.id);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(saved[0]).toMatchObject({ id: ID, version: V1, values: { verified: true, consentId: consent.id } });

    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("dialog")).toContainText("It will be visible to everyone on the public site.");
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("It is live.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View on site" })).toBeVisible();
    expect(published).toEqual({ type: "testimonials", id: ID, version: V2 });
    expect(told).toEqual([{ areas: ["trust"], paths: ["/", "/about"] }]);
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("shows each field-level answer from the server next to its field", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "universities", item: null, options: NO_OPTIONS }));
    await page.route("**/api/v1/admin/content.save", (route) => fail(route, 400, "VALIDATION", { "values.slug": "DUPLICATE" }));
    await page.goto("/admin/content/universities/new");
    await page.getByLabel(/^Name/).fill("Alpha University");
    // The address name follows the name until it is edited.
    await expect(page.getByLabel(/^Web address name/)).toHaveValue("alpha-university");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Another item already uses this.")).toBeVisible();
    await expect(page.getByLabel(/^Web address name/)).toBeFocused();
  });

  test("a change made by someone else is not overwritten: the person is told and can reload", async ({ page }) => {
    await staff(page);
    let loads = 0;
    await page.route(ITEM, (route) => {
      loads += 1;
      return json(route, { type: "faqs", item: faq(loads > 1 ? { version: V2, values: { category: "Visa", question: "Do I need a visa?", answer: "Changed by Sam.", sortOrder: 1 } } : {}), options: NO_OPTIONS });
    });
    await page.route("**/api/v1/admin/content.save", (route) => fail(route, 409, "CONFLICT", { version: "STALE" }));
    await page.goto(`/admin/content/faqs/${ID}`);
    await page.getByLabel(/^Answer/).fill("My version");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(alerts(page)).toContainText("Someone else changed this first.");
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByLabel(/^Answer/)).toHaveValue("Changed by Sam.");
  });

  test("keeps the form when the connection drops and sends it again on retry", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "faqs", item: faq(), options: NO_OPTIONS }));
    let attempts = 0;
    await page.route("**/api/v1/admin/content.save", (route) => {
      attempts += 1;
      return attempts === 1 ? route.abort("failed") : json(route, { id: ID, version: V2, status: "draft", revalidate: null });
    });
    await page.goto(`/admin/content/faqs/${ID}`);
    await page.getByLabel(/^Answer/).fill("Typed while offline");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(alerts(page)).toContainText("You're offline. Your changes are kept.");
    await expect(page.getByLabel(/^Answer/)).toHaveValue("Typed while offline");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("an archived item can only be restored", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "faqs", item: faq({ status: "archived" }), options: NO_OPTIONS }));
    await page.goto(`/admin/content/faqs/${ID}`);
    await expect(page.getByText("This item is archived and cannot be edited.")).toBeVisible();
    await expect(page.getByLabel(/^Question/)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  });

  test("a journey's saved steps cannot be removed, new ones can", async ({ page }) => {
    await staff(page);
    const values = { studentName: "Kofi", country: "GH", universityId: "", summary: "From Accra to Pune.", verified: false, consentId: null, sortOrder: 0 };
    await page.route(ITEM, (route) =>
      json(route, { type: "journeys", item: { id: ID, status: "draft", version: V1, values, steps: [{ title: "Applied", body: "Sent results.", dateLabel: null }], consentRevoked: false, slug: null }, options: NO_OPTIONS }),
    );
    await page.goto(`/admin/content/journeys/${ID}`);
    await expect(page.getByLabel("Step title")).toHaveValue("Applied");
    await expect(page.getByRole("button", { name: "Remove this step" })).toHaveCount(0);
    await page.getByRole("button", { name: "Add a step" }).click();
    await expect(page.getByRole("button", { name: "Remove this step" })).toHaveCount(1);
    await page.getByRole("button", { name: "Remove this step" }).click();
    await expect(page.getByLabel("Step title")).toHaveCount(1);
  });

  test("the blog preview uses the same sanitiser: a script and raw HTML stay text", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "blog", item: null, options: NO_OPTIONS }));
    await page.goto("/admin/content/blog/new");
    await page.getByLabel(/^Text/).fill("# Hello\n\nSome **bold** text <script>window.hacked = 1</script> and [bad](javascript:alert(1)).");
    await page.getByRole("button", { name: "Preview" }).click();
    const preview = page.getByTestId("markdown-preview");
    await expect(preview.locator("strong")).toHaveText("bold");
    await expect(preview.locator("script")).toHaveCount(0);
    await expect(preview).toContainText("<script>window.hacked = 1</script>");
    await expect(preview.locator("a")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { hacked?: number }).hacked)).toBeUndefined();
  });
});

test.describe("B6 step 4 and B7: images", () => {
  const OPTIONS = { ...NO_OPTIONS };

  test("shrinks and converts a picture before it is sent, shows its size, and stores nothing until Upload", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "universities", item: null, options: OPTIONS }));
    let query = "";
    let contentType = "";
    let bytes = 0;
    await page.route(/\/api\/v1\/admin\/media\.upload\?/, (route) => {
      const request = route.request();
      query = new URL(request.url()).search;
      contentType = request.headers()["content-type"] ?? "";
      bytes = request.postDataBuffer()?.byteLength ?? 0;
      return json(route, { id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60", sha256: SHA, width: 1, height: 1, bytes, status: "created" }, 201);
    });
    await page.goto("/admin/content/universities/new");
    await page.getByRole("button", { name: "Logo" }).first().click();
    await page.getByRole("button", { name: "Upload a new image" }).click();
    const dialog = page.getByRole("dialog", { name: "Upload an image" });
    await dialog.getByLabel("What is it").selectOption("logo");
    await dialog.getByLabel("Picture").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
    await expect(dialog.getByTestId("prepared-size")).toContainText("of 50.0 KB allowed");
    expect(query).toBe("");
    await dialog.getByLabel("Description (alt text)").fill("Alpha University logo");
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("Image added.")).toBeVisible();
    expect(query).toContain("kind=logo");
    expect(query).toContain("alt=Alpha+University+logo");
    expect(query).not.toContain("document");
    expect(contentType).toBe("image/webp");
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(50 * 1024);
    await expect(page.locator(`img[src="/media/${SHA}.webp"]`)).toBeVisible();
  });

  test("refuses an SVG and anything that is not a picture, in the browser", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "universities", item: null, options: OPTIONS }));
    let sent = 0;
    await page.route(/\/api\/v1\/admin\/media\.upload\?/, (route) => {
      sent += 1;
      return fail(route, 400, "VALIDATION");
    });
    await page.goto("/admin/content/universities/new");
    await page.getByRole("button", { name: "Logo" }).first().click();
    await page.getByRole("button", { name: "Upload a new image" }).click();
    const dialog = page.getByRole("dialog", { name: "Upload an image" });
    await dialog.getByLabel("Picture").setInputFiles({ name: "a.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') });
    await expect(dialog.getByRole("alert")).toContainText("SVG files are not accepted");
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
    await dialog.getByLabel("Picture").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    await expect(dialog.getByRole("alert")).toContainText("That file is not a picture.");
    expect(sent).toBe(0);
  });

  test("a photo of a document needs its private parts covered and a confirmation before it can be uploaded", async ({ page }) => {
    await staff(page);
    await page.route(ITEM, (route) => json(route, { type: "universities", item: null, options: OPTIONS }));
    let query = "";
    await page.route(/\/api\/v1\/admin\/media\.upload\?/, (route) => {
      query = new URL(route.request().url()).search;
      return json(route, { id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61", sha256: "b".repeat(64), width: 1, height: 1, bytes: 90, status: "existing" });
    });
    await page.goto("/admin/content/universities/new");
    await page.getByRole("button", { name: "Logo" }).first().click();
    await page.getByRole("button", { name: "Upload a new image" }).click();
    const dialog = page.getByRole("dialog", { name: "Upload an image" });
    await dialog.getByLabel("Picture").setInputFiles({ name: "letter.png", mimeType: "image/png", buffer: PNG });
    await expect(dialog.getByTestId("prepared-size")).toBeVisible();
    await dialog.getByLabel("This is a photo of a document, such as an offer letter").check();
    await expect(dialog.getByText("Drag across anything private")).toBeVisible();
    await expect(dialog.getByText("No areas covered")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
    await dialog.getByLabel("I have covered all private details on this document.").check();
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByText("That picture was already in the library, so it was reused.")).toBeVisible();
    expect(query).toContain("document=1");
    expect(query).toContain("confirmed=1");
  });

  test("the library shows the meter and uses; an image in use cannot be archived", async ({ page }) => {
    await staff(page);
    const image = { id: ID, kind: "photo", alt: "Campus", width: 800, height: 600, bytes: 120_000, sha256: SHA, createdAt: "2026-10-20T10:00:00.000Z", archived: false, usedBy: 1 };
    await page.route("**/api/v1/admin/media", (route) => json(route, { items: [image, { ...image, id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62", sha256: "c".repeat(64), alt: "", usedBy: 0 }], usedBytes: 240_000, budgetBytes: 3_758_096_384 }));
    await page.route(/\/api\/v1\/admin\/media-item\?/, (route) => json(route, { uses: [{ type: "universities", id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a63", label: "Alpha University", status: "published" }] }));
    let archived = 0;
    await page.route("**/api/v1/admin/media.archive", (route) => {
      archived += 1;
      return fail(route, 409, "CONFLICT", { media: "IN_USE" });
    });
    await page.goto("/admin/content/media");
    await expect(page.getByTestId("meter")).toContainText("234.4 KB of 3.50 GB used (0%)");
    await expect(page.getByTestId("grid").getByRole("listitem")).toHaveCount(2);
    await page.getByTestId("grid").getByRole("button").first().click();
    const dialog = page.getByRole("dialog", { name: "Image" });
    await expect(dialog.getByRole("link", { name: "Alpha University" })).toHaveAttribute("href", /\/admin\/content\/universities\//);
    // The button is off while a live item uses it, so the server's refusal is the second lock.
    await expect(dialog.getByRole("button", { name: "Archive image" })).toBeDisabled();
    expect(archived).toBe(0);
    await axe(page);
  });
});

test.describe("B8 stale content", () => {
  test("lists what is overdue and marks it checked", async ({ page }) => {
    await staff(page);
    let items = [
      { type: "fees", id: ID, label: "Alpha · USD 3000.00 to 6000.00 · per year", version: V1, checkedAt: "2026-03-01T10:00:00.000Z" },
      { type: "campus", id: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a64", label: "Campus tour (tour360)", version: V1, checkedAt: null },
    ];
    await page.route("**/api/v1/admin/stale", (route) => json(route, { items }));
    let body: unknown = null;
    await page.route("**/api/v1/admin/content.markChecked", (route) => {
      body = route.request().postDataJSON();
      items = items.slice(1);
      return json(route, { id: ID, version: V2, status: "published", revalidate: { areas: ["catalogue"], paths: ["/fees"] } });
    });
    await page.route("**/api/v1/admin/revalidate", (route) => json(route, { revalidated: ["catalogue"], purged: 1 }));
    await page.goto("/admin/content/stale");
    await expect(page.getByTestId("stale-items").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("never checked")).toBeVisible();
    await page.getByRole("button", { name: "Mark checked" }).first().click();
    await expect(page.getByText("Marked as checked.")).toBeVisible();
    expect(body).toEqual({ type: "fees", id: ID, version: V1 });
    await expect(page.getByTestId("stale-items").getByRole("listitem")).toHaveCount(1);
  });

  test("says when everything is fresh", async ({ page }) => {
    await staff(page);
    await page.route("**/api/v1/admin/stale", (route) => json(route, { items: [] }));
    await page.goto("/admin/content/stale");
    await expect(page.getByTestId("all-fresh")).toBeVisible();
  });
});

// ---- Stage 7 -------------------------------------------------------------------------------------------------------

test.describe("B10 analytics", () => {
  const funnel = [
    { key: "visit", count: 1000, ratio: null, stage: null, label: null },
    { key: "wa_tap", count: 100, ratio: 0.1, stage: null, label: null },
    { key: "lead", count: 40, ratio: 0.4, stage: null, label: null },
    { key: "stage:choose_course", count: 20, ratio: 0.5, stage: "choose_course", label: "Choose course" },
  ];
  const analytics = (over: Record<string, unknown> = {}) => ({
    range: { from: "2026-09-27", to: "2026-10-26" },
    collectPageViews: true,
    funnel,
    sources: {
      byCountry: [{ country: "CM", leads: 25 }, { country: "NG", leads: 15 }],
      byUniversity: [{ universityId: ID, name: "Alpha University", leads: 30 }, { universityId: null, name: null, leads: 10 }],
      byPage: [{ page: "/apply", leads: 22 }],
    },
    universities: [{ id: ID, name: "Alpha University" }],
    totalLeads: 40,
    ...over,
  });

  test("shows the funnel with drop-off, opens the leads behind a bar, and ends with the limits notice", async ({ page }) => {
    await staff(page);
    const queries: string[] = [];
    await page.route(/\/api\/v1\/admin\/analytics\?/, (route) => {
      queries.push(new URL(route.request().url()).search);
      return json(route, analytics());
    });
    await page.goto("/admin/analytics");
    await expect(page.getByTestId("funnel-visit")).toHaveText("1000");
    await expect(page.getByTestId("funnel-wa_tap")).toContainText("100");
    await expect(page.getByTestId("funnel-wa_tap")).toContainText("10% of the step before");
    await expect(page.getByTestId("funnel-stage:choose_course")).toContainText("50% of the step before");
    await expect(page.getByRole("link", { name: /Choose course/ })).toHaveAttribute("href", "/admin/leads?stage=choose_course");
    await expect(page.getByRole("link", { name: /^Leads/ }).last()).toHaveAttribute("href", "/admin/leads");
    // Visits and taps are anonymous counts, so they have no leads to open.
    await expect(page.getByRole("link", { name: /Visits/ })).toHaveCount(0);
    await expect(page.getByTestId("limits-notice")).toContainText("Counts can be lower than real traffic because of ad blockers and offline visits.");
    expect(queries[0]).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    await axe(page);
  });

  test("filters by country and university and keeps them in the address", async ({ page }) => {
    await staff(page);
    const queries: string[] = [];
    await page.route(/\/api\/v1\/admin\/analytics\?/, (route) => {
      queries.push(new URL(route.request().url()).search);
      return json(route, analytics());
    });
    await page.goto("/admin/analytics");
    await expect(page.getByTestId("funnel")).toBeVisible();
    await page.getByLabel("Country").selectOption("NG");
    await page.getByLabel("University").selectOption(ID);
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect.poll(() => queries.at(-1)).toContain("country=NG");
    expect(queries.at(-1)).toContain(`university=${ID}`);
    await expect(page).toHaveURL(/country=NG/);
    await expect(page.getByRole("link", { name: /Choose course/ })).toHaveAttribute("href", `/admin/leads?stage=choose_course&country=NG&university=${ID}`);
    await page.reload();
    await expect(page.getByLabel("Country")).toHaveValue("NG");
  });

  test("tells the person the funnel starts at WhatsApp taps when page views are switched off", async ({ page }) => {
    await staff(page);
    await page.route(/\/api\/v1\/admin\/analytics\?/, (route) => json(route, analytics({ collectPageViews: false, funnel: funnel.slice(1).map((r, i) => (i === 0 ? { ...r, ratio: null } : r)) })));
    await page.goto("/admin/analytics");
    await expect(page.getByTestId("kill-switch-notice")).toContainText("Page views are not being counted");
    await expect(page.getByTestId("funnel-visit")).toHaveCount(0);
    await expect(page.getByTestId("funnel-wa_tap")).toHaveText("100");
  });

  test("names the date that cannot be used, and shows an empty range plainly", async ({ page }) => {
    await staff(page);
    let call = 0;
    await page.route(/\/api\/v1\/admin\/analytics\?/, (route) => {
      call += 1;
      if (call === 1) return fail(route, 400, "VALIDATION", { to: "FUTURE" });
      return json(route, analytics({ funnel: funnel.map((r) => ({ ...r, count: 0, ratio: null })), totalLeads: 0 }));
    });
    await page.goto("/admin/analytics");
    await expect(alerts(page)).toContainText("The last day cannot be in the future.");
    await page.getByRole("button", { name: "Last 30 days" }).click();
    await expect(page.getByText("No visits, taps or leads in this range yet.")).toBeVisible();
  });

  test("shows the sources, and the admin's own performance with the basis of the reply times", async ({ page }) => {
    await staff(page);
    await page.route(/\/api\/v1\/admin\/analytics\?/, (route) => json(route, analytics()));
    await page.route(/\/api\/v1\/admin\/performance\?/, (route) => json(route, { range: { from: "2026-09-27", to: "2026-10-26" }, assigned: 12, answered: 9, medianMinutes: 75, meanMinutes: 20, overdue: 2 }));
    await page.goto("/admin/analytics?tab=sources");
    const sources = page.getByTestId("sources");
    await expect(sources).toContainText("CM");
    await expect(sources).toContainText("Alpha University");
    await expect(sources).toContainText("Not from a university page");
    await expect(sources).toContainText("/apply");

    await page.getByRole("button", { name: "My performance" }).click();
    await expect(page.getByTestId("perf-assigned")).toHaveText("12");
    await expect(page.getByTestId("perf-answered")).toHaveText("9");
    await expect(page.getByTestId("perf-median")).toHaveText("1 h 15 min");
    await expect(page.getByTestId("perf-mean")).toHaveText("20 minutes");
    await expect(page.getByTestId("perf-overdue")).toHaveText("2");
    await expect(page.getByText("Reply times are based on the replies you logged")).toBeVisible();
    await expect(page.getByRole("link", { name: "See your overdue leads" })).toHaveAttribute("href", "/admin/leads?view=overdue&assigned=me");
    await expect(page.getByLabel("Country")).toHaveCount(0);
  });
});

// ---- Stage 8 -------------------------------------------------------------------------------------------------------

const STAGES = ["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"].map((code, i) => ({ code, position: i + 1 }));
const progress = (over: Record<string, unknown> = {}) => ({
  userId: "student-1",
  state: "linked",
  pendingClaims: 0,
  stages: STAGES,
  lead: { ref: "SC-ABCDE-12345", stage: "offer_letter", updatedAt: "2026-10-24T09:30:00.000Z" },
  otherLeads: 0,
  whatsappE164: "+919815725968",
  ...over,
});

/** The kept copy on the phone, read straight from IndexedDB. */
async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<unknown[]>(async (resolve) => {
        // Opening a database that does not exist yet would create it empty at version 1 and starve the app's own upgrade.
        if (!(await indexedDB.databases()).some((d) => d.name === "scollarly")) return resolve([]);
        const open = indexedDB.open("scollarly");
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("progressSnapshot")) return resolve([]);
          const all = db.transaction("progressSnapshot").objectStore("progressSnapshot").getAll();
          all.onsuccess = () => resolve(all.result as unknown[]);
          all.onerror = () => resolve([]);
        };
      }),
  );
}

test.describe("A11 /me progress", () => {
  test("a linked student sees the six steps, where they are, what comes next and a WhatsApp button built from the one helper", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => json(route, progress()));
    await page.goto("/me/progress");
    await expect(page.getByTestId("reference")).toHaveText("SC-ABCDE-12345");
    const bar = page.getByTestId("stage-bar");
    await expect(bar.getByRole("listitem")).toHaveCount(6);
    await expect(bar.locator('[aria-current="step"]')).toContainText("Offer letter");
    await expect(bar.locator('[aria-current="step"]')).toContainText("You are here");
    await expect(bar.locator('[data-state="done"]')).toHaveCount(2);
    await expect(page.getByTestId("next-step")).toContainText("offer letter");
    await expect(page.getByTestId("last-updated")).toHaveText("Last updated 2026-10-24");
    const href = (await page.getByTestId("whatsapp").getAttribute("href")) ?? "";
    expect(href.startsWith("https://wa.me/919815725968?text=")).toBe(true);
    expect(decodeURIComponent(href.split("?text=")[1] ?? "")).toContain("SC-ABCDE-12345");
    await axe(page);
  });

  test("keeps only the reference, the stage and the date on the phone, and replaces another student's copy", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => json(route, progress()));
    await page.goto("/me/progress");
    await expect(page.getByTestId("reference")).toBeVisible();
    await expect.poll(() => snapshot(page)).toEqual([{ userId: "student-1", leadRef: "SC-ABCDE-12345", stageCode: "offer_letter", updatedAt: Date.parse("2026-10-24T09:30:00.000Z") }]);

    // A different student signs in on the same phone: the first copy is gone.
    await page.unroute("**/api/v1/me/progress");
    await page.route("**/api/v1/me/progress", (route) => json(route, progress({ userId: "student-2", lead: { ref: "SC-ZZZZZ-99999", stage: "visa", updatedAt: "2026-10-25T09:30:00.000Z" } })));
    await page.reload();
    await expect(page.getByTestId("reference")).toHaveText("SC-ZZZZZ-99999");
    await expect.poll(async () => (await snapshot(page)).length).toBe(1);
    expect(((await snapshot(page))[0] as { userId: string }).userId).toBe("student-2");
  });

  test("offline, shows the last stage kept on the phone with its date; with nothing kept it says it could not load", async ({ page }) => {
    let online = true;
    await page.route("**/api/v1/me/progress", (route) => (online ? json(route, progress()) : route.abort("internetdisconnected")));
    await page.goto("/me/progress");
    await expect(page.getByTestId("reference")).toBeVisible();
    await expect.poll(async () => (await snapshot(page)).length).toBe(1);

    online = false;
    await page.reload();
    const card = page.getByTestId("offline-progress");
    await expect(card).toContainText("You're offline. This is the last progress saved on this phone");
    await expect(page.getByTestId("offline-stage")).toHaveText("Offer letter");
    await expect(page.getByTestId("offline-updated")).toHaveText("Last updated 2026-10-24");
    await expect(card).toContainText("SC-ABCDE-12345");
    // Back online, "Check again" reads the portal again.
    online = true;
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByTestId("stage-bar")).toBeVisible();
  });

  test("with nothing kept, an offline student sees the usual error and a retry", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => route.abort("internetdisconnected"));
    await page.goto("/me/progress");
    await expect(alerts(page)).toContainText("You're offline, so we could not load this page.");
    await expect(page.getByTestId("offline-progress")).toHaveCount(0);
  });

  test("a student with no linked application sees 'matching' and no lead data, and forgets any kept copy", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => json(route, progress({ state: "matching", lead: null, pendingClaims: 1 })));
    await page.goto("/me/progress");
    const card = page.getByTestId("matching");
    await expect(card).toContainText("We are matching your application");
    await expect(card).toContainText("Your request is waiting for an admin to confirm it.");
    await expect(page.getByTestId("stage-bar")).toHaveCount(0);
    await expect(page.getByTestId("reference")).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Link my application" })).toHaveAttribute("href", "/me/link-application");
    expect(await snapshot(page)).toEqual([]);
  });

  test("the offline page shows the kept stage to a student whose /me cannot be reached", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => json(route, progress()));
    await page.goto("/me/progress");
    await expect.poll(async () => (await snapshot(page)).length).toBe(1);
    await page.goto("/offline");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId("offline-stage")).toHaveText("Offer letter");
    await expect(page.getByTestId("offline-updated")).toHaveText("Last updated 2026-10-24");
  });

  test("signing out deletes the kept copy before the session ends", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => json(route, progress()));
    await page.goto("/me/progress");
    await expect.poll(async () => (await snapshot(page)).length).toBe(1);
    await page.route("**/api/auth/sign-out", (route) => json(route, { success: true }));
    await page.goto("/sign-out");
    await page.waitForURL("**/");
    expect(await snapshot(page)).toEqual([]);
  });
});

test.describe("A12 link my application", () => {
  test("sends the request and says an admin will confirm, whatever matched", async ({ page }) => {
    let body: unknown = null;
    await page.route("**/api/v1/me/student.requestLink", (route) => {
      body = route.request().postDataJSON();
      return json(route, { status: "sent" });
    });
    await page.goto("/me/link-application");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(alerts(page)).toContainText("Enter your reference or your number.");
    await page.getByLabel(/Your reference or the WhatsApp number/).fill("0201234567");
    await page.getByLabel(/Country of the number/).selectOption("GH");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByTestId("sent")).toContainText("Request sent. An admin will confirm.");
    expect(body).toEqual({ reference: "0201234567", country: "GH" });
  });

  test("shows the server's answer next to the field, and the daily limit", async ({ page }) => {
    let call = 0;
    await page.route("**/api/v1/me/student.requestLink", (route) => {
      call += 1;
      if (call === 1) return fail(route, 400, "VALIDATION", { reference: "NEEDS_COUNTRY" });
      return fail(route, 429, "RATE_LIMITED");
    });
    await page.goto("/me/link-application");
    await page.getByLabel(/Your reference or the WhatsApp number/).fill("0803 123 4567");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(alerts(page)).toContainText("Choose the country of the number");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(alerts(page)).toContainText("You have sent several requests today.");
    await axe(page);
  });
});

test.describe("A13 profile and my data", () => {
  test("shows the account, saves a new name, and keeps the email read-only", async ({ page }) => {
    await page.route("**/api/v1/me/profile", (route) => json(route, { name: "Ama", email: "ama@example.test" }));
    let body: unknown = null;
    await page.route("**/api/v1/me/profile.setName", (route) => {
      body = route.request().postDataJSON();
      return json(route, { saved: true });
    });
    await page.goto("/me/profile");
    await expect(page.getByLabel("Email")).toHaveValue("ama@example.test");
    await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByLabel("Name").fill("Ama Mensah");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    expect(body).toEqual({ name: "Ama Mensah" });
    await axe(page);
  });

  test("downloads the student's data as a JSON file made in the browser", async ({ page }) => {
    await page.route("**/api/v1/me/student.exportData", (route) => json(route, { exportedAt: "2026-10-26T12:00:00.000Z", account: { name: "Ama", email: "ama@example.test" }, leads: [{ ref: "SC-ABCDE-12345" }], linkRequests: [] }));
    await page.goto("/me/data");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^scollarly-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
    expect(JSON.parse(text)).toMatchObject({ leads: [{ ref: "SC-ABCDE-12345" }] });
    await expect(page.getByTestId("exported")).toBeVisible();
  });

  test("erasure needs the word DELETE, then deletes, forgets the kept copy and says so", async ({ page }) => {
    await page.route("**/api/v1/me/progress", (route) => json(route, progress()));
    await page.goto("/me/progress");
    await expect.poll(async () => (await snapshot(page)).length).toBe(1);
    let body: unknown = null;
    await page.route("**/api/v1/me/student.requestErasure", (route) => {
      body = route.request().postDataJSON();
      return json(route, { erased: true });
    });
    await page.goto("/me/data");
    await page.getByRole("button", { name: "Delete my data" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Delete all my data?" });
    const confirm = dialog.getByRole("button", { name: "Delete my data" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("delete");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await confirm.click();
    await expect(page.getByTestId("erased")).toContainText("Your data was deleted");
    expect(body).toEqual({ confirm: "DELETE" });
    expect(await snapshot(page)).toEqual([]);
  });

  test("asks for a fresh sign-in when the last one is more than ten minutes old, and a team account is told to ask the owner", async ({ page }) => {
    let call = 0;
    await page.route("**/api/v1/me/student.requestErasure", (route) => {
      call += 1;
      return call === 1 ? fail(route, 403, "STEP_UP_REQUIRED", { session: "REAUTH_REQUIRED" }) : fail(route, 409, "CONFLICT", { account: "STAFF" });
    });
    await page.goto("/me/data");
    await page.getByRole("button", { name: "Delete my data" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Delete all my data?" });
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dialog.getByRole("button", { name: "Delete my data" }).click();
    await expect(page.getByTestId("reauth")).toContainText("sign in again first");
    await expect(dialog.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/auth/start");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Delete my data" }).first().click();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dialog.getByRole("button", { name: "Delete my data" }).click();
    await expect(dialog.getByRole("alert")).toContainText("A team account cannot delete itself.");
    await axe(page);
  });
});
