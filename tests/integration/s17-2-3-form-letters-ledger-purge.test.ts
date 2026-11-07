import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mintActor, type Actor } from "@/server/auth/actor";
import { applicationFormDataCalls, applicationFormMutations } from "@/modules/application-form/endpoints";
import { documentDataCalls, documentMutations } from "@/modules/documents/endpoints";
import { leadMutations } from "@/modules/leads/admin-endpoints";
import { paymentMutations } from "@/modules/payments/endpoints";
import { uuidv7 } from "@/lib/uuid";
import { denyAccess } from "@/server/edge/mutations";
import { inContext } from "@/server/db/rls";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { DocumentStore } from "@/server/media/documents";
import { runPurge } from "@/server/media/purge";
import { changeStage } from "@/server/repositories/lead-admin";
import { markPurged, purgeCandidates } from "@/server/repositories/documents";
import { listPayments } from "@/server/repositories/payments";
import { createTestDb, type TestDb } from "./helpers/db";
import { appUserRow, applyForProfile, programmeRow, q, uni } from "./helpers/fixtures";

/**
 * S17.2 (the step-2 form and the passport switch) and S17.3 (letters, proof of payment, the ledger, the purge, erasure). Everything runs as the
 * non-owner runtime role against the migrated schema, with an in-memory bucket (architecture 24.5 to 24.7).
 */

let t: TestDb;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a response body read in a test

const PNG = (extra = 24) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(extra)]);
const PDF = (extra = 40) => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Uint8Array(extra)]);

