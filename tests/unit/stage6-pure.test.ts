import { describe, expect, it, vi } from "vitest";
import { classifyFile, attempts, fitWithin, normaliseRedaction } from "@/lib/client/image";
import { IMAGE_CAPS } from "@/lib/image-caps";
import { revalidationFor } from "@/modules/content-admin/endpoints";
import { CONTENT_TYPE_KEYS, COPY_KEY_PATTERN, columnOf, TYPE_DEFS } from "@/modules/content-admin/definitions";
import { consentCreateBody, listQuery, publishIssues, saveBodyFor, saveIssues, stepsSchema, uploadQuery, valuesSchema, versionSchema } from "@/modules/content-admin/schema";
import { AuthError, type Actor, mintActor } from "@/server/auth/actor";
import { canonicalShellPath } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleMutation, type Mutation, type MutationDeps } from "@/server/edge/mutations";
import { handleRevalidate, type RevalidateDeps } from "@/server/edge/revalidate";
import { contentRoute } from "@/components/admin/content/shared";
import { slugify, toPayload, toRaw } from "@/components/admin/content/field-inputs";

const admin: Actor = mintActor({ userId: "a1", sessionId: "s1", storedRole: "admin", role: "admin", twoFactorVerifiedAt: null });

describe("S6.1 the content definitions", () => {
  it("has the fourteen types of architecture 7.3, each with a table, fields and an order", () => {
    expect(CONTENT_TYPE_KEYS).toHaveLength(14);
    for (const type of CONTENT_TYPE_KEYS) {
      const def = TYPE_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.table).toMatch(/^[a-z_]+$/);
      expect(def.order).toMatch(/^t\./);
      expect(new Set(def.fields.map((f) => f.key)).size).toBe(def.fields.length);
    }
  });

  it("every gate names a field the type has, and every select has options", () => {
    for (const def of Object.values(TYPE_DEFS)) {
      const keys = new Set(def.fields.map((f) => f.key));
      for (const gate of def.gates) {
        if (gate.kind === "required" || gate.kind === "confirmed") expect(keys.has(gate.field), `${def.type}.${gate.field}`).toBe(true);
      }
      for (const field of def.fields) if (field.kind === "select") expect(field.options?.length, `${def.type}.${field.key}`).toBeGreaterThan(0);
    }
  });

  it("derives the database column from the field name", () => {
    expect(columnOf({ key: "universityId", kind: "ref" })).toBe("university_id");
    expect(columnOf({ key: "naacGrade", kind: "text" })).toBe("naac_grade");
    expect(columnOf({ key: "amountMin", kind: "money" })).toBe("amount_min");
  });

  it("the public gates are the rules of the guardrails: unconfirmed and unconsented items never publish", () => {
    expect(TYPE_DEFS.testimonials.gates).toContainEqual({ kind: "verifiedAndConsent" });
    expect(TYPE_DEFS.journeys.gates).toContainEqual({ kind: "verifiedAndConsent" });
    expect(TYPE_DEFS.team.gates).toContainEqual({ kind: "confirmed", field: "confirmed" });
    expect(TYPE_DEFS.stats.gates).toContainEqual({ kind: "confirmed", field: "confirmed" });
    expect(TYPE_DEFS.fees.gates).toContainEqual({ kind: "feeRange" });
    expect(TYPE_DEFS.campus.gates).toContainEqual({ kind: "campusLink" });
  });
});

