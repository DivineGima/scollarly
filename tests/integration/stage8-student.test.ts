/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read nested JSON answers (`json.funnel.find(...)`); typing every shape would hide what each test checks */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateRef } from "@/lib/ref";
import { uuidv7 } from "@/lib/uuid";
import { studentDataCalls, studentMutations } from "@/modules/student/endpoints";
import { type Actor, mintActor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { MutationCall } from "@/server/edge/mutations";
import { decideClaim, listPendingClaims } from "@/server/repositories/claims";
import { insertLead, type NewLead } from "@/server/repositories/lead-intake";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { insertRow, leadRow, paymentRow, q, uni } from "./helpers/fixtures";

/**
 * Stage 8 against a real database, as the non-owner runtime role (ADR-038): the student portal. What is proven is what the Stage 8
 * exit criteria ask for: a student can never read another student's lead, a student with no approved claim sees "matching" and no
 * lead data, a lead made while signed in is linked, a link request is never a silent link, the export is the student's own and is
 * logged, and the erasure anonymises the leads, deletes the account, keeps the payments without the link, and needs a recent sign-in.
 */

let t: TestDb;
let admin: Actor;
const NOW = new Date("2026-10-26T12:00:00Z");

interface Student {
  user: SignedInUser;
  actor: Actor;
}

async function makeStudent(options: { role?: "student" | "admin"; verified?: boolean } = {}): Promise<Student> {
  const user = await t.signIn(options.verified === undefined ? {} : { verified: options.verified });
  const role = options.role ?? "student";
  await t.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
  return { user, actor: mintActor({ userId: user.userId, sessionId: user.sessionId, storedRole: role, role, twoFactorVerifiedAt: null }) };
}

const env = (): EndpointEnv => ({ db: t.db, ownerEmail: "", totpKey: "", now: () => NOW });

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
  json: Record<string, any>;
}

async function post(operation: string, who: Student, body: unknown): Promise<Answer> {
  const mutation = studentMutations[`me/${operation}`];
  if (!mutation) throw new Error(`no operation ${operation}`);
  const call: MutationCall = {
    actor: who.actor,
    token: who.user.token,
    body,
    bytes: null,
    requestId: "test",
    request: new Request(`https://example.test/api/v1/me/${operation}`, { method: "POST" }),
    env: env(),
  };
  const response = await asRuntime(() => mutation.handle(call));
  return { status: response.status, json: (await response.json()) as Record<string, any> };
}

async function get(name: string, who: Student): Promise<Answer> {
  const call = studentDataCalls(env())[`me/${name}`] as DataCall;
  const result = await asRuntime(() => call(who.actor, { token: who.user.token, url: new URL(`https://example.test/api/v1/me/${name}`) }));
  if (result instanceof Response) return { status: result.status, json: (await result.json()) as Record<string, any> };
  return { status: 200, json: JSON.parse(JSON.stringify(result)) as Record<string, any> };
}

const rows = (sql: string) => t.run(sql) as Promise<Record<string, unknown>[]>;
const count = async (sql: string) => Number((await rows(sql))[0]?.n);

/** A lead already linked to this student, as an approved claim would leave it. */
async function linkedLead(who: Student, overrides: Record<string, unknown> = {}): Promise<{ id: string; ref: string }> {
  const id = await leadRow(t, { user_id: who.user.userId, ...overrides });
  const [row] = await rows(`select ref from lead where id = ${q(id)}`);
  return { id, ref: String(row?.ref) };
}

beforeAll(async () => {
  t = await createTestDb();
  admin = (await makeStudent({ role: "admin" })).actor;
  await t.run("update site_setting set value = '\"+919815725968\"'::jsonb where key = 'whatsapp_number_e164'");
});

afterAll(async () => {
  await t.close();
});

