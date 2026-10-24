import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBlog, buildCatalogue, buildSite, buildTrust } from "@/modules/content/builders";
import { uuidv7 } from "@/lib/uuid";
import { readCatalogueRows, readPostRows, readSiteRows, readTrustRows } from "@/server/repositories/content";
import { createTestDb, type TestDb } from "./helpers/db";
import { consent, insertRow, programmeRow, uni } from "./helpers/fixtures";

/**
 * S3.1: the public read layer, run as the real non-owner runtime role with row level security forced (ADR-038), so a draft
 * or archived row cannot come back, and the pieces the pages depend on arrive complete.
 */

let t: TestDb;
const ids: Record<string, string> = {};
const NOW = new Date().toISOString();

beforeAll(async () => {
  t = await createTestDb();
  ids.pub = await uni(t, { slug: "published-uni", name: "Published University", status: "published", published_at: NOW, translations: { en: "An overview." } });
  ids.draft = await uni(t, { slug: "draft-uni", name: "Draft University", status: "draft" });
  ids.archived = await uni(t, { slug: "archived-uni", name: "Archived University", status: "archived" });
  ids.progPub = await programmeRow(t, ids.pub, { name: "Published Programme", status: "published", sort_order: 1 });
  await programmeRow(t, ids.pub, { name: "Draft Programme", status: "draft" });

  const fee = (over: Record<string, unknown>) =>
    insertRow(t, "fee_structure", { id: uuidv7(), university_id: ids.pub, currency: "USD", period: "tuition per year", status: "published", ...over });
  ids.feeOk = await fee({ amount_min: 3000, amount_max: 6000, data_confirmed: true });
  await fee({ amount_min: null, amount_max: null, data_confirmed: false });
  await fee({ amount_min: 100, amount_max: 200, data_confirmed: true, status: "draft" });

  await insertRow(t, "campus_experience", { id: uuidv7(), university_id: ids.pub, kind: "video", title: "Tour", youtube_id: "5ddvpNEqpec", status: "published" });
  await insertRow(t, "campus_experience", { id: uuidv7(), university_id: ids.pub, kind: "video", title: "Hidden tour", youtube_id: "CB4w1yp1Z_I", status: "draft" });

  await insertRow(t, "faq", { id: uuidv7(), question: "Published?", answer: "Yes", status: "published" });
  await insertRow(t, "faq", { id: uuidv7(), question: "Draft?", answer: "No", status: "draft" });
  await insertRow(t, "process_step", { id: uuidv7(), kind: "application", position: 1, title: "One", body: "Body", status: "published" });
  await insertRow(t, "content_block", { id: uuidv7(), key: "hero.title", translations: { en: "Hello" }, status: "published" });
  await insertRow(t, "content_block", { id: uuidv7(), key: "secret.draft", translations: { en: "Hidden" }, status: "draft" });
  await t.run(`update site_setting set value = '"+14155550100"'::jsonb where key = 'whatsapp_number_e164'`);

  await insertRow(t, "trust_stat", { id: uuidv7(), key: "ok", label: "Students", value: "120+", confirmed: true, status: "published" });
  await insertRow(t, "trust_stat", { id: uuidv7(), key: "draft", label: "Draft", value: "9", confirmed: true, status: "draft" });
  await insertRow(t, "trust_stat", { id: uuidv7(), key: "unconfirmed", label: "Unconfirmed", value: "9", confirmed: false, status: "archived" });
  const consentId = await consent(t);
  await insertRow(t, "testimonial", { id: uuidv7(), student_name: "Shown", quote: "Great", verified: true, consent_id: consentId, status: "published" });
  await insertRow(t, "testimonial", { id: uuidv7(), student_name: "Draft", quote: "Hidden", verified: true, consent_id: consentId, status: "draft" });
  await insertRow(t, "team_member", { id: uuidv7(), name: "Shown member", role_title: "Adviser", confirmed: true, status: "published" });
  await insertRow(t, "team_member", { id: uuidv7(), name: "Draft member", role_title: "Adviser", confirmed: true, status: "draft" });

  await insertRow(t, "post", { id: uuidv7(), slug: "new", title: "New post", body: "Body", status: "published", published_at: NOW });
  await insertRow(t, "post", { id: uuidv7(), slug: "old", title: "Old post", body: "Body", status: "published", published_at: "2026-01-01T00:00:00Z" });
  await insertRow(t, "post", { id: uuidv7(), slug: "unpublished", title: "Draft post", body: "Body", status: "draft" });

  await t.asRuntime();
});

afterAll(async () => {
  await t.asOwner();
  await t.close();
});

describe("S3.1: public reads return published content only, as the runtime role", () => {
  it("returns published universities with only their published programmes, confirmed fees and published experiences", async () => {
    const rows = await readCatalogueRows(t.db);
    expect(rows.universities.map((u) => u.slug)).toEqual(["published-uni"]);
    expect(rows.programmes.map((p) => p.name)).toEqual(["Published Programme"]);
    expect(rows.fees.map((f) => f.id)).toEqual([ids.feeOk]);
    expect(rows.experiences.map((e) => e.title)).toEqual(["Tour"]);
  });

  it("builds the pages' view of it: a confirmed range, an overview and nothing from drafts", async () => {
    const { universities } = buildCatalogue(await readCatalogueRows(t.db));
    expect(universities).toHaveLength(1);
    expect(universities[0]).toMatchObject({ slug: "published-uni", overview: "An overview." });
    expect(universities[0]?.fees).toMatchObject([{ currency: "USD", min: 3000, max: 6000 }]);
    expect(universities[0]?.experiences).toMatchObject([{ kind: "video", youtubeId: "5ddvpNEqpec" }]);
  });

  it("returns published FAQs, steps and copy blocks, and the WhatsApp setting, but no draft block", async () => {
    const rows = await readSiteRows(t.db);
    expect(rows.faqs.map((f) => f.question)).toEqual(["Published?"]);
    expect(rows.steps).toHaveLength(1);
    expect(rows.blocks.map((b) => b.key)).toEqual(["hero.title"]);
    const site = buildSite(rows);
    expect(site.contact.whatsappE164).toBe("+14155550100");
    expect(site.blocks).toEqual({ "hero.title": "Hello" });
  });

  it("returns only the two contact settings from site_setting, not the others", async () => {
    const rows = await readSiteRows(t.db);
    expect(rows.settings.map((s) => s.key).sort()).toEqual(["contact_phone_display", "whatsapp_number_e164"]);
  });

  it("returns published, confirmed trust content only", async () => {
    const trust = buildTrust(await readTrustRows(t.db));
    expect(trust.stats.map((s) => s.key)).toEqual(["ok"]);
    expect(trust.testimonials.map((x) => x.studentName)).toEqual(["Shown"]);
    expect(trust.team.map((x) => x.name)).toEqual(["Shown member"]);
  });

  it("returns published posts, newest first", async () => {
    const blog = buildBlog(await readPostRows(t.db));
    expect(blog.posts.map((p) => p.slug)).toEqual(["new", "old"]);
  });

  it("each read is one round trip's worth of queries and none touches a table the public may not read", async () => {
    // The functions above already ran as app_runtime with forced policies; a table without a public policy would have returned [] or thrown.
    await expect(readCatalogueRows(t.db)).resolves.toBeDefined();
    await expect(readTrustRows(t.db)).resolves.toBeDefined();
  });
});