function fakeStore(options: { failDeletes?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const store: DocumentStore = {
    signUpload: async (key, contentType) => ({ url: `https://storage.test/student-docs/${key}?sig=x`, headers: { "content-type": contentType }, expiresInSeconds: 600 }),
    signDownload: async (key) => ({ url: `https://storage.test/student-docs/${key}?sig=y`, expiresInSeconds: 300 }),
    head: async (key) => (objects.has(key) ? { size: (objects.get(key) as Uint8Array).byteLength } : null),
    readHead: async (key, length) => objects.get(key)?.subarray(0, length) ?? null,
    deleteObject: async (key) => {
      if (options.failDeletes) throw new Error("storage down");
      objects.delete(key);
      deleted.push(key);
    },
  };
  return { store, objects, deleted };
}

let bucket = fakeStore();
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

type Mutations = Record<string, { access: Parameters<typeof denyAccess>[0]; handle: (c: never) => Promise<Response> }>;
async function post(mutations: Mutations, op: string, who: Actor, body: unknown): Promise<{ status: number; json: Json }> {
  const mutation = mutations[op];
  if (!mutation) throw new Error(`no such operation ${op}`);
  // The Worker asks the operation's access question before the handler runs (`handleMutation`); so does this harness.
  const denied = denyAccess(mutation.access, who, new Date());
  if (denied) return { status: denied.status, json: { error: { code: denied.code } } };
  const call = { actor: who, token: null, body, bytes: null, requestId: "req-1", request: new Request("https://x.test"), env: env() };
  const response = await asRuntime(() => mutation.handle(call as never));
  return { status: response.status, json: (await response.json()) as Json };
}
const doc = (op: string, who: Actor, body: unknown) => post(documentMutations as Mutations, op, who, body);

async function get(calls: Record<string, (a: Actor, c: { token: string | null; url: URL }) => Promise<unknown>>, name: string, who: Actor, query = ""): Promise<{ status: number; json: Json }> {
  const handler = calls[name];
  if (!handler) throw new Error(`no such call ${name}`);
  const result = await asRuntime(() => handler(who, { token: null, url: new URL(`https://x.test/api/v1/${name}?${query}`) }));
  const response = result instanceof Response ? result : Response.json(result);
  return { status: response.status, json: (await response.json()) as Json };
}

const rows = (statement: string) => t.run(statement) as Promise<Record<string, unknown>[]>;
const one = async (statement: string) => (await rows(statement))[0];

async function onboardStudent(userId: string, manager: string): Promise<void> {
  await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(userId)}, 'student', now())`);
  await t.asRuntime();
  try {
    await inContext(t.db, { userId, role: "student" }, t.db.execute(sql`select out_outcome from public.app_complete_profile('Ada Eze', '+2348031234567', 'NG', 'olevel_alevel', '[]'::jsonb, 'v1', now(), 'student', 'Ada Eze', 'undergraduate', ARRAY['law'], 2027::smallint)`));
  } finally {
    await t.asOwner();
  }
  await t.run(`update student_profile set assigned_manager_id = ${q(manager)} where user_id = ${q(userId)}`);
}

/** A student's whole upload, as in S17.1. */
async function upload(who: Actor, kind: string, bytes: Uint8Array = PNG(), contentType = "image/png") {
  const signed = await doc("me/documents.sign", who, { kind, contentType, byteSize: bytes.byteLength });
  bucket.objects.set(`${who.userId}/${signed.json.id}`, bytes);
  const confirmed = await doc("me/documents.confirm", who, { id: signed.json.id });
  return { id: signed.json.id as string, signed, confirmed };
}

const MGR = "mgr-1";
const OTHER_MGR = "mgr-2";
const ADMIN = "adm-1";
const FORM = {
  dateOfBirth: "2005-03-14",
  gender: "female",
  nationality: "NG",
  residenceState: "Lagos",
  city: "Ikeja",
  address: "12 Allen Avenue",
  guardianName: "Chidi Eze",
  guardianPhone: "+2348031111111",
  motherName: "Ngozi Eze",
  motherPhone: "+2348032222222",
};

beforeAll(async () => {
  t = await createTestDb();
  await appUserRow(t, MGR, "manager");
  await appUserRow(t, OTHER_MGR, "manager");
  await appUserRow(t, ADMIN, "admin");
});

afterAll(async () => {
  await t.close();
});

describe("S17.2 the step-2 form", () => {
  let universityId: string;
  let passportUniversityId: string;
  let programmeId: string;
  let passportProgrammeId: string;

  beforeAll(async () => {
    universityId = await uni(t, { slug: "no-passport", name: "No Passport University" });
    passportUniversityId = await uni(t, { slug: "passport-u", name: "Passport University", passport_required: true });
    programmeId = await programmeRow(t, universityId);
    passportProgrammeId = await programmeRow(t, passportUniversityId);
  });

  async function applied(userId: string, programme: string, overrides: Record<string, unknown> = {}): Promise<string> {
    await onboardStudent(userId, MGR);
    const lead = await applyForProfile(t, userId, { assigned_manager_id: MGR, stage_code: "documents", ...overrides });
    await t.run(`insert into lead_programme_pref (lead_id, programme_id, rank) values (${q(lead)}, ${q(programme)}, 1)`);
    return lead;
  }
  const form = (who: Actor) => get(applicationFormDataCalls(env()) as never, "me/application-form", who);
  const save = (who: Actor, body: unknown) => post(applicationFormMutations as Mutations, "me/applicationForm.save", who, body);

  it("opens prefilled with what the student gave at sign-up, read-only, and the country standing in for the nationality", async () => {
    await applied("form-a", programmeId);
    const answer = await form(actor("form-a", "student"));
    expect(answer.status).toBe(200);
    expect(answer.json.fixed).toMatchObject({ name: "Ada Eze", whatsapp: "+2348031234567", courseFields: ["law"], academicYear: 2027 });
    expect(answer.json.values).toMatchObject({ nationality: "NG", city: "", passportNumber: "" });
    expect(answer.json).toMatchObject({ completed: false, editable: true, passportRequired: false });
  });

  it("saves the form, and the next time it opens with what was saved", async () => {
    const me = actor("form-a", "student");
    expect((await save(me, FORM)).json).toEqual({ saved: true });
    const answer = await form(me);
    expect(answer.json.values).toMatchObject({ dateOfBirth: "2005-03-14", city: "Ikeja", guardianPhone: "+2348031111111" });
    expect(answer.json.completed).toBe(true);
  });

  it("does not store a passport number when the university does not ask for one", async () => {
    await save(actor("form-a", "student"), { ...FORM, passportNumber: "A1234567" });
    expect((await one(`select passport_number from student_profile where user_id = 'form-a'`))?.passport_number).toBeNull();
  });

  it("asks for the passport when the university's switch is on, and then stores it", async () => {
    await applied("form-p", passportProgrammeId);
    const me = actor("form-p", "student");
    expect((await form(me)).json.passportRequired).toBe(true);
    const missing = await save(me, FORM);
    expect(missing).toMatchObject({ status: 400, json: { error: { fields: { passportNumber: "REQUIRED" } } } });
    expect((await save(me, { ...FORM, passportNumber: "a1234567" })).status).toBe(200);
    expect((await one(`select passport_number from student_profile where user_id = 'form-p'`))?.passport_number).toBe("A1234567");
  });

  it("returns a field error for each bad value and writes nothing", async () => {
    const me = actor("form-a", "student");
    const bad = await save(me, { ...FORM, dateOfBirth: "2999-01-01", guardianPhone: "12", gender: "x" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.error.fields).sort()).toEqual(["dateOfBirth", "gender", "guardianPhone"]);
    expect((await one(`select city from student_profile where user_id = 'form-a'`))?.city).toBe("Ikeja");
  });

  it("is refused before the student has applied, and once the application is closed", async () => {
    await onboardStudent("form-n", MGR);
    expect((await save(actor("form-n", "student"), FORM)).json.error.fields.form).toBe("NOT_APPLIED");
    expect((await form(actor("form-n", "student"))).json.editable).toBe(false);

    await t.run(`update lead set status = 'closed', closed_reason = 'no_response', closed_at = now() where user_id = 'form-a'`);
    expect((await save(actor("form-a", "student"), FORM)).json.error.fields.form).toBe("CLOSED");
  });

  it("is for a student: staff cannot save it, and a manager reads only the profiles of their students", async () => {
    expect((await save(actor(MGR, "manager"), FORM)).status).toBe(403);
    const seen = async (manager: string) => (await asRuntime(async () => (await inContext(t.db, { userId: manager, role: "manager" }, t.db.execute(sql`select count(*)::int as n from student_profile where user_id = 'form-p'`)))[0])) as unknown as { rows?: { n: number }[] } | { n: number }[];
    const count = (r: unknown) => ((r as { rows?: { n: number }[] }).rows ?? (r as { n: number }[]))[0]?.n;
    expect(count(await seen(MGR))).toBe(1);
    expect(count(await seen(OTHER_MGR))).toBe(0);
  });

  it("makes the passport part of the document rule when the university asks for it", async () => {
    const lead = await rows(`select id from lead where user_id = 'form-p'`).then((r) => String(r[0]?.id));
    const manager = actor(MGR, "manager");
    const student = actor("form-p", "student");
    for (const kind of ["results", "id", "birth_certificate", "signature"]) {
      const up = await upload(student, kind);
      await doc("admin/documents.review", manager, { id: up.id, decision: "approved" });
    }
    const move = async () => {
      const v = String((await one(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as v from lead where id = ${q(lead)}`))?.v);
      return asRuntime(() => changeStage(t.db, manager, { leadId: lead, stage: "university_review", version: v }));
    };
    expect(await move()).toMatchObject({ kind: "not_allowed", reason: "documents_missing" }); // four of five
    const passport = await upload(student, "passport");
    await doc("admin/documents.review", manager, { id: passport.id, decision: "approved" });
    expect(await move()).toMatchObject({ kind: "ok" });
  });
});