describe("S8.1 /me progress", () => {
  it("shows 'matching' and no lead data to a student with no approved claim", async () => {
    const student = await makeStudent();
    // Someone else's lead and a lead nobody owns are both out of reach.
    await leadRow(t);
    const other = await makeStudent();
    await linkedLead(other);
    const answer = await get("progress", student);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ state: "matching", lead: null, pendingClaims: 0, otherLeads: 0 });
    expect(JSON.stringify(answer.json)).not.toContain("SC-");
    expect(answer.json.stages.map((s: { code: string }) => s.code)).toEqual(["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"]);
    expect(answer.json.whatsappE164).toBe("+919815725968");
  });

  it("shows the linked lead's stage, reference and last change, and nothing about its contact details", async () => {
    const student = await makeStudent();
    const lead = await linkedLead(student, { stage_code: "offer_letter" });
    const answer = await get("progress", student);
    expect(answer.json.state).toBe("linked");
    expect(answer.json.lead).toMatchObject({ ref: lead.ref, stage: "offer_letter" });
    expect(new Date(answer.json.lead.updatedAt).getTime()).toBeGreaterThan(0);
    expect(Object.keys(answer.json.lead).sort()).toEqual(["ref", "stage", "updatedAt"]);
  });

  it("follows the stage when an admin moves the lead, and counts a pending request while still matching", async () => {
    const student = await makeStudent();
    const lead = await linkedLead(student);
    await t.run(`update lead set stage_code = 'visa' where id = ${q(lead.id)}`);
    expect((await get("progress", student)).json.lead.stage).toBe("visa");
    const waiting = await makeStudent();
    const other = await leadRow(t);
    await t.run(`insert into lead_claim (id, user_id, lead_id, method, status) values (gen_random_uuid(), ${q(waiting.user.userId)}, ${q(other)}, 'ref', 'pending')`);
    expect(await get("progress", waiting).then((a) => a.json)).toMatchObject({ state: "matching", pendingClaims: 1, lead: null });
  });

  it("never reads another student's lead, whatever is asked (row level security)", async () => {
    const a = await makeStudent();
    const b = await makeStudent();
    const leadA = await linkedLead(a);
    await linkedLead(b);
    await t.asRuntime();
    try {
      await t.run(`select set_config('app.user_id', ${q(b.user.userId)}, false), set_config('app.role', 'student', false)`);
      expect(await count("select count(*)::int as n from lead")).toBe(1);
      expect(await count(`select count(*)::int as n from lead where id = ${q(leadA.id)}`)).toBe(0);
      expect(await count("select count(*)::int as n from lead_activity")).toBe(0);
      expect(await count("select count(*)::int as n from lead_note")).toBe(0);
    } finally {
      await t.asOwner();
    }
  });

  it("ignores an erased lead and a lead merged into another", async () => {
    const student = await makeStudent();
    const kept = await linkedLead(student);
    await linkedLead(student, { merged_into_id: kept.id });
    const erased = await linkedLead(student);
    await t.run(`update lead set name = null, whatsapp_e164 = null, email = null, results = '[]', anonymised_at = now() where id = ${q(erased.id)}`);
    const answer = await get("progress", student);
    expect(answer.json.lead.ref).toBe(kept.ref);
    expect(answer.json.otherLeads).toBe(0);
  });
});