describe("the Zod definitions built from them", () => {
  const faq = valuesSchema(TYPE_DEFS.faqs);

  it("turns blank optional text into null and trims", () => {
    const parsed = faq.parse({ category: "  ", question: "  Why?  ", answer: "Because.", sortOrder: "" });
    expect(parsed).toMatchObject({ category: null, question: "Why?", sortOrder: null });
  });

  it("answers with tokens, never sentences", () => {
    const result = faq.safeParse({ question: "", answer: "x".repeat(5001), sortOrder: 1.5 });
    expect(result.success).toBe(false);
    const byPath = Object.fromEntries((result.error?.issues ?? []).map((i) => [String(i.path[0]), i.message]));
    expect(byPath).toMatchObject({ question: "REQUIRED", answer: "TOO_LONG", sortOrder: "INVALID" });
  });

  it("refuses an unknown field", () => {
    expect(faq.safeParse({ question: "q", answer: "a", extra: 1 }).success).toBe(false);
  });

  it("checks slugs, https links, YouTube codes and dates", () => {
    const uni = valuesSchema(TYPE_DEFS.universities);
    const base = { name: "A", slug: "a-b", websiteUrl: "https://a.example" };
    expect(uni.safeParse(base).success).toBe(true);
    for (const slug of ["A", "a b", "-a", "a-", "a--b", "é"]) expect(uni.safeParse({ ...base, slug }).success, slug).toBe(false);
    for (const websiteUrl of ["http://a.example", "javascript:alert(1)", "https://user:pw@a.example", "a.example", "https://nodot"]) {
      expect(uni.safeParse({ ...base, websiteUrl }).success, websiteUrl).toBe(false);
    }
    const campus = valuesSchema(TYPE_DEFS.campus);
    const c = { universityId: "0193a8c0-0000-7000-8000-000000000001", kind: "video", title: "T" };
    expect(campus.safeParse({ ...c, youtubeId: "dQw4w9WgXcQ" }).success).toBe(true);
    expect(campus.safeParse({ ...c, youtubeId: "short" }).success).toBe(false);
    expect(valuesSchema(TYPE_DEFS.stats).safeParse({ key: "students_helped", label: "L", value: "1", asOf: "2026-02-30x" }).success).toBe(false);
  });

  it("allows two decimals in money and nothing finer", () => {
    const fees = valuesSchema(TYPE_DEFS.fees);
    const base = { universityId: "0193a8c0-0000-7000-8000-000000000001", currency: "USD", period: "per year" };
    expect(fees.safeParse({ ...base, amountMin: 1920.5, amountMax: 3000 }).success).toBe(true);
    expect(fees.safeParse({ ...base, amountMin: 1920.555 }).success).toBe(false);
    expect(fees.safeParse({ ...base, amountMin: -1 }).success).toBe(false);
    expect(fees.safeParse({ ...base, currency: "EUR" }).success).toBe(false);
  });

  it("the save body needs an id and a version together, and only a journey has steps", () => {
    const body = saveBodyFor(TYPE_DEFS.faqs);
    const values = { question: "q", answer: "a" };
    expect(body.safeParse({ type: "faqs", values }).success).toBe(true);
    expect(body.safeParse({ type: "faqs", id: "0193a8c0-0000-7000-8000-000000000001", values }).success).toBe(false);
    expect(body.safeParse({ type: "faqs", id: "0193a8c0-0000-7000-8000-000000000001", version: "2026-10-26T12:00:00.123456Z", values }).success).toBe(true);
    expect(body.safeParse({ type: "faqs", values, steps: [] }).success).toBe(false);
    expect(saveBodyFor(TYPE_DEFS.journeys).safeParse({ type: "journeys", values: { studentName: "K", summary: "s" }, steps: [{ title: "t", body: "b" }] }).success).toBe(true);
    expect(versionSchema.safeParse("2026-10-26T12:00:00.123Z").success).toBe(false);
  });

  it("limits steps and requires a title and a text for each", () => {
    expect(stepsSchema.safeParse(Array.from({ length: 31 }, () => ({ title: "t", body: "b" }))).success).toBe(false);
    expect(stepsSchema.safeParse([{ title: "", body: "b" }]).success).toBe(false);
    expect(stepsSchema.parse([{ title: "t", body: "b", dateLabel: " " }])[0]?.dateLabel).toBeNull();
  });

  it("page-copy and trust-figure keys look like keys", () => {
    for (const ok of ["privacy.body", "site.tagline", "students_helped", "why.free.title"]) expect(COPY_KEY_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["Privacy", "a b", ".a", "a.", "a..b", "1a"]) expect(COPY_KEY_PATTERN.test(bad), bad).toBe(false);
  });

  it("the queries are strict and the consent record needs to say how consent was given", () => {
    expect(listQuery.safeParse({ type: "faqs", status: "draft", q: "visa" }).success).toBe(true);
    expect(listQuery.safeParse({ type: "faqs", other: "x" }).success).toBe(false);
    expect(listQuery.safeParse({ type: "nope" }).success).toBe(false);
    expect(uploadQuery.safeParse({ kind: "photo", document: "1", confirmed: "1" }).success).toBe(true);
    expect(uploadQuery.safeParse({ kind: "banner" }).success).toBe(false);
    expect(consentCreateBody.safeParse({ subjectName: "A", scope: "testimonial", evidenceNote: "", grantedOn: "2026-10-01" }).success).toBe(false);
    expect(consentCreateBody.safeParse({ subjectName: "A", scope: "testimonial", evidenceNote: "WhatsApp, 1 Oct", grantedOn: "2026-10-01" }).success).toBe(true);
  });
});