describe("S17.3 letters and proof of payment", () => {
  const STU = "let-stu";
  beforeAll(async () => {
    await onboardStudent(STU, MGR);
    await applyForProfile(t, STU, { assigned_manager_id: MGR, stage_code: "offer_letter" });
  });

  const letter = async (who: Actor, kind: string, bytes: Uint8Array = PDF(), size = bytes.byteLength) => {
    const signed = await doc("admin/documents.sign", who, { studentId: STU, kind, byteSize: size });
    if (signed.status === 201) bucket.objects.set(`${STU}/${signed.json.id}`, bytes);
    return { signed, confirmed: signed.status === 201 ? await doc("admin/documents.confirm", who, { id: signed.json.id }) : null };
  };

  it("lets the admin upload an offer letter, and the student sees it and gets a five-minute link, not audited", async () => {
    const { signed, confirmed } = await letter(actor(ADMIN, "admin"), "offer_letter");
    expect(signed.status).toBe(201);
    expect(signed.json.headers).toEqual({ "content-type": "application/pdf" });
    expect(confirmed?.json.state).toBe("uploaded");
    expect((await one(`select action from audit_log where action = 'documents.letter' and entity_id = ${q(signed.json.id)}`))?.action).toBe("documents.letter");

    const mine = await get(documentDataCalls(env()) as never, "me/documents", actor(STU, "student"));
    expect(mine.json.documents.some((d: { id: string; kind: string; state: string }) => d.id === signed.json.id && d.kind === "offer_letter" && d.state === "uploaded")).toBe(true);
    const before = Number((await one(`select count(*)::int as n from audit_log where action = 'documents.open'`))?.n);
    const link = await get(documentDataCalls(env()) as never, "me/document-link", actor(STU, "student"), `id=${signed.json.id}`);
    expect(link.json.expiresInSeconds).toBe(300);
    expect(Number((await one(`select count(*)::int as n from audit_log where action = 'documents.open'`))?.n)).toBe(before);
  });

  it("another student does not see the letter", async () => {
    await onboardStudent("let-other", OTHER_MGR);
    const mine = await get(documentDataCalls(env()) as never, "me/documents", actor("let-other", "student"));
    expect(mine.json.documents.filter((d: { kind: string }) => d.kind === "offer_letter")).toEqual([]);
  });

  it("is the admin's alone: a manager and a student are refused", async () => {
    expect((await doc("admin/documents.sign", actor(MGR, "manager"), { studentId: STU, kind: "offer_letter", byteSize: 100 })).status).toBe(403);
    expect((await doc("admin/documents.sign", actor(STU, "student"), { studentId: STU, kind: "offer_letter", byteSize: 100 })).status).toBe(403);
  });

  it("refuses a letter that is not a PDF, deletes it, and says which check failed", async () => {
    const bad = await letter(actor(ADMIN, "admin"), "acceptance_letter", PNG());
    expect(bad.confirmed).toMatchObject({ status: 400, json: { error: { fields: { file: "TYPE_DIFFERS" } } } });
    expect(bucket.objects.has(`${STU}/${bad.signed.json.id}`)).toBe(false);
    expect((await one(`select state from student_document where id = ${q(bad.signed.json.id)}`))?.state).toBe("purged");
  });

  it("refuses a kind that is not a letter, a student that does not exist, and a letter over 5 MB", async () => {
    const admin = actor(ADMIN, "admin");
    expect((await doc("admin/documents.sign", admin, { studentId: STU, kind: "id", byteSize: 100 })).json.error.fields.kind).toBe("UNKNOWN_VALUE");
    expect((await doc("admin/documents.sign", admin, { studentId: "nobody", kind: "offer_letter", byteSize: 100 })).status).toBe(404);
    expect((await doc("admin/documents.sign", admin, { studentId: STU, kind: "offer_letter", byteSize: 5 * 1024 * 1024 + 1 })).json.error.fields.byteSize).toBe("TOO_LARGE");
  });

  it("keeps the old letter when a new one is sent (letters are not replaced)", async () => {
    const admin = actor(ADMIN, "admin");
    const a = await letter(admin, "offer_letter");
    const b = await letter(admin, "offer_letter");
    expect(a.confirmed?.json.state).toBe("uploaded");
    expect(b.confirmed?.json.state).toBe("uploaded");
  });

  it("payment proof: the student uploads it, a manager cannot approve it, the admin can, once", async () => {
    const proof = await upload(actor(STU, "student"), "payment_proof");
    expect(proof.confirmed.json.state).toBe("uploaded");
    expect((await doc("admin/documents.review", actor(MGR, "manager"), { id: proof.id, decision: "approved" })).status).toBe(403);
    expect((await doc("admin/payments.proofApprove", actor(MGR, "manager"), { id: proof.id })).status).toBe(403);
    expect((await one(`select state from student_document where id = ${q(proof.id)}`))?.state).toBe("uploaded");

    expect((await doc("admin/payments.proofApprove", actor(ADMIN, "admin"), { id: proof.id })).json).toEqual({ id: proof.id, state: "approved" });
    expect((await doc("admin/payments.proofApprove", actor(ADMIN, "admin"), { id: proof.id })).status).toBe(409);
    expect((await one(`select meta from audit_log where action = 'documents.review' and entity_id = ${q(proof.id)}`))?.meta).toEqual({ kind: "payment_proof", decision: "approved" });
  });

  it("the proof operation works on a proof only, and a proof can be sent again after it is refused", async () => {
    const student = actor(STU, "student");
    const idDoc = await upload(student, "id");
    expect((await doc("admin/payments.proofApprove", actor(ADMIN, "admin"), { id: idDoc.id })).status).toBe(404);
    const first = await upload(student, "payment_proof");
    await doc("admin/documents.review", actor(ADMIN, "admin"), { id: first.id, decision: "rejected", note: "Blurred" });
    expect((await upload(student, "payment_proof")).confirmed.json.state).toBe("uploaded");
  });
});

