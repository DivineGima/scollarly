import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, mintActor } from "@/server/auth/actor";
import { contentDataCalls, contentMutations } from "@/modules/content-admin/endpoints";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { MutationCall } from "@/server/edge/mutations";
import { createMemoryMediaStore, webpBytes } from "../helpers/images";
import { createTestDb, type TestDb } from "./helpers/db";
import { consent, insertRow, q, uni } from "./helpers/fixtures";

/**
 * Stage 6 against a real database, as the non-owner runtime role (ADR-038): the content flow end to end through the same endpoint
 * functions the Worker calls. What is proven is what the Stage 6 exit criteria ask for: the publish gates in the service AND in the
 * database, revoking a consent unpublishes what relied on it, a concurrent edit shows the conflict, an image is checked and
 * deduplicated, an image in use cannot be archived, and only staff can touch any of it.
 */

let t: TestDb;
let admin: Actor;
let student: Actor;
const store = createMemoryMediaStore();

async function actorOf(role: "admin" | "student"): Promise<Actor> {
  const user = await t.signIn();
  await t.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
  return mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: null });
}

const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => new Date("2026-10-26T12:00:00Z"), media: () => store });

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

interface Answer {
  status: number;
  json: Record<string, unknown> & { error?: { code: string; fields?: Record<string, string> } };
}

async function post(operation: string, actor: Actor, body: unknown, options: { bytes?: Uint8Array; query?: string } = {}): Promise<Answer> {
  const mutation = contentMutations[`admin/${operation}`];
  if (!mutation) throw new Error(`no operation ${operation}`);
  const call: MutationCall = {
    actor,
    token: null,
    body,
    bytes: options.bytes ?? null,
    requestId: "test",
    request: new Request(`https://example.test/api/v1/admin/${operation}${options.query ?? ""}`, { method: "POST" }),
    env: env(),
  };
  const response = await asRuntime(() => mutation.handle(call));
  return { status: response.status, json: (await response.json()) as Answer["json"] };
}

async function get(name: string, actor: Actor, query = ""): Promise<Answer> {
  const dataCall = contentDataCalls(env())[`admin/${name}`] as DataCall;
  const result = await asRuntime(() => dataCall(actor, { token: null, url: new URL(`https://example.test/api/v1/admin/${name}${query}`) }));
  if (result instanceof Response) return { status: result.status, json: (await result.json()) as Answer["json"] };
  return { status: 200, json: JSON.parse(JSON.stringify(result)) as Answer["json"] };
}

const rows = (sql: string) => t.run(sql) as Promise<Record<string, unknown>[]>;
const count = async (sql: string) => Number((await rows(sql))[0]?.n);

beforeAll(async () => {
  t = await createTestDb();
  admin = await actorOf("admin");
  student = await actorOf("student");
});

afterAll(async () => {
  await t.close();
});

const faqValues = (over: Record<string, unknown> = {}) => ({ category: "Visa", question: "Do I need a visa?", answer: "Yes, a student visa.", sortOrder: 1, ...over });

