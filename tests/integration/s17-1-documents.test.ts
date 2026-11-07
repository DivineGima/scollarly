import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintActor, type Actor } from "@/server/auth/actor";
import { documentDataCalls, documentMutations } from "@/modules/documents/endpoints";
import { changeStage } from "@/server/repositories/lead-admin";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { DocumentStore } from "@/server/media/documents";
import { createTestDb, type TestDb } from "./helpers/db";
import { appUserRow, applyForProfile, q } from "./helpers/fixtures";

/**
 * S17.1 (architecture 24.5, ADR-066, ADR-067): private student documents. The endpoints run as the non-owner runtime role against the
 * migrated schema, with an in-memory store in place of the bucket. What the store itself signs is in `tests/unit/document-store.test.ts`; that
 * the bucket refuses an anonymous read and that a link expires was proved against a real private bucket in the Stage 17 probe (tracker_5, F42).
 */

let t: TestDb;

const PNG = (extra = 24) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(extra)]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0, 0, 0, 0]);

/** A bucket in memory: signing hands out a fake address, and the "browser" puts bytes straight into the map. */
function fakeStore() {
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const store: DocumentStore = {
    signUpload: async (key, contentType) => ({ url: `https://storage.test/student-docs/${key}?sig=x`, headers: { "content-type": contentType }, expiresInSeconds: 600 }),
    signDownload: async (key) => ({ url: `https://storage.test/student-docs/${key}?sig=y`, expiresInSeconds: 300 }),
    head: async (key) => (objects.has(key) ? { size: (objects.get(key) as Uint8Array).byteLength } : null),
    readHead: async (key, length) => objects.get(key)?.subarray(0, length) ?? null,
    deleteObject: async (key) => {
      objects.delete(key);
      deleted.push(key);
    },
  };
  return { store, objects, deleted };
}

const bucket = fakeStore();
const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => new Date(), documents: () => bucket.store });

const actor = (userId: string, role: "student" | "manager" | "admin"): Actor =>
  mintActor({ userId, sessionId: `s-${userId}`, storedRole: role, role, twoFactorVerifiedAt: role === "admin" ? new Date() : null });

async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

async function call(op: string, who: Actor, body: unknown): Promise<{ status: number; json: Json }> {
  const mutation = documentMutations[op];
  if (!mutation) throw new Error(`no such operation ${op}`);
  const response = await asRuntime(() => mutation.handle({ actor: who, token: null, body, bytes: null, requestId: "req-1", request: new Request("https://x.test"), env: env() }));
  return { status: response.status, json: (await response.json()) as Json };
}