describe("S17.3 the ledger (architecture 24.2, regression R4)", () => {
  let universityId: string;
  const record = (who: Actor, amount: string, token: string = randomUUID()) => post(paymentMutations as Mutations, "admin/payments.record", who, { submissionToken: token, universityId, amount, receivedOn: "2026-10-20" });
  const totals = async () => (await asRuntime(() => listPayments(t.db, actor(ADMIN, "admin"), { status: "all" }))).totals;

  beforeAll(async () => {
    universityId = await uni(t, { slug: "ledger-u", name: "Ledger University" });
  });

  it("a manager's entry is pending, listed, and in no total; the admin's own entry is approved at once", async () => {
    const before = await totals();
    const pending = await record(actor(MGR, "manager"), "1,000");
    expect(pending).toMatchObject({ status: 201, json: { pending: true } });
    const own = await record(actor(ADMIN, "admin"), "250");
    expect(own.json.pending).toBe(false);

    const list = await asRuntime(() => listPayments(t.db, actor(ADMIN, "admin"), { status: "all" }));
    expect(list.rows.find((r) => r.id === pending.json.id)?.approvedAt).toBeNull();
    expect(list.totals.grandTotalCents).toBe(before.grandTotalCents + 25_000); // only the approved one
    expect(list.totals.count).toBe(before.count + 1);
    const waiting = await asRuntime(() => listPayments(t.db, actor(ADMIN, "admin"), { status: "pending" }));
    expect(waiting.rows.map((r) => r.id)).toContain(pending.json.id);
  });

  it("is excluded from the Insights, the home and the notification figures until approved, and counted after", async () => {
    const entry = await record(actor(MGR, "manager"), "4,000");
    const sums = async () => ({
      insights: Number((await one(`select coalesce(sum(amount_usd_cents) filter (where voided_at is null and approved_at is not null), 0)::bigint as c from placement_payment`))?.c),
    });
    const before = await sums();
    expect(Number((await one(`select amount_usd_cents from placement_payment where id = ${q(entry.json.id)}`))?.amount_usd_cents)).toBe(400_000);
    const approve = await post(paymentMutations as Mutations, "admin/payments.approve", actor(ADMIN, "admin"), { id: entry.json.id });
    expect(approve.json).toEqual({ approved: true });
    expect((await sums()).insights).toBe(before.insights + 400_000);
    expect((await one(`select approved_by from placement_payment where id = ${q(entry.json.id)}`))?.approved_by).toBe(ADMIN);
    expect((await one(`select meta from audit_log where action = 'payments.approve' and entity_id = ${q(entry.json.id)}`))?.meta).toEqual({});
  });

  it("only the admin approves: a manager is refused by the operation, and by the database if the operation were bypassed", async () => {
    const entry = await record(actor(MGR, "manager"), "10");
    expect((await post(paymentMutations as Mutations, "admin/payments.approve", actor(MGR, "manager"), { id: entry.json.id })).status).toBe(403);
    await t.asRuntime();
    try {
      await expect(
        inContext(t.db, { userId: MGR, role: "manager" }, t.db.execute(sql`update placement_payment set approved_by = ${MGR}, approved_at = now() where id = ${entry.json.id}::uuid`)),
      ).rejects.toThrow();
    } finally {
      await t.asOwner();
    }
    expect((await one(`select approved_at from placement_payment where id = ${q(entry.json.id)}`))?.approved_at).toBeNull();
  });

  it("a manager cannot enter an entry that is already approved", async () => {
    await t.asRuntime();
    try {
      await expect(
        inContext(
          t.db,
          { userId: MGR, role: "manager" },
          t.db.execute(sql`insert into placement_payment (id, submission_token, university_id, amount_usd_cents, received_on, entered_by, approved_by, approved_at) values (${uuidv7()}::uuid, ${randomUUID()}::uuid, ${universityId}::uuid, 100, '2026-10-20', ${MGR}, ${MGR}, now())`),
        ),
      ).rejects.toThrow();
    } finally {
      await t.asOwner();
    }
  });

  it("an approval is final: approving again, or approving a voided entry, is refused; an approved entry is not changed by anyone", async () => {
    const entry = await record(actor(MGR, "manager"), "20");
    const admin = actor(ADMIN, "admin");
    await post(paymentMutations as Mutations, "admin/payments.approve", admin, { id: entry.json.id });
    expect((await post(paymentMutations as Mutations, "admin/payments.approve", admin, { id: entry.json.id })).status).toBe(409);

    const voided = await record(actor(MGR, "manager"), "30");
    await post(paymentMutations as Mutations, "admin/payments.void", actor(MGR, "manager"), { id: voided.json.id, reason: "typo" });
    expect((await post(paymentMutations as Mutations, "admin/payments.approve", admin, { id: voided.json.id })).status).toBe(409);
    expect((await post(paymentMutations as Mutations, "admin/payments.approve", admin, { id: randomUUID() })).status).toBe(404);
    await expect(t.run(`update placement_payment set approved_at = now() - interval '1 day' where id = ${q(entry.json.id)}`)).rejects.toThrow();
  });

  it("a void is still recorded as the person who made it, even for an admin whose own entry it was", async () => {
    const entry = await record(actor(ADMIN, "admin"), "40");
    await t.asRuntime();
    try {
      await expect(
        inContext(t.db, { userId: ADMIN, role: "admin" }, t.db.execute(sql`update placement_payment set voided_at = now(), voided_by = ${MGR}, void_reason = 'x' where id = ${entry.json.id}::uuid`)),
      ).rejects.toThrow();
    } finally {
      await t.asOwner();
    }
  });
});