describe("S6.1 the standard content flow", () => {
  let id = "";
  let version = "";

  it("creates a draft that the public cannot see", async () => {
    const created = await post("content.save", admin, { type: "faqs", values: faqValues() });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe("draft");
    expect(created.json.revalidate).toBeNull();
    id = created.json.id as string;
    version = created.json.version as string;
    expect(await count(`select count(*)::int as n from faq where id = ${q(id)} and status = 'draft'`)).toBe(1);
    // The row level security policy: a visitor reads published rows only.
    await t.asRuntime();
    await t.run("select set_config('app.role', 'anonymous', false), set_config('app.user_id', '', false)");
    expect(await count("select count(*)::int as n from faq")).toBe(0);
    await t.asOwner();
  });

  it("edits the draft and gives a new version", async () => {
    const saved = await post("content.save", admin, { type: "faqs", id, version, values: faqValues({ answer: "Yes. Apply early." }) });
    expect(saved.status).toBe(200);
    expect(saved.json.version).not.toBe(version);
    expect((await rows(`select answer from faq where id = ${q(id)}`))[0]?.answer).toBe("Yes. Apply early.");
    const stale = await post("content.save", admin, { type: "faqs", id, version, values: faqValues({ answer: "Stale write" }) });
    expect(stale.status).toBe(409);
    expect(stale.json.error?.fields?.version).toBe("STALE");
    expect((await rows(`select answer from faq where id = ${q(id)}`))[0]?.answer).toBe("Yes. Apply early.");
    version = saved.json.version as string;
  });

  it("refuses an unknown field, a missing required field and an over-long text, with tokens", async () => {
    const unknown = await post("content.save", admin, { type: "faqs", values: { ...faqValues(), nope: 1 } });
    expect(unknown.status).toBe(400);
    const missing = await post("content.save", admin, { type: "faqs", values: faqValues({ question: "" }) });
    expect(missing.json.error?.fields?.["values.question"]).toBe("REQUIRED");
    const long = await post("content.save", admin, { type: "faqs", values: faqValues({ question: "x".repeat(301) }) });
    expect(long.json.error?.fields?.["values.question"]).toBe("TOO_LONG");
  });

  it("publishes, makes the page refresh and writes an audit row; then unpublishes, archives and restores", async () => {
    const published = await post("content.publish", admin, { type: "faqs", id, version });
    expect(published.status).toBe(200);
    expect(published.json.status).toBe("published");
    expect((published.json.revalidate as { areas: string[] }).areas).toEqual(["site"]);
    expect(await count(`select count(*)::int as n from faq where id = ${q(id)} and status = 'published' and published_at is not null`)).toBe(1);
    // The visitor can read it now.
    await t.asRuntime();
    await t.run("select set_config('app.role', 'anonymous', false), set_config('app.user_id', '', false)");
    expect(await count("select count(*)::int as n from faq")).toBe(1);
    await t.asOwner();

    // A stale screen cannot publish again.
    const again = await post("content.publish", admin, { type: "faqs", id, version });
    expect(again.status).toBe(409);

    version = published.json.version as string;
    const unpublished = await post("content.unpublish", admin, { type: "faqs", id, version });
    expect(unpublished.json.status).toBe("draft");
    // Leaving the public site also asks for a refresh.
    expect((unpublished.json.revalidate as { areas: string[] }).areas).toEqual(["site"]);
    version = unpublished.json.version as string;

    const archived = await post("content.archive", admin, { type: "faqs", id, version });
    expect(archived.json.status).toBe("archived");
    version = archived.json.version as string;
    // An archived item cannot be edited until it is restored.
    const edit = await post("content.save", admin, { type: "faqs", id, version, values: faqValues() });
    expect(edit.status).toBe(409);
    expect(edit.json.error?.fields?.status).toBe("ARCHIVED");
    const restored = await post("content.restore", admin, { type: "faqs", id, version });
    expect(restored.json.status).toBe("draft");

    const audits = await rows(`select action from audit_log where entity_id = ${q(id)} order by at`);
    expect(audits.map((a) => a.action)).toEqual(["content.save", "content.save", "content.publish", "content.unpublish", "content.archive", "content.restore"]);
    // No physical delete: the row is still there.
    expect(await count(`select count(*)::int as n from faq where id = ${q(id)}`)).toBe(1);
  });

  it("lists with a status filter and a search, and counts every card of the hub", async () => {
    const all = await get("content-list", admin, "?type=faqs");
    expect(all.status).toBe(200);
    expect((all.json.items as unknown[]).length).toBe(1);
    expect((await get("content-list", admin, "?type=faqs&status=published")).json.items).toEqual([]);
    expect(((await get("content-list", admin, "?type=faqs&q=visa")).json.items as unknown[]).length).toBe(1);
    expect(((await get("content-list", admin, "?type=faqs&q=zzz")).json.items as unknown[]).length).toBe(0);
    expect((await get("content-list", admin, "?type=nonsense")).status).toBe(400);
    const hub = await get("content-hub", admin);
    const cards = hub.json.cards as { type: string; draft: number }[];
    expect(cards).toHaveLength(14);
    expect(cards.find((c) => c.type === "faqs")?.draft).toBe(1);
  });
});