describe("S6.2 the publish gates", () => {
  it("a testimonial needs verified AND a consent that is still in force", () => {
    const def = TYPE_DEFS.testimonials;
    expect(publishIssues(def, { quote: "q", verified: false, consentId: null })).toEqual({ verified: "NEEDS_VERIFIED", consentId: "NEEDS_CONSENT" });
    expect(publishIssues(def, { quote: "q", verified: true, consentId: "c" })).toEqual({});
    expect(publishIssues(def, { quote: "q", verified: true, consentId: "c" }, { consentRevoked: true })).toEqual({ consentId: "CONSENT_REVOKED" });
  });

  it("team members and trust figures need Confirmed", () => {
    expect(publishIssues(TYPE_DEFS.team, { confirmed: false })).toEqual({ confirmed: "NEEDS_CONFIRMED" });
    expect(publishIssues(TYPE_DEFS.stats, { confirmed: true })).toEqual({});
  });

  it("a confirmed fee needs 0 < min <= max; an unconfirmed one may be empty", () => {
    const def = TYPE_DEFS.fees;
    const base = { universityId: "u" };
    expect(publishIssues(def, { ...base, dataConfirmed: false, amountMin: null, amountMax: null })).toEqual({});
    for (const [min, max] of [[0, 5], [null, 5], [5, null], [9, 5]] as const) {
      expect(publishIssues(def, { ...base, dataConfirmed: true, amountMin: min, amountMax: max }), `${min},${max}`).toEqual({ amountMin: "FEE_RANGE", amountMax: "FEE_RANGE" });
    }
    expect(publishIssues(def, { ...base, dataConfirmed: true, amountMin: 3000, amountMax: 3000 })).toEqual({});
    // A confirmed draft is checked at save too, because the database rule applies to every status.
    expect(saveIssues(def, { dataConfirmed: true, amountMin: 0, amountMax: 1 })).toEqual({ amountMin: "FEE_RANGE", amountMax: "FEE_RANGE" });
    expect(saveIssues(TYPE_DEFS.faqs, {})).toEqual({});
  });

  it("a video needs an 11 character code and a tour or gallery an https link", () => {
    const def = TYPE_DEFS.campus;
    expect(publishIssues(def, { title: "T", kind: "video", youtubeId: null })).toEqual({ youtubeId: "NEEDS_YOUTUBE_ID" });
    expect(publishIssues(def, { title: "T", kind: "video", youtubeId: "dQw4w9WgXcQ" })).toEqual({});
    expect(publishIssues(def, { title: "T", kind: "tour360", url: "http://x.example/t" })).toEqual({ url: "NEEDS_HTTPS_URL" });
    expect(publishIssues(def, { title: "T", kind: "gallery", url: "https://x.example/g" })).toEqual({});
  });

  it("a required field that is blank blocks the publish", () => {
    expect(publishIssues(TYPE_DEFS.faqs, { question: "q", answer: "  " })).toEqual({ answer: "REQUIRED" });
  });
});

describe("S6.4 what a change refreshes", () => {
  it("a university refreshes the catalogue, trust and its own page", () => {
    const r = revalidationFor(TYPE_DEFS.universities, "alpha");
    expect(r.areas).toEqual(["catalogue", "trust"]);
    expect(r.paths).toContain("/universities/alpha");
    expect(r.paths).toContain("/universities");
  });
  it("a fee refreshes its university's page; a blog post its own page; staff-only templates nothing", () => {
    expect(revalidationFor(TYPE_DEFS.fees, "alpha").paths).toContain("/universities/alpha");
    expect(revalidationFor(TYPE_DEFS.blog, "tips").paths).toContain("/blog/tips");
    expect(revalidationFor(TYPE_DEFS.templates, null)).toEqual({ areas: [], paths: [] });
  });
  it("page copy and FAQs refresh the site area", () => {
    expect(revalidationFor(TYPE_DEFS.copy, null).areas).toEqual(["site"]);
    expect(revalidationFor(TYPE_DEFS.faqs, null).paths).toContain("/faq");
  });
});