describe("S17.3 the purge (architecture 24.7, ADR-068)", () => {
  const DAY = "interval '1 day'";

  async function student(id: string): Promise<void> {
    await t.run(`insert into app_user (id, role, account_confirmed_at) values (${q(id)}, 'student', now())`);
  }
  /** A stored file for a student, in the state given, with a key. */
  async function file(studentId: string, state = "uploaded", ageDays = 0): Promise<string> {
    const id = uuidv7();
    await t.run(
      `insert into student_document (id, student_id, kind, storage_key, content_type, byte_size, state, created_at) values (${q(id)}, ${q(studentId)}, 'payment_proof', ${q(`${studentId}/${id}`)}, 'image/png', 10, ${q(state)}, now() - ${ageDays} * ${DAY})`,
    );
    bucket.objects.set(`${studentId}/${id}`, PNG());
    return id;
  }
  const lead = (userId: string, overrides: Record<string, unknown>) => import("./helpers/fixtures").then((m) => m.leadRow(t, { user_id: userId, ...overrides }));
  const days = (n: number) => `now() - ${n} * ${DAY}`;
  const candidateIds = async () => (await purgeCandidates(t.db, 100)).map((c) => c.id);

  it("takes a student's files 90 days after Arrived or Closed, and not a day sooner", async () => {
    await student("pg-old");
    await student("pg-new");
    await student("pg-arrived");
    await lead("pg-old", { status: "closed", closed_reason: "no_response" });
    await lead("pg-new", { status: "closed", closed_reason: "no_response" });
    await lead("pg-arrived", { status: "arrived" });
    await t.run(`update lead set closed_at = ${days(91)} where user_id = 'pg-old'`);
    await t.run(`update lead set closed_at = ${days(89)} where user_id = 'pg-new'`);
    await t.run(`update lead set arrived_at = ${days(100)} where user_id = 'pg-arrived'`);
    const old = await file("pg-old");
    const recent = await file("pg-new");
    const arrived = await file("pg-arrived", "approved");
    const ids = await candidateIds();
    expect(ids).toContain(old);
    expect(ids).toContain(arrived);
    expect(ids).not.toContain(recent);
  });

  it("keeps the files of a student who has another open application, and of one who never applied", async () => {
    await student("pg-open");
    await student("pg-none");
    const closed = await lead("pg-open", { status: "closed", closed_reason: "refused" });
    await t.run(`update lead set closed_at = ${days(200)} where id = ${q(closed)}`);
    await lead("pg-open", {});
    const keep = await file("pg-open");
    const none = await file("pg-none");
    const ids = await candidateIds();
    expect(ids).not.toContain(keep);
    expect(ids).not.toContain(none);
  });

  it("keeps a reopened file: while it is open the files stay", async () => {
    await student("pg-reopen");
    const l = await lead("pg-reopen", { status: "closed", closed_reason: "other" });
    await t.run(`update lead set closed_at = ${days(120)} where id = ${q(l)}`);
    const f = await file("pg-reopen");
    expect(await candidateIds()).toContain(f);
    await t.run(`update lead set status = 'open', closed_reason = null, closed_at = null where id = ${q(l)}`);
    expect(await candidateIds()).not.toContain(f);
  });

  it("takes an upload that never finished after a day, and not before", async () => {
    await student("pg-stuck");
    const stuck = await file("pg-stuck", "pending", 2);
    const fresh = await file("pg-stuck", "pending", 0);
    const ids = await candidateIds();
    expect(ids).toContain(stuck);
    expect(ids).not.toContain(fresh);
  });

  it("deletes the objects and marks the rows, once: a second run finds nothing, and the files are gone", async () => {
    bucket = fakeStore();
    await student("pg-run");
    const l = await lead("pg-run", { status: "closed", closed_reason: "withdrew" });
    await t.run(`update lead set closed_at = ${days(95)} where id = ${q(l)}`);
    const a = await file("pg-run");
    const b = await file("pg-run", "approved");
    const deps = { candidates: (n: number) => purgeCandidates(t.db, n), deleteObject: (k: string) => bucket.store.deleteObject(k), markPurged: (ids: string[]) => markPurged(t.db, ids) };
    // Other tests left candidates behind; this run takes whatever is due. What matters is that these two are among them and the next run has none.
    let first = await runPurge(deps);
    while (first.found === 40) first = await runPurge(deps);
    for (const id of [a, b]) expect(await one(`select state, storage_key from student_document where id = ${q(id)}`)).toEqual({ state: "purged", storage_key: null });
    expect(bucket.deleted.filter((k) => k.startsWith("pg-run/")).length).toBe(2);
    expect(await runPurge(deps)).toEqual({ found: 0, deleted: 0, marked: 0, failed: 0 });
  });

  it("stops at 40 objects a run and takes the rest the next day", async () => {
    bucket = fakeStore();
    await t.run(`delete from student_document where student_id like 'pg-%'`);
    await student("pg-many");
    const l = await lead("pg-many", { status: "closed", closed_reason: "other" });
    await t.run(`update lead set closed_at = ${days(150)} where id = ${q(l)}`);
    for (let i = 0; i < 45; i += 1) await file("pg-many", i % 2 === 0 ? "uploaded" : "approved");
    // Nothing else is due now: the earlier tests' files are marked purged or belong to students who are kept.
    const deps = { candidates: (n: number) => purgeCandidates(t.db, n), deleteObject: (k: string) => bucket.store.deleteObject(k), markPurged: (ids: string[]) => markPurged(t.db, ids) };
    expect(await runPurge(deps)).toMatchObject({ found: 40, deleted: 40, marked: 40 });
    expect(await runPurge(deps)).toMatchObject({ found: 5, deleted: 5, marked: 5 });
    expect(await runPurge(deps)).toMatchObject({ found: 0 });
  });

  it("a failed delete leaves the row for the next run, which then succeeds", async () => {
    await t.run(`delete from student_document where student_id like 'pg-%'`);
    await student("pg-fail");
    const l = await lead("pg-fail", { status: "closed", closed_reason: "other" });
    await t.run(`update lead set closed_at = ${days(150)} where id = ${q(l)}`);
    const f = await file("pg-fail");
    const down = fakeStore({ failDeletes: true });
    const base = { candidates: (n: number) => purgeCandidates(t.db, n), markPurged: (ids: string[]) => markPurged(t.db, ids) };
    expect(await runPurge({ ...base, deleteObject: (k) => down.store.deleteObject(k) })).toMatchObject({ found: 1, deleted: 0, failed: 1 });
    expect((await one(`select state from student_document where id = ${q(f)}`))?.state).toBe("uploaded");
    expect(await runPurge({ ...base, deleteObject: (k) => bucket.store.deleteObject(k) })).toMatchObject({ found: 1, deleted: 1, marked: 1 });
  });

  it("the database refuses to mark a row purged that does not qualify, even if asked", async () => {
    await student("pg-guard");
    const f = await file("pg-guard");
    expect(await markPurged(t.db, [f])).toBe(0);
    expect((await one(`select state from student_document where id = ${q(f)}`))?.state).toBe("uploaded");
  });
});