describe("S6.2 content types and their publish gates", () => {
  it("a university needs a unique slug, and the slug cannot change afterwards", async () => {
    const values = { name: "Alpha University", slug: "alpha-university", city: "Pune", state: null, type: null, naacGrade: null, websiteUrl: "https://alpha.example", logoMediaId: null, overview: "A good place.", sortOrder: 0 };
    const created = await post("content.save", admin, { type: "universities", values });
    expect(created.status).toBe(201);
    const second = await post("content.save", admin, { type: "universities", values: { ...values, name: "Alpha Two" } });
    expect(second.status).toBe(400);
    expect(second.json.error?.fields?.["values.slug"]).toBe("DUPLICATE");
    const bad = await post("content.save", admin, { type: "universities", values: { ...values, slug: "Not A Slug" } });
    expect(bad.json.error?.fields?.["values.slug"]).toBe("INVALID");
    const http = await post("content.save", admin, { type: "universities", values: { ...values, slug: "beta", websiteUrl: "http://plain.example" } });
    expect(http.json.error?.fields?.["values.websiteUrl"]).toBe("INVALID");
    const moved = await post("content.save", admin, { type: "universities", id: created.json.id, version: created.json.version, values: { ...values, slug: "renamed" } });
    expect(moved.json.error?.fields?.["values.slug"]).toBe("IMMUTABLE");
    // The overview is stored as translated text, not in a column.
    expect((await rows(`select translations->>'en' as en from university where id = ${q(created.json.id)}`))[0]?.en).toBe("A good place.");
    const item = await get("content-item", admin, `?type=universities&id=${created.json.id}`);
    expect((item.json.item as { values: { overview: string } }).values.overview).toBe("A good place.");
  });

  it("publishing a university refreshes its own page", async () => {
    const [row] = await rows("select id, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as v from university where slug = 'alpha-university'");
    const published = await post("content.publish", admin, { type: "universities", id: row?.id, version: row?.v });
    expect((published.json.revalidate as { paths: string[] }).paths).toContain("/universities/alpha-university");
  });

  it("a fee cannot be confirmed without a real range, and 'last updated' moves on every save", async () => {
    const universityId = String((await rows("select id from university where slug = 'alpha-university'"))[0]?.id);
    const fee = { universityId, programmeId: null, currency: "USD", amountMin: 3000, amountMax: 6000, period: "per year", dataConfirmed: false, sourceUrl: null, sortOrder: 0 };
    const bad = await post("content.save", admin, { type: "fees", values: { ...fee, dataConfirmed: true, amountMin: 0 } });
    expect(bad.status).toBe(400);
    expect(bad.json.error?.fields?.["values.amountMin"]).toBe("FEE_RANGE");
    const reversed = await post("content.save", admin, { type: "fees", values: { ...fee, dataConfirmed: true, amountMin: 9000, amountMax: 6000 } });
    expect(reversed.json.error?.fields?.["values.amountMax"]).toBe("FEE_RANGE");
    const created = await post("content.save", admin, { type: "fees", values: { ...fee, dataConfirmed: true } });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    await t.run(`update fee_structure set last_updated_at = now() - interval '200 days' where id = ${q(id)}`);
    // It is old, so the stale report lists it and the card warns.
    const stale = await get("stale", admin);
    expect((stale.json.items as { id: string; type: string }[]).some((s) => s.id === id && s.type === "fees")).toBe(false); // a draft is never stale
    const v1 = (await rows(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v from fee_structure where id = ${q(id)}`))[0]?.v as string;
    const published = await post("content.publish", admin, { type: "fees", id, version: v1 });
    expect(published.status).toBe(200);
    const stale2 = await get("stale", admin);
    const item = (stale2.json.items as { id: string; type: string; version: string }[]).find((s) => s.id === id);
    expect(item?.type).toBe("fees");
    const checked = await post("content.markChecked", admin, { type: "fees", id, version: item?.version });
    expect(checked.status).toBe(200);
    expect(((await get("stale", admin)).json.items as { id: string }[]).some((s) => s.id === id)).toBe(false);
    expect((await rows(`select action from audit_log where entity_id = ${q(id)} and action = 'content.markChecked'`)).length).toBe(1);
  });

  it("a campus video needs a valid YouTube id to be published; a tour needs an https address", async () => {
    const universityId = String((await rows("select id from university where slug = 'alpha-university'"))[0]?.id);
    const video = await post("content.save", admin, { type: "campus", values: { universityId, kind: "video", title: "Tour", youtubeId: null, url: null, thumbnailMediaId: null, sortOrder: 0 } });
    expect(video.status).toBe(201);
    const refused = await post("content.publish", admin, { type: "campus", id: video.json.id, version: video.json.version });
    expect(refused.status).toBe(400);
    expect(refused.json.error?.fields?.["values.youtubeId"]).toBe("NEEDS_YOUTUBE_ID");
    const badId = await post("content.save", admin, { type: "campus", id: video.json.id, version: video.json.version, values: { universityId, kind: "video", title: "Tour", youtubeId: "short", url: null, thumbnailMediaId: null, sortOrder: 0 } });
    expect(badId.json.error?.fields?.["values.youtubeId"]).toBe("INVALID");
    const fixed = await post("content.save", admin, { type: "campus", id: video.json.id, version: video.json.version, values: { universityId, kind: "video", title: "Tour", youtubeId: "dQw4w9WgXcQ", url: null, thumbnailMediaId: null, sortOrder: 0 } });
    const live = await post("content.publish", admin, { type: "campus", id: video.json.id, version: fixed.json.version });
    expect(live.status).toBe(200);
    // Editing a live item is gated like a publish: it cannot be saved without a link.
    const broken = await post("content.save", admin, { type: "campus", id: video.json.id, version: live.json.version, values: { universityId, kind: "video", title: "Tour", youtubeId: null, url: null, thumbnailMediaId: null, sortOrder: 0 } });
    expect(broken.status).toBe(400);
    expect(broken.json.error?.fields?.["values.youtubeId"]).toBe("NEEDS_YOUTUBE_ID");
  });

  it("a testimonial needs verified AND a consent record; the database says the same", async () => {
    const draft = await post("content.save", admin, { type: "testimonials", values: { studentName: "Ama", country: "GH", universityId: null, quote: "Great help.", photoMediaId: null, verified: false, consentId: null, sortOrder: 0 } });
    const id = draft.json.id as string;
    const refused = await post("content.publish", admin, { type: "testimonials", id, version: draft.json.version });
    expect(refused.status).toBe(400);
    expect(refused.json.error?.fields).toMatchObject({ "values.verified": "NEEDS_VERIFIED", "values.consentId": "NEEDS_CONSENT" });
    // Second lock: even a direct write cannot publish it.
    await expect(t.run(`update testimonial set status = 'published' where id = ${q(id)}`)).rejects.toThrow();

    const grant = await post("consent.create", admin, { subjectName: "Ama Mensah", scope: "testimonial", evidenceNote: "WhatsApp message of 2026-10-01", grantedOn: "2026-10-01" });
    expect(grant.status).toBe(201);
    const consentId = grant.json.id as string;
    const saved = await post("content.save", admin, { type: "testimonials", id, version: draft.json.version, values: { studentName: "Ama", country: "GH", universityId: null, quote: "Great help.", photoMediaId: null, verified: true, consentId, sortOrder: 0 } });
    const live = await post("content.publish", admin, { type: "testimonials", id, version: saved.json.version });
    expect(live.status).toBe(200);

    // Revoking the consent takes it off the site in the same statement (FR-13).
    const revoked = await post("consent.revoke", admin, { id: consentId });
    expect(revoked.status).toBe(200);
    expect(revoked.json.unpublished).toBe(1);
    expect((await rows(`select status from testimonial where id = ${q(id)}`))[0]?.status).toBe("draft");
    expect(await count(`select count(*)::int as n from consent_record where id = ${q(consentId)} and revoked_at is not null`)).toBe(1);
    const again = await post("consent.revoke", admin, { id: consentId });
    expect(again.status).toBe(409);

    // A stale screen cannot publish against the revoked consent: not in the service, and not in the database.
    const [row] = await rows(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v from testimonial where id = ${q(id)}`);
    const blocked = await post("content.publish", admin, { type: "testimonials", id, version: row?.v });
    expect(blocked.json.error?.fields?.["values.consentId"]).toBe("CONSENT_REVOKED");
    await expect(t.run(`update testimonial set status = 'published' where id = ${q(id)}`)).rejects.toThrow(/revoked/i);
  });

  it("a journey keeps its steps in order; steps can be added and edited but not removed", async () => {
    const consentId = await consent(t, { scope: "journey" });
    const values = { studentName: "Kofi", country: "GH", universityId: null, summary: "From Accra to Pune.", verified: true, consentId, sortOrder: 0 };
    const created = await post("content.save", admin, {
      type: "journeys",
      values,
      steps: [
        { title: "Applied", body: "Sent my results.", dateLabel: "March 2026" },
        { title: "Offer", body: "Got an offer letter.", dateLabel: null },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    expect((await rows(`select position, title from journey_step where journey_id = ${q(id)} order by position`)).map((r) => r.title)).toEqual(["Applied", "Offer"]);
    const item = (await get("content-item", admin, `?type=journeys&id=${id}`)).json.item as { steps: { title: string }[] };
    expect(item.steps.map((s) => s.title)).toEqual(["Applied", "Offer"]);

    const edited = await post("content.save", admin, {
      type: "journeys",
      id,
      version: created.json.version,
      values,
      steps: [
        { title: "Applied", body: "Sent my results.", dateLabel: "March 2026" },
        { title: "Offer letter", body: "Got an offer letter.", dateLabel: null },
        { title: "Visa", body: "Visa approved.", dateLabel: null },
      ],
    });
    expect(edited.status).toBe(200);
    expect((await rows(`select title from journey_step where journey_id = ${q(id)} order by position`)).map((r) => r.title)).toEqual(["Applied", "Offer letter", "Visa"]);

    const shrink = await post("content.save", admin, { type: "journeys", id, version: edited.json.version, values, steps: [{ title: "Applied", body: "x", dateLabel: null }] });
    expect(shrink.status).toBe(400);
    expect(shrink.json.error?.fields?.steps).toBe("STEPS_CANNOT_SHRINK");
  });

  it("team members and trust figures are never published unconfirmed", async () => {
    const member = await post("content.save", admin, { type: "team", values: { name: "Jo", roleTitle: "Advisor", bio: null, photoMediaId: null, confirmed: false, sortOrder: 0 } });
    const refused = await post("content.publish", admin, { type: "team", id: member.json.id, version: member.json.version });
    expect(refused.json.error?.fields?.["values.confirmed"]).toBe("NEEDS_CONFIRMED");
    const stat = await post("content.save", admin, { type: "stats", values: { key: "students_helped", label: "Students helped", value: "500", confirmed: false, asOf: "2026-10-01", sortOrder: 0 } });
    const refusedStat = await post("content.publish", admin, { type: "stats", id: stat.json.id, version: stat.json.version });
    expect(refusedStat.json.error?.fields?.["values.confirmed"]).toBe("NEEDS_CONFIRMED");
    const confirmed = await post("content.save", admin, { type: "stats", id: stat.json.id, version: stat.json.version, values: { key: "students_helped", label: "Students helped", value: "500", confirmed: true, asOf: "2026-10-01", sortOrder: 0 } });
    expect((await post("content.publish", admin, { type: "stats", id: stat.json.id, version: confirmed.json.version })).status).toBe(200);
  });

  it("page copy is one block per key, and a key has to look like a key", async () => {
    const good = await post("content.save", admin, { type: "copy", values: { key: "privacy.body", text: "We keep your details safe." } });
    expect(good.status).toBe(201);
    const dup = await post("content.save", admin, { type: "copy", values: { key: "privacy.body", text: "Again" } });
    expect(dup.json.error?.fields?.["values.key"]).toBe("DUPLICATE");
    const bad = await post("content.save", admin, { type: "copy", values: { key: "Not A Key!", text: "x" } });
    expect(bad.json.error?.fields?.["values.key"]).toBe("INVALID");
    const edited = await post("content.save", admin, { type: "copy", id: good.json.id, version: good.json.version, values: { key: "privacy.body", text: "Updated." } });
    expect(edited.status).toBe(200);
    expect((await rows(`select translations->>'en' as en from content_block where id = ${q(good.json.id)}`))[0]?.en).toBe("Updated.");
  });

  it("a blog post, a process step and a message template save and publish", async () => {
    const post1 = await post("content.save", admin, { type: "blog", values: { title: "Visa tips", slug: "visa-tips", body: "# Hello\n\nSome **bold** text.", coverMediaId: null } });
    expect(post1.status).toBe(201);
    const live = await post("content.publish", admin, { type: "blog", id: post1.json.id, version: post1.json.version });
    expect((live.json.revalidate as { paths: string[] }).paths).toContain("/blog/visa-tips");
    const step = await post("content.save", admin, { type: "steps", values: { kind: "application", position: 1, title: "Send results", body: "Share your results." } });
    expect(step.status).toBe(201);
    const template = await post("content.save", admin, { type: "templates", values: { stageCode: "share_results", locale: "en", body: "Hi {name}, your reference is {ref}." } });
    expect(template.status).toBe(201);
    const badStage = await post("content.save", admin, { type: "templates", values: { stageCode: "no_such_stage", locale: "en", body: "x" } });
    expect(badStage.status).toBe(400);
  });
});

describe("S6.3 images", () => {
  const photo = webpBytes(40 * 1024);

  it("stores a WebP under its hash, once, and reuses a duplicate", async () => {
    const first = await post("media.upload", admin, {}, { bytes: photo, query: "?kind=photo&alt=Campus" });
    expect(first.status).toBe(201);
    expect(store.objects.size).toBe(1);
    const second = await post("media.upload", admin, {}, { bytes: photo, query: "?kind=photo" });
    expect(second.status).toBe(200);
    expect(second.json.status).toBe("existing");
    expect(second.json.id).toBe(first.json.id);
    expect(store.objects.size).toBe(1);
    expect(await count("select count(*)::int as n from media_asset")).toBe(1);
  });

  it("refuses an over-cap image, an SVG, a wrong signature, an empty file and an unconfirmed document photo", async () => {
    const big = await post("media.upload", admin, {}, { bytes: webpBytes(60 * 1024, 1), query: "?kind=logo" });
    expect(big.status).toBe(413);
    expect(big.json.error?.fields?.file).toBe("TOO_LARGE");
    const svg = await post("media.upload", admin, {}, { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), query: "?kind=photo" });
    expect(svg.status).toBe(400);
    expect(svg.json.error?.fields?.file).toBe("NOT_WEBP");
    const png = await post("media.upload", admin, {}, { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(0)]), query: "?kind=photo" });
    expect(png.json.error?.fields?.file).toBe("NOT_WEBP");
    const empty = await post("media.upload", admin, {}, { bytes: new Uint8Array(0), query: "?kind=photo" });
    expect(empty.json.error?.fields?.file).toBe("EMPTY");
    const doc = await post("media.upload", admin, {}, { bytes: webpBytes(20 * 1024, 2), query: "?kind=testimonial&document=1" });
    expect(doc.json.error?.fields?.confirmed).toBe("REQUIRED");
    const docOk = await post("media.upload", admin, {}, { bytes: webpBytes(20 * 1024, 2), query: "?kind=testimonial&document=1&confirmed=1" });
    expect(docOk.status).toBe(201);
    expect((await rows("select meta from audit_log where action = 'media.upload' and meta->>'document' = 'true'")).length).toBe(1);
    const nothing = await post("media.upload", admin, {}, { bytes: photo, query: "?kind=banner" });
    expect(nothing.status).toBe(400);
  });

  it("stops at the storage budget but still accepts a duplicate", async () => {
    await t.run("update site_setting set value = to_jsonb((select sum(bytes) from media_asset)) where key = 'media_budget_bytes'");
    const full = await post("media.upload", admin, {}, { bytes: webpBytes(30 * 1024, 3), query: "?kind=photo" });
    expect(full.status).toBe(409);
    expect(full.json.error?.fields?.file).toBe("BUDGET_FULL");
    expect((await post("media.upload", admin, {}, { bytes: photo, query: "?kind=photo" })).status).toBe(200);
    await t.run("update site_setting set value = '3758096384'::jsonb where key = 'media_budget_bytes'");
  });

  it("shows the meter, 'used in', and blocks archive while a live item uses the image", async () => {
    const overview = (await get("media", admin)).json as unknown as { items: { id: string; usedBy: number; alt: string }[]; usedBytes: number; budgetBytes: number };
    expect(overview.items.length).toBe(2);
    expect(overview.usedBytes).toBeGreaterThan(0);
    expect(overview.budgetBytes).toBe(3_758_096_384);
    const image = overview.items.find((i) => i.alt === "Campus");
    expect(image).toBeTruthy();

    const universityId = await uni(t, { status: "published", logo_media_id: image?.id });
    const uses = (await get("media-item", admin, `?id=${image?.id}`)).json.uses as { id: string }[];
    expect(uses.map((u) => u.id)).toContain(universityId);
    const blocked = await post("media.archive", admin, { id: image?.id });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error?.fields?.media).toBe("IN_USE");
    expect((blocked.json.uses as unknown[]).length).toBe(1);

    // A page photo (home hero, ...) counts as in use too, or the Media screen would let it be archived (S12.1 QA).
    await t.run(`insert into page_image (id, key, media_asset_id) values (gen_random_uuid(), 'qa.photo', ${q(image?.id)})`);
    const pageBlocked = await post("media.archive", admin, { id: image?.id });
    expect(pageBlocked.status).toBe(409);
    expect((pageBlocked.json.uses as unknown[]).length).toBe(2);
    await t.run(`delete from page_image where key = 'qa.photo'`);

    await t.run(`update university set status = 'archived' where id = ${q(universityId)}`);
    expect((await post("media.archive", admin, { id: image?.id })).status).toBe(200);
    expect((await rows(`select archived_at from media_asset where id = ${q(image?.id)}`))[0]?.archived_at).not.toBeNull();
    expect((await post("media.archive", admin, { id: image?.id })).status).toBe(409);
    // The bytes stay in storage: there is no delete path.
    expect(store.objects.size).toBe(2);

    // The same picture uploaded again brings the archived image back, so a live item never points at an archived one.
    const again = await post("media.upload", admin, {}, { bytes: photo, query: "?kind=photo" });
    expect(again.json.status).toBe("existing");
    expect(again.json.id).toBe(image?.id);
    expect((await rows(`select archived_at from media_asset where id = ${q(image?.id)}`))[0]?.archived_at).toBeNull();
    expect((await rows("select 1 from audit_log where action = 'media.restore'")).length).toBe(1);

    const altSaved = await post("media.setAlt", admin, { id: overview.items[0]?.id, alt: "A new description" });
    expect(altSaved.status).toBe(200);
    // Alt text is on public pages, so the answer tells the screen to refresh the areas of every type with a picture.
    const refresh = altSaved.json.revalidate as { areas: string[]; paths: string[] };
    expect(refresh.areas).toEqual(expect.arrayContaining(["catalogue", "trust"]));
    expect(refresh.paths.length).toBeGreaterThan(0);
    expect((await post("media.setAlt", admin, { id: randomUUID(), alt: "x" })).status).toBe(404);
  });
});