describe("the shell of an item", () => {
  it("every item of a type, and a new one, share one prerendered shell", () => {
    const id = "0193a8c0-0000-7000-8000-000000000001";
    expect(canonicalShellPath(`/admin/content/universities/${id}`)).toBe("/admin/content/universities/_");
    expect(canonicalShellPath(`/en/admin/content/faqs/${id.toUpperCase()}/`)).toBe("/en/admin/content/faqs/_");
    expect(canonicalShellPath("/admin/content/blog/new")).toBe("/admin/content/blog/_");
    // The list, the images and the stale pages keep their own shells.
    for (const path of ["/admin/content", "/admin/content/universities", "/admin/content/media", "/admin/content/stale", "/admin/content/media/new-thing"]) {
      expect(canonicalShellPath(path), path).toBe(path);
    }
  });

  it("reads the type and the id from the address", () => {
    expect(contentRoute("/admin/content/faqs/new")).toEqual({ type: "faqs", id: "new" });
    expect(contentRoute("/en/admin/content/blog")).toEqual({ type: "blog", id: null });
    expect(contentRoute("/admin/content/media")).toEqual({ type: null, id: null });
  });
});

describe("the form's conversion helpers", () => {
  it("round trips values through text and back", () => {
    const def = TYPE_DEFS.fees;
    const raw = toRaw(def, { universityId: "u", currency: "USD", amountMin: 1920.5, amountMax: null, period: "yr", dataConfirmed: true, sortOrder: 0 });
    expect(raw).toMatchObject({ amountMin: "1920.5", amountMax: "", dataConfirmed: true, sortOrder: "0" });
    expect(toPayload(def, raw)).toMatchObject({ amountMin: 1920.5, amountMax: null, dataConfirmed: true, sortOrder: 0 });
    // Text that is not a number stays text, so the Zod check names the field.
    expect(toPayload(def, { ...raw, amountMin: "12x" }).amountMin).toBe("12x");
  });
  it("makes a URL piece from a name", () => {
    expect(slugify("Jain University (Bengaluru)")).toBe("jain-university-bengaluru");
    expect(slugify("  École  Supérieure ")).toBe("ecole-superieure");
    expect(slugify("---")).toBe("");
    expect(slugify("x".repeat(200))).toHaveLength(80);
  });
});

describe("S6.3 the browser's picture rules", () => {
  it("refuses SVG and anything that is not a picture, and a source too big to open", () => {
    expect(classifyFile({ name: "a.svg", type: "image/svg+xml", size: 10 })).toBe("SVG");
    expect(classifyFile({ name: "a.SVG", type: "", size: 10 })).toBe("SVG");
    expect(classifyFile({ name: "a.pdf", type: "application/pdf", size: 10 })).toBe("NOT_IMAGE");
    expect(classifyFile({ name: "a.jpg", type: "image/jpeg", size: 30 * 1024 * 1024 })).toBe("SOURCE_TOO_BIG");
    expect(classifyFile({ name: "a.jpg", type: "image/jpeg", size: 3 * 1024 * 1024 })).toBeNull();
  });
  it("fits a picture inside the longest side without stretching it", () => {
    expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
    expect(fitWithin(300, 400, 1000)).toEqual({ width: 300, height: 400 });
    expect(fitWithin(5000, 1, 100)).toEqual({ width: 100, height: 1 });
  });
  it("tries smaller and lower quality, never bigger", () => {
    const list = attempts(1280);
    expect(list[0]).toEqual({ quality: 0.85, maxSide: 1280 });
    for (let i = 1; i < list.length; i += 1) expect(list[i]?.maxSide ?? 0).toBeLessThanOrEqual(list[i - 1]?.maxSide ?? 0);
    expect(Math.min(...list.map((a) => a.maxSide))).toBeGreaterThanOrEqual(64);
  });
  it("normalises a dragged area and drops one that is too small", () => {
    expect(normaliseRedaction({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 })).toMatchObject({ x: 0.3, y: 0.4, w: expect.closeTo(0.2, 6), h: expect.closeTo(0.1, 6) });
    expect(normaliseRedaction({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })).toMatchObject({ x: 0.9, y: 0.9 });
    expect(normaliseRedaction({ x: 0.1, y: 0.1, w: 0.01, h: 0.5 })).toBeNull();
  });
  it("the caps are 300 KB for photos and 50 KB for logos (FR-18)", () => {
    expect(IMAGE_CAPS.photo).toBe(300 * 1024);
    expect(IMAGE_CAPS.logo).toBe(50 * 1024);
  });
});