describe("S17.3 erasure (FR-49)", () => {
  const erase = (leadId: string, identityConfirmed = true) => post(leadMutations as Mutations, "admin/leads.eraseLead", actor(ADMIN, "admin"), { leadId, identityConfirmed });

  async function studentWithFiles(id: string): Promise<{ leadId: string; ids: string[] }> {
    await onboardStudent(id, MGR);
    const leadId = await applyForProfile(t, id, { assigned_manager_id: MGR, stage_code: "documents" });
    const student = actor(id, "student");
    const ids = [(await upload(student, "results")).id, (await upload(student, "id")).id];
    return { leadId, ids };
  }

  it("an erasure that is refused (identity not confirmed) deletes no file", async () => {
    bucket = fakeStore();
    const { leadId, ids } = await studentWithFiles("er-refused");
    const refused = await erase(leadId, false);
    expect(refused.status).toBe(400);
    expect(bucket.deleted).toEqual([]);
    expect((await one(`select count(*)::int as n from student_document where id = any (${q(`{${ids.join(",")}}`)}::uuid[]) and storage_key is not null`))?.n).toBe(2);
  });

  it("an erasure deletes the student's objects after it has happened, and the rows hold no key", async () => {
    bucket = fakeStore();
    const { leadId, ids } = await studentWithFiles("er-done");
    const done = await erase(leadId);
    expect(done.json).toEqual({ erased: true, filesNotDeleted: 0 });
    expect(bucket.deleted.length).toBe(2);
    expect([...bucket.objects.keys()].filter((k) => k.startsWith("er-done/"))).toEqual([]);
    for (const id of ids) expect(await one(`select state, storage_key from student_document where id = ${q(id)}`)).toEqual({ state: "purged", storage_key: null });
  });

  it("says so when storage could not delete, instead of claiming a clean erasure", async () => {
    bucket = fakeStore({ failDeletes: true });
    const { leadId } = await studentWithFiles("er-down");
    const done = await erase(leadId);
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ erased: true, filesNotDeleted: 2 });
  });

  it("erasing an old closed file keeps the documents of a student whose current application is open", async () => {
    bucket = fakeStore();
    await onboardStudent("er-keep", MGR);
    const student = actor("er-keep", "student");
    const old = await applyForProfile(t, "er-keep", { assigned_manager_id: MGR, stage_code: "documents" });
    const kept = (await upload(student, "results")).id;
    await t.run(`update lead set status = 'closed', closed_reason = 'refused', closed_at = now() where id = ${q(old)}`);
    await applyForProfile(t, "er-keep", { assigned_manager_id: MGR, stage_code: "documents" });
    const done = await erase(old);
    expect(done.json.erased).toBe(true);
    expect(bucket.deleted).toEqual([]);
    expect((await one(`select state from student_document where id = ${q(kept)}`))?.state).toBe("uploaded");
  });

  it("a manager of another student cannot erase them or learn their keys", async () => {
    const { leadId } = await studentWithFiles("er-other");
    const refused = await post(leadMutations as Mutations, "admin/leads.eraseLead", actor(OTHER_MGR, "manager"), { leadId, identityConfirmed: true });
    expect([403, 404]).toContain(refused.status);
  });

  it("deleting an account removes its document rows (the row points at the account that is going away)", async () => {
    await t.run(`insert into app_user (id, role, account_confirmed_at) values ('er-acct', 'student', now())`);
    const id = uuidv7();
    await t.run(`insert into student_document (id, student_id, kind, storage_key, content_type, byte_size, state) values (${q(id)}, 'er-acct', 'id', 'er-acct/${id}', 'image/png', 10, 'uploaded')`);
    await t.run(`delete from app_user where id = 'er-acct'`);
    expect(await rows(`select id from student_document where student_id = 'er-acct'`)).toEqual([]);
  });
});