async function read(name: string, who: Actor, query: string): Promise<{ status: number; json: Json; cache: string | null }> {
  const handler = documentDataCalls(env())[name];
  if (!handler) throw new Error(`no such call ${name}`);
  const result = await asRuntime(() => handler(who, { token: null, url: new URL(`https://x.test/api/v1/${name}?${query}`) }));
  const response = result instanceof Response ? result : Response.json(result);
  return { status: response.status, json: (await response.json()) as Json, cache: response.headers.get("cache-control") };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a response body read in a test

const KINDS = ["results", "id", "birth_certificate", "signature"] as const;

/** The whole of one upload: sign, send the bytes (the browser's part), confirm. */
async function upload(who: Actor, kind: string, bytes: Uint8Array = PNG(), contentType = "image/png") {
  const signed = await call("me/documents.sign", who, { kind, contentType, byteSize: bytes.byteLength });
  if (signed.status !== 201) return { signed, confirmed: null as null | { status: number; json: Json } };
  bucket.objects.set(`${who.userId}/${signed.json.id}`, bytes);
  const confirmed = await call("me/documents.confirm", who, { id: signed.json.id });
  return { signed, confirmed };
}

const A = { student: "stu-a", manager: "mgr-a" };
const B = { student: "stu-b", manager: "mgr-b" };
const admin = "adm-1";
const stateOf = async (id: string) => ((await t.run(`select state, storage_key from student_document where id = ${q(id)}`)) as Record<string, unknown>[])[0];

async function onboardStudent(userId: string, manager: string): Promise<void> {
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(userId)}, 'student', now())`);
  await t.asRuntime();
  try {
    const { inContext } = await import("@/server/db/rls");
    const { sql } = await import("drizzle-orm");
    await inContext(t.db, { userId, role: "student" }, t.db.execute(sql`select out_outcome from public.app_complete_profile('Ada Eze', '+2348031234567', 'NG', 'olevel_alevel', '[]'::jsonb, 'v1', now(), 'student', 'Ada Eze', 'undergraduate', ARRAY['law'], 2027::smallint)`));
  } finally {
    await t.asOwner();
  }
  await t.run(`update student_profile set assigned_manager_id = ${q(manager)} where user_id = ${q(userId)}`);
}

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, A.manager, "manager");
  await appUserRow(t, B.manager, "manager");
  await appUserRow(t, admin, "admin");
  await onboardStudent(A.student, A.manager);
  await onboardStudent(B.student, B.manager);
});

afterAll(async () => {
  await t.close();
});

describe("S17.1 upload: sign, send, confirm", () => {
  it("signs a link, takes the file from the phone, checks it, and only then counts it", async () => {
    const { signed, confirmed } = await upload(actor(A.student, "student"), "results");
    expect(signed.status).toBe(201);
    expect(signed.json.url).toContain(`student-docs/${A.student}/${signed.json.id}`);
    expect(signed.json.headers).toEqual({ "content-type": "image/png" });
    expect(confirmed?.json).toEqual({ id: signed.json.id, state: "uploaded" });
    expect((await stateOf(signed.json.id))?.state).toBe("uploaded");
    // The key is the student and the document, never a file name; and the key never goes back to the browser.
    expect((await stateOf(signed.json.id))?.storage_key).toBe(`${A.student}/${signed.json.id}`);
    expect(JSON.stringify(confirmed?.json)).not.toContain(A.student);
  });

  it("is safe to confirm twice", async () => {
    const { signed } = await upload(actor(A.student, "student"), "id");
    const again = await call("me/documents.confirm", actor(A.student, "student"), { id: signed.json.id });
    expect(again).toMatchObject({ status: 200, json: { state: "uploaded" } });
  });

  it("refuses a kind that is not one the student supplies, a type that is not allowed, and a file over 5 MB", async () => {
    const me = actor(A.student, "student");
    expect((await call("me/documents.sign", me, { kind: "offer_letter", contentType: "image/png", byteSize: 100 })).json.error.fields.kind).toBe("UNKNOWN_VALUE");
    expect((await call("me/documents.sign", me, { kind: "id", contentType: "image/gif", byteSize: 100 })).json.error.fields.contentType).toBe("UNKNOWN_VALUE");
    expect((await call("me/documents.sign", me, { kind: "id", contentType: "image/png", byteSize: 5 * 1024 * 1024 + 1 })).json.error.fields.byteSize).toBe("TOO_LARGE");
    expect((await call("me/documents.sign", me, { kind: "id", contentType: "image/png", byteSize: 0 })).status).toBe(400);
    expect((await call("me/documents.sign", me, { kind: "id", contentType: "image/png", byteSize: 10, extra: 1 })).status).toBe(400);
  });

  it("refuses a staff account: only a student uploads their own documents", async () => {
    expect((await call("me/documents.sign", actor(A.manager, "manager"), { kind: "id", contentType: "image/png", byteSize: 10 })).status).toBe(403);
  });

  it("a file that arrives as the wrong type is deleted, and the student can try that one file again alone", async () => {
    const me = actor(A.student, "student");
    const bad = await upload(me, "birth_certificate", JPEG, "image/png"); // says PNG, is a JPEG
    expect(bad.confirmed).toMatchObject({ status: 400, json: { error: { fields: { file: "TYPE_DIFFERS" } } } });
    expect(bucket.deleted).toContain(`${A.student}/${bad.signed.json.id}`);
    expect(bucket.objects.has(`${A.student}/${bad.signed.json.id}`)).toBe(false);
    expect(await stateOf(bad.signed.json.id)).toMatchObject({ state: "purged", storage_key: null });

    const retry = await upload(me, "birth_certificate"); // only this file, nothing else is redone
    expect(retry.confirmed?.json.state).toBe("uploaded");
  });

  it("a confirm before the file has arrived is asked to wait, and works once it has", async () => {
    const me = actor(A.student, "student");
    const signed = await call("me/documents.sign", me, { kind: "signature", contentType: "image/png", byteSize: PNG().byteLength });
    const early = await call("me/documents.confirm", me, { id: signed.json.id });
    expect(early).toMatchObject({ status: 409, json: { error: { fields: { file: "MISSING" } } } });
    expect((await stateOf(signed.json.id))?.state).toBe("pending");
    bucket.objects.set(`${A.student}/${signed.json.id}`, PNG());
    expect((await call("me/documents.confirm", me, { id: signed.json.id })).json.state).toBe("uploaded");
  });

  it("a file of another size than the one declared is refused", async () => {
    const me = actor(B.student, "student");
    const signed = await call("me/documents.sign", me, { kind: "id", contentType: "image/png", byteSize: 100 });
    bucket.objects.set(`${B.student}/${signed.json.id}`, PNG(500));
    expect((await call("me/documents.confirm", me, { id: signed.json.id })).json.error.fields.file).toBe("SIZE_DIFFERS");
  });

  it("a second upload of the same kind replaces the first and deletes its file", async () => {
    const me = actor(B.student, "student");
    const first = await upload(me, "results");
    const second = await upload(me, "results");
    expect(second.confirmed?.json.state).toBe("uploaded");
    expect(bucket.deleted).toContain(`${B.student}/${first.signed.json.id}`);
    expect(await stateOf(first.signed.json.id)).toMatchObject({ state: "purged", storage_key: null });
    const live = (await t.run(`select count(*)::int as n from student_document where student_id = ${q(B.student)} and kind = 'results' and state in ('pending','uploaded','approved')`)) as { n: number }[];
    expect(live[0]?.n).toBe(1);
  });

  it("nobody can confirm another student's upload", async () => {
    const mine = await call("me/documents.sign", actor(B.student, "student"), { kind: "signature", contentType: "image/png", byteSize: PNG().byteLength });
    bucket.objects.set(`${B.student}/${mine.json.id}`, PNG());
    expect((await call("me/documents.confirm", actor(A.student, "student"), { id: mine.json.id })).status).toBe(404);
  });
});

describe("S17.1 review and links", () => {
  let docId: string;

  beforeAll(async () => {
    docId = (await upload(actor(A.student, "student"), "passport")).signed.json.id;
  });

  it("a manager of another student cannot see, review or open the file; the assigned manager and an admin can", async () => {
    const other = actor(B.manager, "manager");
    expect((await read("admin/student-documents", other, `studentId=${A.student}`)).json.documents).toEqual([]);
    expect((await call("admin/documents.review", other, { id: docId, decision: "approved" })).status).toBe(404);
    expect((await read("admin/document-link", other, `id=${docId}`)).status).toBe(404);

    const mine = actor(A.manager, "manager");
    expect((await read("admin/student-documents", mine, `studentId=${A.student}`)).json.documents.some((d: { id: string }) => d.id === docId)).toBe(true);
    expect((await read("admin/student-documents", actor(admin, "admin"), `studentId=${A.student}`)).json.documents.length).toBeGreaterThan(0);
  });

  it("a student does not see another student's documents", async () => {
    expect((await read("me/documents", actor(B.student, "student"), "")).json.documents.some((d: { id: string }) => d.id === docId)).toBe(false);
  });

  it("asking for a clearer photo needs a reason, and the student sees it and uploads again", async () => {
    const mine = actor(A.manager, "manager");
    expect((await call("admin/documents.review", mine, { id: docId, decision: "rejected" })).json.error.fields.note).toBe("REQUIRED");
    expect((await call("admin/documents.review", mine, { id: docId, decision: "rejected", note: "Too dark" })).json.state).toBe("rejected");
    const seen = (await read("me/documents", actor(A.student, "student"), "")).json.documents.find((d: { id: string }) => d.id === docId);
    expect(seen).toMatchObject({ state: "rejected", rejectionNote: "Too dark" });
    expect(JSON.stringify(seen)).not.toContain("storage");

    const again = await upload(actor(A.student, "student"), "passport");
    expect(again.confirmed?.json.state).toBe("uploaded");
  });

  it("a reviewed file cannot be reviewed again, and a student cannot approve their own", async () => {
    const mine = actor(A.manager, "manager");
    expect((await call("admin/documents.review", mine, { id: docId, decision: "approved" })).status).toBe(409);
    const fresh = (await read("me/documents", actor(A.student, "student"), "")).json.documents.find((d: { kind: string; state: string }) => d.kind === "passport" && d.state === "uploaded");
    const { reviewDocument } = await import("@/server/repositories/documents");
    await expect(asRuntime(() => reviewDocument(t.db, actor(A.student, "student"), { id: fresh.id, decision: "approved", note: null }))).rejects.toThrow();
    expect((await stateOf(fresh.id))?.state).toBe("uploaded");
  });

  it("a staff link is audited, short, and not cacheable; the student's own link is not audited; a pending file has none", async () => {
    const fresh = (await read("me/documents", actor(A.student, "student"), "")).json.documents.find((d: { kind: string; state: string }) => d.kind === "passport" && d.state === "uploaded");
    const before = (await t.run(`select count(*)::int as n from audit_log where action = 'documents.open'`)) as { n: number }[];
    const link = await read("admin/document-link", actor(A.manager, "manager"), `id=${fresh.id}`);
    expect(link.json.expiresInSeconds).toBe(300);
    expect(link.cache).toBe("no-store");
    const after = (await t.run(`select count(*)::int as n, min(meta::text) as meta from audit_log where action = 'documents.open'`)) as { n: number; meta: string }[];
    expect(after[0]?.n).toBe((before[0]?.n ?? 0) + 1);
    expect(after[0]?.meta).toBe('{"kind": "passport"}'); // the kind and nothing else; no link, no key

    const own = await read("me/document-link", actor(A.student, "student"), `id=${fresh.id}`);
    expect(own.status).toBe(200);
    expect(((await t.run(`select count(*)::int as n from audit_log where action = 'documents.open'`)) as { n: number }[])[0]?.n).toBe(after[0]?.n);

    const pending = await call("me/documents.sign", actor(A.student, "student"), { kind: "id", contentType: "image/png", byteSize: 50 });
    expect((await read("me/document-link", actor(A.student, "student"), `id=${pending.json.id}`)).status).toBe(404);
  });

  it("a malformed id is a validation error, not a fault", async () => {
    expect((await read("admin/document-link", actor(A.manager, "manager"), "id=nope")).status).toBe(400);
  });
});

describe("S17.1 the document rule (architecture 24.4), switched on", () => {
  let leadId: string;

  beforeAll(async () => {
    await onboardStudent("stu-r", A.manager);
    leadId = await applyForProfile(t, "stu-r", { assigned_manager_id: A.manager, stage_code: "documents" });
  });

  const version = async () => String(((await t.run(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v from lead where id = ${q(leadId)}`)) as { v: string }[])[0]?.v);
  const move = async (who: Actor) => {
    const v = await version(); // read as the owner: the runtime role sees a lead only inside a signed-in context
    return asRuntime(() => changeStage(t.db, who, { leadId, stage: "university_review", version: v }));
  };

  it("holds a manager at step 2 until the four documents are approved, then lets the file go to the university", async () => {
    const student = actor("stu-r", "student");
    const manager = actor(A.manager, "manager");
    expect(await move(manager)).toMatchObject({ kind: "not_allowed", reason: "documents_missing" });

    for (const kind of KINDS.slice(0, 3)) {
      const up = await upload(student, kind);
      await call("admin/documents.review", manager, { id: up.signed.json.id, decision: "approved" });
    }
    expect(await move(manager)).toMatchObject({ kind: "not_allowed", reason: "documents_missing" }); // three of four

    const last = await upload(student, "signature");
    expect(await move(manager)).toMatchObject({ kind: "not_allowed", reason: "documents_missing" }); // uploaded is not approved
    await call("admin/documents.review", manager, { id: last.signed.json.id, decision: "approved" });
    expect(await move(manager)).toMatchObject({ kind: "ok", from: "documents" });
    expect(((await t.run(`select stage_code from lead where id = ${q(leadId)}`)) as { stage_code: string }[])[0]?.stage_code).toBe("university_review");
  });

  it("an admin may move a file on without the documents, to put a file right", async () => {
    await t.run(`update lead set stage_code = 'documents', university_submitted_at = null where id = ${q(leadId)}`);
    await t.run(`update student_document set state = 'purged', storage_key = null where student_id = 'stu-r'`);
    expect(await move(actor(admin, "admin"))).toMatchObject({ kind: "ok" });
  });
});