describe("S8.2 linking", () => {
  const newLead = (over: Partial<NewLead> = {}): NewLead => {
    const ref = generateRef();
    return {
      id: uuidv7(),
      idempotencyKey: randomUUID(),
      payloadHash: "b".repeat(64),
      refs: [ref],
      clientRef: ref,
      name: "Ama Mensah",
      whatsappE164: `+2336${Math.floor(10000000 + Math.random() * 89999999)}`,
      countryCode: "GH",
      email: null,
      intakeKind: "quick",
      qualificationType: null,
      results: [],
      source: {},
      locale: "en",
      consentNoticeVersion: "v1",
      consentAt: new Date(),
      clientCreatedAt: null,
      receivedAt: new Date(),
      slaDueAt: new Date(Date.now() + 4 * 3_600_000),
      slaHoursApplied: 4,
      programmeIds: [],
      numberLimit: 5,
      ...over,
    };
  };

  it("links a lead made while a student is signed in, as an approved 'auto' claim", async () => {
    const student = await makeStudent();
    const outcome = await asRuntime(() => insertLead(t.db, newLead(), student.user.token));
    expect(outcome.kind).toBe("created");
    const id = (outcome as { id: string }).id;
    expect((await rows(`select user_id from lead where id = ${q(id)}`))[0]?.user_id).toBe(student.user.userId);
    expect(await rows(`select method, status, verification_method from lead_claim where lead_id = ${q(id)}`)).toEqual([{ method: "auto", status: "approved", verification_method: null }]);
    expect((await rows(`select data from lead_activity where lead_id = ${q(id)} and type = 'claimed'`))[0]?.data).toEqual({ method: "auto" });
    expect((await get("progress", student)).json.state).toBe("linked");
  });

  it("links nothing for an anonymous visitor, an unknown token, a staff member or a student whose email is not verified", async () => {
    const staff = await makeStudent({ role: "admin" });
    const unverified = await makeStudent({ verified: false });
    for (const token of [null, "z".repeat(32), staff.user.token, unverified.user.token]) {
      const outcome = await asRuntime(() => insertLead(t.db, newLead(), token));
      expect(outcome.kind).toBe("created");
      expect((await rows(`select user_id from lead where id = ${q((outcome as { id: string }).id)}`))[0]?.user_id, String(token)).toBeNull();
    }
  });

  it("does not link an old lead, a lead that belongs to someone, or a lead the caller did not just make", async () => {
    const student = await makeStudent();
    const owner = await makeStudent();
    const old = await leadRow(t, { received_at: new Date(Date.now() - 600_000).toISOString() });
    const taken = await linkedLead(owner);
    for (const id of [old, taken.id]) {
      const [row] = await asRuntime(async () => (await t.run(`select public.app_link_new_lead(${q(id)}::uuid, ${q(student.user.token)}) as ok`)) as Record<string, unknown>[]);
      expect(row?.ok, id).toBe(false);
    }
    expect((await rows(`select user_id from lead where id = ${q(taken.id)}`))[0]?.user_id).toBe(owner.user.userId);
  });

  it("a signed-in student whose session ended no longer links", async () => {
    const student = await makeStudent();
    await t.run(`update neon_auth.session set "expiresAt" = now() - interval '1 minute' where token = ${q(student.user.token)}`);
    const outcome = await asRuntime(() => insertLead(t.db, newLead(), student.user.token));
    expect((await rows(`select user_id from lead where id = ${q((outcome as { id: string }).id)}`))[0]?.user_id).toBeNull();
  });

  it("a link request by reference or by number creates a pending claim and links nothing", async () => {
    const student = await makeStudent();
    const target = await leadRow(t, { whatsapp_e164: "+233201234567" });
    const ref = String((await rows(`select ref from lead where id = ${q(target)}`))[0]?.ref);
    const byRef = await post("student.requestLink", student, { reference: ref.toLowerCase() });
    expect(byRef).toMatchObject({ status: 200, json: { status: "sent" } });
    expect(await rows(`select method, status from lead_claim where user_id = ${q(student.user.userId)} and lead_id = ${q(target)}`)).toEqual([{ method: "ref", status: "pending" }]);
    expect((await rows(`select user_id from lead where id = ${q(target)}`))[0]?.user_id).toBeNull();
    // Asking again does not make a second request.
    await post("student.requestLink", student, { reference: ref });
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(student.user.userId)} and lead_id = ${q(target)}`)).toBe(1);

    const second = await makeStudent();
    const byNumber = await post("student.requestLink", second, { reference: "0201234567", country: "GH" });
    expect(byNumber.status).toBe(200);
    expect(await rows(`select method, status from lead_claim where user_id = ${q(second.user.userId)}`)).toEqual([{ method: "number", status: "pending" }]);
    expect((await get("progress", second)).json).toMatchObject({ state: "matching", lead: null, pendingClaims: 1 });
  });

  it("gives the same answer whether or not anything matched, so it cannot be used to find out who applied", async () => {
    const student = await makeStudent();
    const known = await post("student.requestLink", student, { reference: "SC-00000-00000" });
    const unknown = await post("student.requestLink", student, { reference: "+237650000000" });
    expect(known).toEqual(unknown);
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(student.user.userId)}`)).toBe(0);
  });

  it("never offers a lead that belongs to someone else or was erased", async () => {
    const student = await makeStudent();
    const owner = await makeStudent();
    const taken = await linkedLead(owner, { whatsapp_e164: "+233209999999" });
    const gone = await leadRow(t, { whatsapp_e164: "+233208888888" });
    await t.run(`update lead set name = null, whatsapp_e164 = null, email = null, results = '[]', anonymised_at = now() where id = ${q(gone)}`);
    await post("student.requestLink", student, { reference: taken.ref });
    await post("student.requestLink", student, { reference: "+233209999999" });
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(student.user.userId)}`)).toBe(0);
  });

  it("counts every request, whatever it matched: ten a day, then it says so", async () => {
    const student = await makeStudent();
    // Nothing matches any of these, and they still count: guessing is limited, not just matching.
    for (let i = 0; i < 10; i += 1) {
      expect((await post("student.requestLink", student, { reference: `+2337000000${String(i).padStart(2, "0")}` })).status).toBe(200);
    }
    const limited = await post("student.requestLink", student, { reference: "+233700000099" });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe("RATE_LIMITED");
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(student.user.userId)}`)).toBe(0);
    // Another student is not affected.
    expect((await post("student.requestLink", await makeStudent(), { reference: "+233700000099" })).status).toBe(200);
  });

  it("keeps at most five claims waiting, and the answer does not change when the cap is reached", async () => {
    const student = await makeStudent();
    for (let i = 0; i < 6; i += 1) await leadRow(t, { whatsapp_e164: `+23371000000${i}` });
    const answers = [];
    for (let i = 0; i < 6; i += 1) answers.push(await post("student.requestLink", student, { reference: `+23371000000${i}` }));
    // The sixth match found no room and the request after it matches nothing: all seven look the same.
    answers.push(await post("student.requestLink", student, { reference: "+233799999999" }));
    expect(new Set(answers.map((a) => a.status + JSON.stringify(a.json))).size).toBe(1);
    expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(student.user.userId)} and status = 'pending'`)).toBe(5);
  });

  it("refuses text that is neither a reference nor a number, and a number typed without a country", async () => {
    const student = await makeStudent();
    expect((await post("student.requestLink", student, { reference: "hello" })).json.error.fields.reference).toBe("INVALID");
    expect((await post("student.requestLink", student, { reference: "0803 123 4567" })).json.error.fields.reference).toBe("NEEDS_COUNTRY");
    expect((await post("student.requestLink", student, { reference: "" })).json.error.fields.reference).toBe("REQUIRED");
    expect((await post("student.requestLink", student, { reference: "SC-00000-00000", extra: 1 })).status).toBe(400);
  });

  it("an admin approves it in the Stage 5 queue and the student then sees the stage", async () => {
    const student = await makeStudent();
    const lead = await leadRow(t, { whatsapp_e164: "+233205550000", email: null });
    const ref = String((await rows(`select ref from lead where id = ${q(lead)}`))[0]?.ref);
    await post("student.requestLink", student, { reference: ref });
    expect((await get("progress", student)).json.state).toBe("matching");

    const queue = await asRuntime(() => listPendingClaims(t.db, admin));
    const claim = queue.find((c) => c.userId === student.user.userId);
    expect(claim).toBeTruthy();
    const approved = await asRuntime(() => decideClaim(t.db, admin, claim?.claimId ?? "", { decision: "approve", verificationMethod: "whatsapp_confirmed" }));
    expect(approved.outcome).toBe("approved");
    expect((await get("progress", student)).json).toMatchObject({ state: "linked", lead: { ref } });
  });
});

describe("S8.3 profile, export and erasure", () => {
  it("shows the account's name and lets the student change the name", async () => {
    const student = await makeStudent();
    expect((await get("profile", student)).json).toEqual({ name: "Test", email: student.user.email });
    expect((await post("profile.setName", student, { name: "  Ama Mensah " })).status).toBe(200);
    expect((await get("profile", student)).json.name).toBe("Ama Mensah");
    expect((await post("profile.setName", student, { name: " " })).status).toBe(400);
    expect((await post("profile.setName", student, { name: "x".repeat(81) })).status).toBe(400);
  });

  it("exports the student's own data, and logs the export", async () => {
    const student = await makeStudent();
    const stranger = await makeStudent();
    const university = await uni(t, { status: "published" });
    const programme = await insertRow(t, "programme", { id: uuidv7(), university_id: university, name: "B.Sc Physics", status: "published" });
    const mine = await linkedLead(student, { name: "Ama Mensah", email: "ama@example.test" });
    await insertRow(t, "lead_programme_pref", { lead_id: mine.id, programme_id: programme, rank: 1 });
    await t.run(`insert into lead_note (id, lead_id, author_id, body) values (gen_random_uuid(), ${q(mine.id)}, 'staff', 'Internal: call after 5pm')`);
    await linkedLead(stranger, { name: "Someone Else" });

    const answer = await post("student.exportData", student, {});
    expect(answer.status).toBe(200);
    expect(answer.json.account).toEqual({ name: "Test", email: student.user.email });
    expect(answer.json.leads).toHaveLength(1);
    expect(answer.json.leads[0]).toMatchObject({ ref: mine.ref, name: "Ama Mensah", email: "ama@example.test", country: "CM", programmes: [{ rank: 1, programme: "B.Sc Physics" }] });
    const text = JSON.stringify(answer.json);
    expect(text).not.toContain("Someone Else");
    expect(text).not.toContain("call after 5pm");
    expect(text).not.toContain("idempotency");
    expect(text).not.toContain("payload_hash");

    expect(await rows(`select kind, channel, status from data_request where user_id = ${q(student.user.userId)}`)).toEqual([{ kind: "export", channel: "portal", status: "done" }]);
    expect(await count(`select count(*)::int as n from audit_log where action = 'student.exportData' and actor_id = ${q(student.user.userId)}`)).toBe(1);
  });

  it("logs a repeated export once an hour, and still hands the data back each time", async () => {
    const student = await makeStudent();
    for (let i = 0; i < 3; i += 1) expect((await post("student.exportData", student, {})).status).toBe(200);
    expect(await count(`select count(*)::int as n from data_request where user_id = ${q(student.user.userId)} and kind = 'export'`)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'student.exportData' and actor_id = ${q(student.user.userId)}`)).toBe(1);
    await t.run(`update data_request set created_at = now() - interval '2 hours' where user_id = ${q(student.user.userId)}`);
    await post("student.exportData", student, {});
    expect(await count(`select count(*)::int as n from data_request where user_id = ${q(student.user.userId)} and kind = 'export'`)).toBe(2);
  });

  it("an export for a student with nothing is still an export, with empty lists", async () => {
    const student = await makeStudent();
    const answer = await post("student.exportData", student, {});
    expect(answer.json.leads).toEqual([]);
    expect(answer.json.linkRequests).toEqual([]);
  });

  describe("erasure", () => {
    it("needs the word DELETE", async () => {
      const student = await makeStudent();
      for (const body of [{}, { confirm: "delete" }, { confirm: "yes" }, { confirm: "DELETE", extra: 1 }]) expect((await post("student.requestErasure", student, body)).status, JSON.stringify(body)).toBe(400);
      expect(await count(`select count(*)::int as n from app_user where id = ${q(student.user.userId)}`)).toBe(1);
    });

    it("needs a sign-in in the last 10 minutes, and deletes nothing without it", async () => {
      const student = await makeStudent();
      await linkedLead(student);
      await t.run(`update neon_auth.session set "createdAt" = now() - interval '11 minutes' where token = ${q(student.user.token)}`);
      const answer = await post("student.requestErasure", student, { confirm: "DELETE" });
      expect(answer.status).toBe(403);
      expect(answer.json.error).toMatchObject({ code: "STEP_UP_REQUIRED", fields: { session: "REAUTH_REQUIRED" } });
      expect(await count(`select count(*)::int as n from app_user where id = ${q(student.user.userId)}`)).toBe(1);
      expect(await count(`select count(*)::int as n from lead where user_id = ${q(student.user.userId)} and anonymised_at is null`)).toBe(1);
    });

    it("is for students: a team account is told to ask the owner", async () => {
      const staff = await makeStudent({ role: "admin" });
      const answer = await post("student.requestErasure", staff, { confirm: "DELETE" });
      expect(answer.status).toBe(409);
      expect(answer.json.error.fields.account).toBe("STAFF");
      expect(await count(`select count(*)::int as n from app_user where id = ${q(staff.user.userId)}`)).toBe(1);
    });

    it("anonymises the leads, deletes the account and its sessions, keeps payments without the link, and records it", async () => {
      const student = await makeStudent();
      const bystander = await makeStudent();
      const university = await uni(t, { status: "published" });
      const first = await linkedLead(student, { name: "Ama Mensah", email: "ama@example.test", results: [{ subject: "Maths", grade: "A" }] });
      const second = await linkedLead(student);
      const merged = await leadRow(t, { merged_into_id: first.id, name: "Ama M." });
      await linkedLead(bystander, { name: "Bystander" });
      const payment = await paymentRow(t, university, { lead_id: first.id });
      await t.run(`insert into lead_note (id, lead_id, author_id, body) values (gen_random_uuid(), ${q(first.id)}, 'staff', 'Ama called twice')`);
      await t.run(`insert into event (id, type, lead_ref, lead_id) values (gen_random_uuid(), 'wa_tap', ${q(first.ref)}, ${q(first.id)})`);
      await t.run(`insert into lead_claim (id, user_id, lead_id, method, status) values (gen_random_uuid(), ${q(student.user.userId)}, ${q(second.id)}, 'auto', 'approved')`);
      await t.run(`insert into neon_auth.account ("accountId", "providerId", "userId") values ('g-1', 'google', ${q(student.user.userId)})`);

      const answer = await post("student.requestErasure", student, { confirm: "DELETE" });
      expect(answer).toMatchObject({ status: 200, json: { erased: true } });

      // The leads: personal fields gone, the lead itself kept for the counts.
      for (const id of [first.id, second.id, merged]) {
        const [lead] = await rows(`select name, whatsapp_e164, email, results, user_id, anonymised_at from lead where id = ${q(id)}`);
        expect(lead, id).toMatchObject({ name: null, whatsapp_e164: null, email: null, results: [], user_id: null });
        expect(lead?.anonymised_at).not.toBeNull();
      }
      expect((await rows(`select body, erased_at from lead_note where lead_id = ${q(first.id)}`))[0]).toMatchObject({ body: "[erased]" });
      expect((await rows(`select lead_ref, lead_id from event where type = 'wa_tap' and lead_ref is null`)).length).toBeGreaterThanOrEqual(1);
      // The payment stays, without the link.
      const stored = (await rows(`select lead_id, amount_usd_cents from placement_payment where id = ${q(payment)}`))[0];
      expect(stored).toMatchObject({ lead_id: null });
      // A bigint column: the Postgres driver hands it back as text, PGlite as a number.
      expect(Number(stored?.amount_usd_cents)).toBe(150000);
      // The account, its link requests and its Neon Auth rows are gone.
      expect(await count(`select count(*)::int as n from app_user where id = ${q(student.user.userId)}`)).toBe(0);
      expect(await count(`select count(*)::int as n from lead_claim where user_id = ${q(student.user.userId)}`)).toBe(0);
      expect(await count(`select count(*)::int as n from neon_auth."user" where id = ${q(student.user.userId)}`)).toBe(0);
      expect(await count(`select count(*)::int as n from neon_auth.session where "userId" = ${q(student.user.userId)}`)).toBe(0);
      expect(await count(`select count(*)::int as n from neon_auth.account where "userId" = ${q(student.user.userId)}`)).toBe(0);
      // It is on record, without the person.
      expect(await rows(`select kind, channel, status, lead_id from data_request where user_id = ${q(student.user.userId)}`)).toEqual([{ kind: "erasure", channel: "portal", status: "done", lead_id: null }]);
      const [audit] = await rows(`select action, meta from audit_log where action = 'student.requestErasure' and actor_id = ${q(student.user.userId)}`);
      expect(audit?.meta).toEqual({ leads_erased: 3 });
      // Someone else's data is untouched.
      expect((await rows(`select name from lead where user_id = ${q(bystander.user.userId)}`))[0]?.name).toBe("Bystander");
      // The same session cannot erase twice.
      expect((await post("student.requestErasure", student, { confirm: "DELETE" })).status).toBe(404);
    });
  });
});