describe("POST /api/v1/admin/revalidate (S6.4)", () => {
  const deps = (over: Partial<RevalidateDeps> = {}): RevalidateDeps & { revalidate: ReturnType<typeof vi.fn>; purge: ReturnType<typeof vi.fn> } => ({
    requireAdmin: vi.fn(async () => admin),
    revalidate: vi.fn(),
    purge: vi.fn(async () => true),
    ...over,
  }) as RevalidateDeps & { revalidate: ReturnType<typeof vi.fn>; purge: ReturnType<typeof vi.fn> };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://x.example/api/v1/admin/revalidate", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("marks the areas stale and purges only public pages", async () => {
    const d = deps();
    const response = await handleRevalidate(post({ areas: ["catalogue", "trust"], paths: ["/universities", "/universities/alpha", "/admin", "/api/v1/leads", "universities", "/media/" + "a".repeat(64)] }), d);
    expect(response.status).toBe(200);
    expect(d.revalidate).toHaveBeenCalledWith("catalogue", "trust");
    expect(d.purge.mock.calls.map((c) => c[0])).toEqual(["https://x.example/universities", "https://x.example/universities/alpha"]);
  });

  it("is for admins only and says so before reading anything", async () => {
    const d = deps({ requireAdmin: vi.fn(async () => { throw new AuthError("UNAUTHENTICATED", "Sign in required."); }) });
    expect((await handleRevalidate(post({ areas: [], paths: [] }), d)).status).toBe(401);
    const forbidden = deps({ requireAdmin: vi.fn(async () => { throw new AuthError("FORBIDDEN", "Not allowed."); }) });
    expect((await handleRevalidate(post({ areas: [], paths: [] }), forbidden)).status).toBe(403);
    expect(forbidden.revalidate).not.toHaveBeenCalled();
  });

  it("refuses another origin, an unknown area, extra fields and a broken body", async () => {
    const d = deps();
    expect((await handleRevalidate(post({ areas: [], paths: [] }, { origin: "https://evil.example" }), d)).status).toBe(403);
    expect((await handleRevalidate(post({ areas: ["everything"], paths: [] }), d)).status).toBe(400);
    expect((await handleRevalidate(post({ areas: [], paths: [], extra: 1 }), d)).status).toBe(400);
    expect((await handleRevalidate(new Request("https://x.example/x", { method: "POST", body: "{not json" }), d)).status).toBe(400);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("answers 503 with a retry hint when the session lookup itself fails, and 500 when the revalidation fails", async () => {
    const broken = deps({ requireAdmin: vi.fn(async () => { throw new Error("neon down: secret"); }) });
    const unavailable = await handleRevalidate(post({ areas: [], paths: [] }), broken);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("retry-after")).toBe("5");
    expect(await unavailable.text()).not.toContain("secret");
    const failing = deps({ revalidate: vi.fn(() => { throw new Error("cache down"); }) });
    expect((await handleRevalidate(post({ areas: ["site"], paths: [] }), failing)).status).toBe(500);
  });
});

describe("a binary operation (the image upload)", () => {
  const NOW = new Date("2026-10-26T12:00:00Z");
  const env = { db: {}, ownerEmail: "", totpKey: "", now: () => NOW } as unknown as EndpointEnv;

  function run(over: { actor?: Actor | null; maxBytes?: number; body?: Uint8Array; headers?: Record<string, string> } = {}) {
    const handle = vi.fn(async ({ bytes }: { bytes: Uint8Array | null }) => new Response(JSON.stringify({ length: bytes?.byteLength ?? -1 }), { status: 201 }));
    const mutation: Mutation = { access: { kind: "role", role: "admin" }, binary: { maxBytes: over.maxBytes ?? 1000 }, handle: handle as Mutation["handle"] };
    const deps: MutationDeps = { checkSession: async () => (over.actor === undefined ? admin : over.actor), mutations: { "admin/media.upload": mutation }, env, limit: async () => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 }) };
    const body = over.body ?? new Uint8Array(10);
    const request = new Request("https://x.example/api/v1/admin/media.upload?kind=photo", { method: "POST", headers: { origin: "https://x.example", ...over.headers }, body: body as BodyInit });
    return { handle, response: handleMutation(request, () => deps) };
  }

  it("hands the bytes to the operation after the access check", async () => {
    const { handle, response } = run({ body: new Uint8Array(50) });
    const answer = await response;
    expect(answer?.status).toBe(201);
    expect(await answer?.json()).toEqual({ length: 50 });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("does not read a body for someone who may not upload", async () => {
    const { handle, response } = run({ actor: null, body: new Uint8Array(50) });
    expect((await response)?.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a body over the limit, by its declared length and by its real length", async () => {
    const big = run({ maxBytes: 100, body: new Uint8Array(500) });
    expect((await big.response)?.status).toBe(413);
    expect(big.handle).not.toHaveBeenCalled();
    const lying = run({ maxBytes: 100, body: new Uint8Array(500), headers: { "content-length": "10" } });
    expect((await lying.response)?.status).toBe(413);
  });
});