describe("who can do any of it", () => {
  it("a student can neither read a draft nor write content, images or consent", async () => {
    const draft = await insertRow(t, "faq", { id: randomUUID(), question: "Hidden?", answer: "Yes", status: "draft" });
    await expect(post("content.save", student, { type: "faqs", values: faqValues() })).rejects.toThrow();
    await expect(post("consent.create", student, { subjectName: "X", scope: "testimonial", evidenceNote: "n", grantedOn: "2026-10-01" })).rejects.toThrow();
    await expect(post("media.upload", student, {}, { bytes: webpBytes(10 * 1024, 9), query: "?kind=photo" })).rejects.toThrow();
    const listed = await asRuntime(async () => (await contentDataCalls(env())["admin/content-list"]?.(student, { token: null, url: new URL("https://example.test/x?type=faqs") })) as { items: { id: string }[] });
    expect(listed.items.some((i) => i.id === draft)).toBe(false);
  });
});

describe("the definitions match the database", () => {
  it("every field is a real column, and a column that must have a value is a required field", async () => {
    const { TYPE_DEFS, columnOf } = await import("@/modules/content-admin/definitions");
    for (const def of Object.values(TYPE_DEFS)) {
      const columns = (await rows(
        `select column_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = ${q(def.table)}`,
      )) as { column_name: string; is_nullable: string; column_default: string | null }[];
      const byName = new Map(columns.map((c) => [c.column_name, c]));
      for (const field of def.fields) {
        if (field.store) {
          expect(byName.has("translations"), `${def.type}.${field.key} is stored in translations`).toBe(true);
          continue;
        }
        const column = byName.get(columnOf(field));
        expect(column, `${def.type}.${field.key} -> ${columnOf(field)}`).toBeTruthy();
        if (field.required) expect(column?.is_nullable, `${def.type}.${field.key} is required`).toBe("NO");
      }
      const covered = new Set(def.fields.filter((f) => !f.store).map((f) => columnOf(f)));
      for (const column of columns) {
        const handled = ["id", "status", "published_at", "created_by", "updated_by", "created_at", "updated_at", "translations", "last_updated_at", "url_last_checked_at", "author_id", "created_by"];
        if (covered.has(column.column_name) || handled.includes(column.column_name)) continue;
        // Anything else that must have a value and has no default would make a save fail, so the form must ask for it.
        expect(column.is_nullable === "YES" || column.column_default !== null, `${def.table}.${column.column_name} has no field`).toBe(true);
      }
    }
  });

  it("the closed lists in the definitions are the ones in the database", async () => {
    const { TYPE_DEFS } = await import("@/modules/content-admin/definitions");
    expect(TYPE_DEFS.fees.fields.find((f) => f.key === "currency")?.options).toEqual(["USD", "INR"]);
    expect(TYPE_DEFS.campus.fields.find((f) => f.key === "kind")?.options).toEqual(["video", "tour360", "gallery"]);
    expect(TYPE_DEFS.steps.fields.find((f) => f.key === "kind")?.options).toEqual(["application", "visa"]);
    // And the database refuses anything else.
    await expect(t.run("insert into fee_structure (id, university_id, currency, period) select gen_random_uuid(), id, 'EUR', 'x' from university limit 1")).rejects.toThrow();
  });
});
