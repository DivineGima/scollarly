import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/hash";
import { auditDataCalls } from "@/modules/audit/endpoints";
import { authDataCalls, authMutations } from "@/modules/auth/endpoints";
import { profileDataCalls, profileMutations } from "@/modules/profile/endpoints";
import { teamDataCalls, teamMutations } from "@/modules/team/endpoints";
import { STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import { type AuthedDeps, handleAuthed } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleLanding } from "@/server/edge/landing";
import { handleMutation, type MutationDeps } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { createTestDb, type TestDb } from "./helpers/db";
import { leadRow, q } from "./helpers/fixtures";

/**
 * Stage 2 end to end on a real Postgres engine: the real edge router, the real facade over the real session function,
 * the repositories, row level security as the runtime role, and migration 0004. Each test file gets a fresh database.
 */

const COOKIE = "__Secure-neon-auth.session_token";
const ORIGIN = "https://scollarly.test";
const OWNER_EMAIL = "owner@example.test";
const TOTP_KEY = Buffer.from(randomBytes(32)).toString("base64");

interface Session {
  userId: string;
  sessionId: string;
  token: string;
  email: string;
}

let t: TestDb;
let now = new Date();
let env: EndpointEnv;
let facade: ReturnType<typeof createAuthFacade>;
let limiterHits = 0;

let student: Session;
let admin: Session;
let owner: Session; // the owner's first session: never passed 2FA
let ownerFresh: Session; // same user, 2FA verified just now
let ownerStale: Session; // same user, 2FA verified 11 minutes ago

const cookieOf = (token: string) => `${COOKIE}=${token}.signature`;

async function addSession(user: Session): Promise<Session> {
  const token = randomBytes(24).toString("hex").slice(0, 32);
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  const [row] = (await t.run(
    `insert into neon_auth.session ("expiresAt", token, "userId", "updatedAt") values (${q(expires)}, ${q(token)}, ${q(user.userId)}, now()) returning id`,
  )) as { id: string }[];
  return { ...user, token, sessionId: row?.id ?? "" };
}

async function stepUpAt(session: Session, ageMs: number) {
  await t.run(
    `insert into step_up (session_id, user_id, verified_at) values (${q(session.sessionId)}, ${q(session.userId)}, ${q(new Date(now.getTime() - ageMs).toISOString())})
     on conflict (session_id) do update set verified_at = excluded.verified_at`,
  );
}

async function newUser(role: "student" | "admin" | "owner", email?: string, verified = true): Promise<Session> {
  const user = await t.signIn({ ...(email ? { email } : {}), verified });
  await t.run(`insert into app_user (id, role) values (${q(user.userId)}, ${q(role)})`);
  return user;
}

beforeAll(async () => {
  t = await createTestDb();
  env = { db: t.db, ownerEmail: OWNER_EMAIL, totpKey: TOTP_KEY, now: () => now };
  facade = createAuthFacade((token) => resolveSession(t.db, token));
  student = await newUser("student");
  admin = await newUser("admin");
  owner = await newUser("owner", OWNER_EMAIL);
  ownerFresh = await addSession(owner);
  ownerStale = await addSession(owner);
  await stepUpAt(ownerFresh, 0);
  await stepUpAt(ownerStale, STEP_UP_WINDOW_MS + 60_000);
});
afterAll(async () => {
  await t.close();
});

/** Every request runs as the Worker's runtime role, so row level security applies to the handlers too. */
async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

const mutationDeps = (limit = 1000): MutationDeps => ({
  checkSession: facade.checkSession,
  env,
  mutations: { ...authMutations, ...profileMutations, ...teamMutations },
  limit: async () => {
    limiterHits += 1;
    return limiterHits > limit ? { allowed: false, remaining: 0, retryAfterSeconds: 30 } : { allowed: true, remaining: limit - limiterHits, retryAfterSeconds: 0 };
  },
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function post(path: string, session: Session | null, body?: unknown, headers: Record<string, string> = {}, limit?: number) {
  const request = new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(session ? { cookie: cookieOf(session.token) } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await asRuntime(() => handleMutation(request, () => mutationDeps(limit)));
  expect(response, `${path} must be handled by the mutation router`).not.toBeNull();
  return { status: (response as Response).status, json: (await (response as Response).json()) as Json, headers: (response as Response).headers };
}

const authedDeps = (): AuthedDeps => ({
  checkSession: facade.checkSession,
  cache: { match: async () => undefined, put: async () => undefined },
  next: async () => new Response("shell"),
  waitUntil: () => undefined,
  api: { ...authDataCalls(env), ...profileDataCalls(env), ...teamDataCalls(env), ...auditDataCalls(env) },
});

async function get(path: string, session: Session | null) {
  const request = new Request(`${ORIGIN}${path}`, { headers: session ? { cookie: cookieOf(session.token) } : {} });
  const response = await asRuntime(() => handleAuthed(request, authedDeps));
  expect(response, `${path} must be handled by the signed-in router`).not.toBeNull();
  return { status: (response as Response).status, json: (await (response as Response).json()) as Json };
}

const count = async (sqlText: string) => ((await t.run(sqlText)) as { n: number }[])[0]?.n ?? 0;
const codeFor = (secret: string, at: Date) => new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: at.getTime() });
const tokenOfLink = (link: string) => link.slice(link.lastIndexOf("/") + 1);

describe("S2.5: invites and the team endpoints", () => {
  it("refuses a visitor, a student, an admin and an owner who has not passed 2FA, and asks for a fresh code when it is stale", async () => {
    const body = { email: "new.admin@example.test" };
    expect((await post("/api/v1/admin/team.invite", null, body)).status).toBe(401);
    expect((await post("/api/v1/admin/team.invite", student, body)).status).toBe(403);
    expect((await post("/api/v1/admin/team.invite", admin, body)).status).toBe(403);
    expect((await post("/api/v1/admin/team.invite", owner, body)).status).toBe(403); // no 2FA yet: treated as a student

    const stale = await post("/api/v1/admin/team.invite", ownerStale, body);
    expect(stale.status).toBe(403);
    expect(stale.json.error.code).toBe("STEP_UP_REQUIRED");
    expect(await count(`select count(*)::int as n from admin_invite`)).toBe(0);
  });

  it("creates an invite: a copyable link, only the hash of the token stored, 7 days, and an audit row", async () => {
    const created = await post("/api/v1/admin/team.invite", ownerFresh, { email: "  Priya.Admin@Example.TEST " });
    expect(created.status).toBe(201);
    expect(created.json.email).toBe("priya.admin@example.test");
    expect(created.json.link).toMatch(new RegExp(`^${ORIGIN}/accept-invite/[A-Za-z0-9_-]{43}$`));
    expect(new Date(created.json.expiresAt).getTime() - now.getTime()).toBe(7 * 24 * 3_600_000);

    const token = tokenOfLink(created.json.link);
    const [row] = (await t.run(`select token_hash, email from admin_invite where id = ${q(created.json.id)}`)) as { token_hash: string; email: string }[];
    expect(row?.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(await t.run(`select * from admin_invite`))).not.toContain(token);
    expect(await count(`select count(*)::int as n from audit_log where action = 'team.invite' and actor_id = ${q(owner.userId)}`)).toBe(1);
    // The audit row holds ids only, never the email.
    expect(JSON.stringify(await t.run(`select meta from audit_log where action = 'team.invite'`))).not.toContain("priya");
  });

  it("resends by replacing the open invite: the old link stops working and there is never more than one open invite per email", async () => {
    const first = (await post("/api/v1/admin/team.invite", ownerFresh, { email: "resend@example.test" })).json;
    const second = (await post("/api/v1/admin/team.invite", ownerFresh, { email: "RESEND@example.test" })).json;
    expect(second.link).not.toBe(first.link);
    expect(await count(`select count(*)::int as n from admin_invite where lower(email) = 'resend@example.test' and revoked_at is null and accepted_at is null`)).toBe(1);

    const check = async (link: string) => (await post("/api/v1/invites/check", null, { token: tokenOfLink(link) })).json;
    expect(await check(first.link)).toEqual({ status: "unusable" });
    expect(await check(second.link)).toEqual({ status: "open", email: "resend@example.test" });
  });

  it("rejects a bad email, an unknown field and a cross-origin request, and tells someone already on the team", async () => {
    const bad = await post("/api/v1/admin/team.invite", ownerFresh, { email: "not-an-email" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.fields).toHaveProperty("email");
    expect((await post("/api/v1/admin/team.invite", ownerFresh, { email: "a@example.test", role: "owner" })).status).toBe(400);
    expect((await post("/api/v1/admin/team.invite", ownerFresh, { email: "a@example.test" }, { origin: "https://evil.example" })).status).toBe(403);

    const staff = await post("/api/v1/admin/team.invite", ownerFresh, { email: OWNER_EMAIL.toUpperCase() });
    expect(staff.status).toBe(409);
    expect(staff.json.error.fields).toEqual({ email: "ALREADY_STAFF" });
  });

  it("revokes an invite once and reports nothing to revoke the second time; a revoked link is unusable", async () => {
    const made = (await post("/api/v1/admin/team.invite", ownerFresh, { email: "revoke.me@example.test" })).json;
    expect((await post("/api/v1/admin/team.revokeInvite", ownerFresh, { id: made.id })).json).toEqual({ revoked: true });
    expect((await post("/api/v1/admin/team.revokeInvite", ownerFresh, { id: made.id })).json).toEqual({ revoked: false });
    expect((await post("/api/v1/invites/check", null, { token: tokenOfLink(made.link) })).json).toEqual({ status: "unusable" });
    expect(await count(`select count(*)::int as n from audit_log where action = 'team.revokeInvite'`)).toBe(1);
    expect((await post("/api/v1/admin/team.revokeInvite", admin, { id: made.id })).status).toBe(403);
  });

  it("shows the team page to the owner only, with open invites and expired ones marked", async () => {
    expect((await get("/api/v1/admin/team", admin)).status).toBe(403);
    expect((await get("/api/v1/admin/team", owner)).status).toBe(403); // no 2FA: a student
    expect((await get("/api/v1/admin/team", null)).status).toBe(401);

    await t.run(
      `insert into admin_invite (id, email, token_hash, invited_by, created_at, expires_at) values (gen_random_uuid(), 'old@example.test', ${q("f".repeat(64))}, ${q(owner.userId)}, now() - interval '10 days', now() - interval '3 days')`,
    );
    const page = await get("/api/v1/admin/team", ownerFresh);
    expect(page.status).toBe(200);
    expect(page.json.members.map((m: Json) => m.email).sort()).toEqual([admin.email, OWNER_EMAIL].sort());
    expect(page.json.members.find((m: Json) => m.email === OWNER_EMAIL)).toMatchObject({ role: "owner", isYou: true });
    const states = Object.fromEntries(page.json.invites.map((i: Json) => [i.email, i.state]));
    expect(states["old@example.test"]).toBe("expired");
    expect(states["priya.admin@example.test"]).toBe("open");
  });
});

describe("S2.5: accepting an invite (landing step, B0)", () => {
  const landing = async (session: Session | null, query = "") => {
    const scrubbed: Promise<unknown>[] = [];
    const request = new Request(`${ORIGIN}/auth/landing${query}`, { headers: session ? { cookie: cookieOf(session.token) } : {} });
    const response = await asRuntime(() => handleLanding(request, () => ({ checkSession: facade.checkSession, env, waitUntil: (task) => void scrubbed.push(task) })));
    await Promise.all(scrubbed);
    return { location: new URL((response as Response).headers.get("location") ?? "", ORIGIN).pathname + new URL((response as Response).headers.get("location") ?? "", ORIGIN).search, status: (response as Response).status };
  };
  const invite = async (email: string) => tokenOfLink((await post("/api/v1/admin/team.invite", ownerFresh, { email })).json.link);

  it("makes the invited person an admin when Google's verified email matches, in any letter case, and the link works once", async () => {
    const token = await invite("accept.me@example.test");
    const person = await t.signIn({ email: "Accept.Me@Example.test" });
    expect(await landing(person, `?invite=${token}`)).toEqual({ status: 302, location: "/admin" });
    expect(await count(`select count(*)::int as n from app_user where id = ${q(person.userId)} and role = 'admin'`)).toBe(1);
    expect(await count(`select count(*)::int as n from audit_log where action = 'team.acceptInvite' and actor_id = ${q(person.userId)}`)).toBe(1);

    // A second person with the right email cannot reuse the used link.
    const again = await t.signIn({ email: "accept.me+2@example.test" });
    expect((await landing(again, `?invite=${token}`)).location).toBe(`/accept-invite/${token}?error=1`);
  });

  it("refuses a different email, an unverified email, an expired link and a revoked link, with the same answer, and changes no role", async () => {
    const token = await invite("target.admin@example.test");
    const wrong = await t.signIn({ email: "someone.else@example.test" });
    const unverified = await t.signIn({ email: "target.admin@example.test", verified: false }).catch(() => null);
    expect((await landing(wrong, `?invite=${token}`)).location).toBe(`/accept-invite/${token}?error=1`);
    if (unverified) expect((await landing(unverified, `?invite=${token}`)).location).toBe("/sign-in?error=failed"); // no session is trusted for an unverified email
    expect(await count(`select count(*)::int as n from app_user where id = ${q(wrong.userId)} and role <> 'student'`)).toBe(0);

    const expiring = await invite("late@example.test");
    await t.run(`update admin_invite set expires_at = now() - interval '1 second', created_at = now() - interval '8 days' where token_hash = ${q(await sha256Hex(expiring))}`);
    const late = await t.signIn({ email: "late@example.test" });
    expect((await landing(late, `?invite=${expiring}`)).location).toBe(`/accept-invite/${expiring}?error=1`);

    const revoked = await invite("gone@example.test");
    await t.run(`update admin_invite set revoked_at = now() where token_hash = ${q(await sha256Hex(revoked))}`);
    const gone = await t.signIn({ email: "gone@example.test" });
    expect((await landing(gone, `?invite=${revoked}`)).location).toBe(`/accept-invite/${revoked}?error=1`);
  });

  it("never demotes the owner, whatever invite they open, and drops a malformed invite token", async () => {
    await t.run(`delete from admin_invite where lower(email) = lower(${q(OWNER_EMAIL)})`);
    await t.run(
      `insert into admin_invite (id, email, token_hash, invited_by, expires_at) values (gen_random_uuid(), ${q(OWNER_EMAIL)}, ${q(await sha256Hex("o".repeat(43)))}, ${q(owner.userId)}, now() + interval '1 day')`,
    );
    expect((await landing(owner, `?invite=${"o".repeat(43)}`)).location).toBe(`/accept-invite/${"o".repeat(43)}?error=1`);
    expect(await count(`select count(*)::int as n from app_user where id = ${q(owner.userId)} and role = 'owner'`)).toBe(1);
    expect((await landing(student, "?invite=short")).location).toBe("/sign-in");
  });
});

describe("S2.3: sign-in landing and owner bootstrap", () => {
  const landing = async (session: Session | null) => {
    const request = new Request(`${ORIGIN}/auth/landing`, { headers: session ? { cookie: cookieOf(session.token) } : {} });
    const response = (await asRuntime(() => handleLanding(request, () => ({ checkSession: facade.checkSession, env, waitUntil: () => undefined })))) as Response;
    return new URL(response.headers.get("location") ?? "", ORIGIN).pathname + new URL(response.headers.get("location") ?? "", ORIGIN).search;
  };

  it("sends a visitor with no session back to sign-in, a student to /me and an admin to /admin", async () => {
    expect(await landing(null)).toBe("/sign-in?error=failed");
    expect(await landing(student)).toBe("/me");
    expect(await landing(admin)).toBe("/admin");
  });

  it("sends the owner to enrol, then to verify once an authenticator is confirmed, then to /admin once verified in this session", async () => {
    expect(await landing(owner)).toBe("/two-factor/enrol");
    await t.run(`insert into owner_totp (user_id, secret_encrypted, confirmed) values (${q(owner.userId)}, 'v1.x.y', true)`);
    expect(await landing(owner)).toBe("/two-factor/verify");
    expect(await landing(ownerFresh)).toBe("/admin");
    await t.run(`delete from owner_totp where user_id = ${q(owner.userId)}`);
  });

  it("gives the owner role only to the verified OWNER_EMAIL, only while no owner exists, and writes an audit row", async () => {
    // The owner already exists in this database, so a second person with the same email cannot become one.
    const impostor = await t.signIn({ email: "OWNER@example.test".replace("OWNER", "owner2") });
    expect(await landing(impostor)).toBe("/me");
    expect(await count(`select count(*)::int as n from app_user where role = 'owner'`)).toBe(1);
  });

  it("clears the visitor's IP address and browser string from the session at landing (flag F13)", async () => {
    const person = await t.signIn({ email: "pii@example.test" });
    await t.run(`alter table neon_auth.session disable trigger app_blank_session_pii`);
    await t.run(`update neon_auth.session set "ipAddress" = '203.0.113.7', "userAgent" = 'Mozilla' where token = ${q(person.token)}`);
    await t.run(`alter table neon_auth.session enable trigger app_blank_session_pii`);
    const scrubbed: Promise<unknown>[] = [];
    await asRuntime(() => handleLanding(new Request(`${ORIGIN}/auth/landing`, { headers: { cookie: cookieOf(person.token) } }), () => ({ checkSession: facade.checkSession, env, waitUntil: (task) => void scrubbed.push(task) })));
    await Promise.all(scrubbed);
    expect(await t.run(`select "ipAddress", "userAgent" from neon_auth.session where token = ${q(person.token)}`)).toEqual([{ ipAddress: null, userAgent: null }]);
  });

  it("blanks the IP address and browser string as the row is written, by trigger (flag F13)", async () => {
    const person = await t.signIn({ email: "trigger@example.test" });
    await t.run(`update neon_auth.session set "ipAddress" = '198.51.100.9', "userAgent" = 'Safari', "updatedAt" = now() where token = ${q(person.token)}`);
    expect(await t.run(`select "ipAddress", "userAgent" from neon_auth.session where token = ${q(person.token)}`)).toEqual([{ ipAddress: null, userAgent: null }]);
  });
});

describe("S2.3: owner two-factor through the endpoints", () => {
  let secret = "";
  let recoveryCodes: string[] = [];

  it("refuses everyone but the owner account", async () => {
    for (const who of [null, student, admin]) {
      const res = await post("/api/v1/auth/twoFactor.begin", who);
      expect(res.status, who?.email ?? "visitor").toBe(who ? 403 : 401);
    }
    expect((await get("/api/v1/auth/two-factor-status", admin)).status).toBe(403);
  });

  it("enrols: a wrong code is refused, the right one confirms and shows ten recovery codes once", async () => {
    expect((await get("/api/v1/auth/two-factor-status", owner)).json).toMatchObject({ enrolled: false, pending: false, verified: false });
    const begun = await post("/api/v1/auth/twoFactor.begin", owner);
    expect(begun.status).toBe(200);
    expect(begun.json.otpauthUri).toContain("otpauth://totp/");
    secret = begun.json.secret as string;
    expect((await get("/api/v1/auth/two-factor-status", owner)).json).toMatchObject({ enrolled: false, pending: true });

    const wrong = await post("/api/v1/auth/twoFactor.confirm", owner, { code: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.fields).toEqual({ code: "INVALID_CODE" });

    const good = await post("/api/v1/auth/twoFactor.confirm", owner, { code: codeFor(secret, now) });
    expect(good.status).toBe(200);
    recoveryCodes = good.json.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await count(`select count(*)::int as n from recovery_code where user_id = ${q(owner.userId)} and used_at is null`)).toBe(10);
    // The codes themselves are not stored, only hashes.
    expect(JSON.stringify(await t.run(`select code_hash from recovery_code`))).not.toContain(recoveryCodes[0]?.replace(/-/g, "") ?? "x");
    expect(await count(`select count(*)::int as n from audit_log where action = 'security.twoFactorEnrolled'`)).toBe(1);
    expect((await get("/api/v1/auth/two-factor-status", owner)).json).toMatchObject({ enrolled: true, verified: true, stepUpFresh: true });
  });

  it("will not enrol a second authenticator once one is confirmed", async () => {
    const again = await post("/api/v1/auth/twoFactor.begin", owner);
    expect(again.status).toBe(409);
    expect(again.json.error.fields).toEqual({ code: "ALREADY_ENROLLED" });
  });

  it("refuses a replayed code, accepts the next 30-second code and one step of clock drift", async () => {
    const step = new Date(now.getTime() + 5 * 60_000);
    now = step;
    const first = await post("/api/v1/auth/twoFactor.verify", ownerFresh, { code: codeFor(secret, now) });
    expect(first.status).toBe(200);
    const replay = await post("/api/v1/auth/twoFactor.verify", ownerFresh, { code: codeFor(secret, now) });
    expect(replay.status).toBe(400);
    expect(replay.json.error.fields).toEqual({ code: "CODE_ALREADY_USED" });

    now = new Date(now.getTime() + 30_000);
    const drifted = new Date(now.getTime() + 30_000); // the phone's clock is one step ahead
    expect((await post("/api/v1/auth/twoFactor.verify", ownerFresh, { code: codeFor(secret, drifted) })).status).toBe(200);
  });

  it("uses a recovery code once", async () => {
    const code = recoveryCodes[0] as string;
    expect((await post("/api/v1/auth/twoFactor.recovery", owner, { code })).status).toBe(200);
    const reused = await post("/api/v1/auth/twoFactor.recovery", owner, { code });
    expect(reused.status).toBe(400);
    expect(reused.json.error.fields).toEqual({ code: "INVALID_CODE" });
    expect(await count(`select count(*)::int as n from audit_log where action = 'security.recoveryCodeUsed'`)).toBe(1);
  });

  it("locks the account after five wrong codes, with a Retry-After, and refuses even the right code while locked", async () => {
    now = new Date(now.getTime() + 10 * 60_000);
    let last = await post("/api/v1/auth/twoFactor.verify", owner, { code: "111111" });
    for (let i = 0; i < 4; i++) last = await post("/api/v1/auth/twoFactor.verify", owner, { code: "111111" });
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBe("900");
    const locked = await post("/api/v1/auth/twoFactor.verify", owner, { code: codeFor(secret, now) });
    expect(locked.status).toBe(429);
    now = new Date(now.getTime() + 16 * 60_000); // the lock ends
    expect((await post("/api/v1/auth/twoFactor.verify", owner, { code: codeFor(secret, now) })).status).toBe(200);
  });

  it("rejects a malformed body without touching the factor", async () => {
    expect((await post("/api/v1/auth/twoFactor.verify", owner, {})).status).toBe(400);
    expect((await post("/api/v1/auth/twoFactor.verify", owner, { code: "123456", extra: 1 })).status).toBe(400);
  });
});

describe("S2.4: removing an admin", () => {
  it("cuts access on the very next request, with the old cookie, and returns their leads to the unassigned pool", async () => {
    const leaving = await newUser("admin", "leaving@example.test");
    const l1 = await leadRow(t, { assigned_admin_id: leaving.userId });
    await leadRow(t, { assigned_admin_id: leaving.userId });
    await leadRow(t, { assigned_admin_id: admin.userId });
    expect((await get("/api/v1/admin/session", leaving)).status).toBe(200);
    const other = await addSession(leaving); // a second device

    const refusedWithoutStepUp = await post("/api/v1/admin/team.removeAdmin", ownerStale, { userId: leaving.userId });
    expect(refusedWithoutStepUp.json.error.code).toBe("STEP_UP_REQUIRED");

    await stepUpAt(ownerFresh, 0);
    const removed = await post("/api/v1/admin/team.removeAdmin", ownerFresh, { userId: leaving.userId });
    expect(removed.status).toBe(200);
    expect(removed.json).toEqual({ removed: true, leadsReleased: 2 });

    // The very next request with the old cookie: a data call and a mutation, on both devices.
    for (const session of [leaving, other]) {
      expect((await get("/api/v1/admin/session", session)).status).toBe(401);
      expect((await post("/api/v1/admin/profile.signOutOthers", session)).status).toBe(401);
    }
    expect(await t.run(`select role from app_user where id = ${q(leaving.userId)}`)).toEqual([{ role: "student" }]);
    expect(await count(`select count(*)::int as n from lead where assigned_admin_id = ${q(leaving.userId)}`)).toBe(0);
    expect(await count(`select count(*)::int as n from lead where assigned_admin_id = ${q(admin.userId)}`)).toBe(1);
    expect(await t.run(`select type, data->>'reason' as reason from lead_activity where lead_id = ${q(l1)} and type = 'assigned'`)).toEqual([{ type: "assigned", reason: "admin_removed" }]);
    expect(await count(`select count(*)::int as n from audit_log where action = 'team.removeAdmin' and entity_id = ${q(leaving.userId)}`)).toBe(1);
    // The user record is kept for the audit trail; Neon's session rows are expired, not deleted.
    expect(await count(`select count(*)::int as n from neon_auth.session where "userId" = ${q(leaving.userId)}`)).toBe(2);
  });

  it("refuses to remove a student, the owner, an unknown user, and refuses an admin who tries", async () => {
    expect((await post("/api/v1/admin/team.removeAdmin", ownerFresh, { userId: student.userId })).status).toBe(404);
    expect((await post("/api/v1/admin/team.removeAdmin", ownerFresh, { userId: owner.userId })).status).toBe(404);
    expect((await post("/api/v1/admin/team.removeAdmin", ownerFresh, { userId: "no-such-user" })).status).toBe(404);
    expect((await post("/api/v1/admin/team.removeAdmin", admin, { userId: admin.userId })).status).toBe(403);
    expect(await t.run(`select role from app_user where id = ${q(owner.userId)}`)).toEqual([{ role: "owner" }]);
  });

  it("cannot be done by calling the database function as a non-owner", async () => {
    await asRuntime(async () => {
      await t.run(`select set_config('app.user_id', ${q(admin.userId)}, false), set_config('app.role', 'admin', false)`);
      await expect(t.run(`select public.app_remove_admin(${q(admin.userId)})`)).rejects.toThrow(/Only the owner/);
      await t.run(`select set_config('app.user_id', '', false), set_config('app.role', '', false)`);
    });
  });
});

describe("S2.4: the owner is permanent, and only one owner can exist", () => {
  it("refuses any update that removes the owner role, from the owner or anyone else", async () => {
    await expect(t.run(`update app_user set role = 'student' where id = ${q(owner.userId)}`)).rejects.toThrow(/owner role cannot be removed/);
    await expect(t.run(`update app_user set role = 'admin' where id = ${q(owner.userId)}`)).rejects.toThrow(/owner role cannot be removed/);
    expect(await t.run(`select role from app_user where id = ${q(owner.userId)}`)).toEqual([{ role: "owner" }]);
  });

  it("refuses a second owner", async () => {
    await expect(t.run(`update app_user set role = 'owner' where id = ${q(admin.userId)}`)).rejects.toThrow(/app_user_single_owner|duplicate key/);
  });
});

describe("S2.6 and C6: profile, sessions, security", () => {
  it("shows the signed-in person their own session data, and the menu role is the effective role", async () => {
    expect((await get("/api/v1/admin/session", admin)).json).toMatchObject({ role: "admin", email: admin.email, stepUpFresh: false });
    expect((await get("/api/v1/admin/session", ownerFresh)).json).toMatchObject({ role: "owner", stepUpFresh: true });
    expect((await get("/api/v1/admin/session", student)).status).toBe(403);
    expect((await get("/api/v1/admin/session", null)).status).toBe(401);
  });

  it("edits the display name for that person only, and refuses an empty or oversized name", async () => {
    expect((await post("/api/v1/admin/profile.setName", admin, { name: "  Priya Nair " })).json).toEqual({ saved: true });
    expect((await get("/api/v1/admin/session", admin)).json.name).toBe("Priya Nair");
    expect(await t.run(`select name from neon_auth."user" where id = ${q(student.userId)}`)).toEqual([{ name: "Test" }]);
    expect((await post("/api/v1/admin/profile.setName", admin, { name: "   " })).status).toBe(400);
    expect((await post("/api/v1/admin/profile.setName", admin, { name: "x".repeat(81) })).status).toBe(400);
    expect((await post("/api/v1/admin/profile.setName", student, { name: "Hacker" })).status).toBe(403);
  });

  it("signs out other devices but not this one", async () => {
    const tablet = await newUser("admin"); // its own user, so the other tests keep their admin session
    const phone = await addSession(tablet);
    const laptop = await addSession(tablet);
    const res = await post("/api/v1/admin/profile.signOutOthers", phone);
    expect(res.status).toBe(200);
    expect(res.json.ended).toBe(2);
    expect((await get("/api/v1/admin/session", phone)).status).toBe(200);
    expect((await get("/api/v1/admin/session", laptop)).status).toBe(401);
    expect((await get("/api/v1/admin/session", tablet)).status).toBe(401);
  });

  it("shows the owner 2FA status and active sessions, marks the current one, and keeps everyone else out", async () => {
    const page = await get("/api/v1/admin/security", ownerFresh);
    expect(page.status).toBe(200);
    expect(page.json.twoFactorEnabled).toBe(true);
    expect(page.json.sessions.filter((s: Json) => s.isCurrent)).toHaveLength(1);
    expect(JSON.stringify(page.json)).not.toMatch(/ip|agent/i);
    const fresh = await newUser("admin");
    expect((await get("/api/v1/admin/security", fresh)).status).toBe(403);
    expect((await get("/api/v1/admin/security", await addSession(owner))).status).toBe(403); // a new owner session with no 2FA check
  });

  it("regenerates recovery codes only after a fresh check, and the old codes stop working", async () => {
    const refused = await post("/api/v1/admin/security.regenerateRecoveryCodes", ownerStale);
    expect(refused.json.error.code).toBe("STEP_UP_REQUIRED");
    const before = (await t.run(`select count(*)::int as n from recovery_code where user_id = ${q(owner.userId)} and used_at is null`)) as { n: number }[];
    const done = await post("/api/v1/admin/security.regenerateRecoveryCodes", ownerFresh);
    expect(done.status).toBe(200);
    expect(done.json.recoveryCodes).toHaveLength(10);
    expect(before[0]?.n).toBeGreaterThan(0);
    expect(await count(`select count(*)::int as n from recovery_code where user_id = ${q(owner.userId)} and used_at is null`)).toBe(10);
    expect(await count(`select count(*)::int as n from audit_log where action = 'security.recoveryCodesRegenerated'`)).toBe(1);
  });

  it("signs out everywhere (owner), audits it, and leaves this session", async () => {
    const extra = await addSession(owner);
    const done = await post("/api/v1/admin/security.signOutEverywhere", ownerFresh);
    expect(done.status).toBe(200);
    expect((await get("/api/v1/admin/session", extra)).status).toBe(401);
    expect((await get("/api/v1/admin/session", ownerFresh)).status).toBe(200);
    expect((await post("/api/v1/admin/security.signOutEverywhere", admin)).status).toBe(403);
    // This test ended the other owner sessions, so make fresh ones for what follows.
    ownerStale = await addSession(owner);
    await stepUpAt(ownerStale, STEP_UP_WINDOW_MS + 60_000);
  });
});

describe("S2.7: the audit log", () => {
  it("is read by the owner only: an admin and an owner without 2FA are refused, and the database returns nothing to an admin either", async () => {
    expect((await get("/api/v1/admin/audit", admin)).status).toBe(403);
    expect((await get("/api/v1/admin/audit", await addSession(owner))).status).toBe(403); // a new owner session with no 2FA check
    expect((await get("/api/v1/admin/audit", null)).status).toBe(401);
    await asRuntime(async () => {
      await t.run(`select set_config('app.user_id', ${q(admin.userId)}, false), set_config('app.role', 'admin', false)`);
      expect(await t.run(`select count(*)::int as n from audit_log`)).toEqual([{ n: 0 }]);
      await t.run(`select set_config('app.user_id', '', false), set_config('app.role', '', false)`);
    });
  });

  it("lists newest first with the actor's email, filters by person, action and WAT date, and pages with a keyset cursor", async () => {
    const everything = await get("/api/v1/admin/audit", ownerFresh);
    expect(everything.status).toBe(200);
    const times = everything.json.entries.map((e: Json) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(everything.json.entries.length).toBeGreaterThan(5);
    expect(everything.json.actions).toContain("team.invite");
    expect(everything.json.entries.find((e: Json) => e.action === "team.invite").actorEmail).toBe(OWNER_EMAIL);
    expect(everything.json.people.map((p: Json) => p.email)).toContain(OWNER_EMAIL);

    const byAction = await get("/api/v1/admin/audit?action=team.removeAdmin", ownerFresh);
    expect(byAction.json.entries.every((e: Json) => e.action === "team.removeAdmin")).toBe(true);
    expect(byAction.json.entries).toHaveLength(1);

    const byPerson = await get(`/api/v1/admin/audit?actor=${admin.userId}`, ownerFresh);
    expect(byPerson.json.entries.every((e: Json) => e.actorId === admin.userId)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`/api/v1/admin/audit?from=${today}&to=${today}`, ownerFresh)).json.entries.length).toBeGreaterThan(0);
    expect((await get("/api/v1/admin/audit?from=2001-01-01&to=2001-01-02", ownerFresh)).json.entries).toHaveLength(0);
  });

  it("pages without repeating or skipping a row", async () => {
    // 60 rows inside one millisecond, told apart only by microseconds: a cursor that keeps only milliseconds skips rows here.
    await t.run(
      `insert into audit_log (id, actor_id, action, entity_type, meta, at)
       select gen_random_uuid(), ${q(owner.userId)}, 'test.page', 'x', '{}', date_trunc('milliseconds', now()) + (n || ' microseconds')::interval
         from generate_series(1, 60) as n`,
    );
    const seen: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res: { json: Json } = await get(`/api/v1/admin/audit?action=test.page${before ? `&before=${encodeURIComponent(before)}` : ""}`, ownerFresh);
      seen.push(...res.json.entries.map((e: Json) => e.id));
      before = res.json.nextBefore;
      if (!before) break;
    }
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it("rejects a filter the screen could not have produced instead of showing everything", async () => {
    for (const query of ["from=2026-02-31", "from=2026-05-02&to=2026-05-01", "action=bad%20action", "unknown=1", "before=nonsense"]) {
      expect((await get(`/api/v1/admin/audit?${query}`, ownerFresh)).status, query).toBe(400);
    }
  });

  it("cannot be changed or removed by the runtime role", async () => {
    await asRuntime(async () => {
      await t.run(`select set_config('app.user_id', ${q(owner.userId)}, false), set_config('app.role', 'owner', false)`);
      await expect(t.run(`update audit_log set action = 'x'`)).rejects.toThrow(/permission denied/);
      await expect(t.run(`delete from audit_log`)).rejects.toThrow(/permission denied/);
      await t.run(`select set_config('app.user_id', '', false), set_config('app.role', '', false)`);
    });
  });
});

describe("the public invite check", () => {
  it("says only 'open' or 'unusable', never why, and rate-limits a caller who keeps guessing", async () => {
    expect((await post("/api/v1/invites/check", null, { token: "x".repeat(43) })).json).toEqual({ status: "unusable" });
    expect((await post("/api/v1/invites/check", null, { token: "short" })).json).toEqual({ status: "unusable" });
    limiterHits = 0;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post("/api/v1/invites/check", null, { token: "x".repeat(43) }, {}, 2)).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it("leaves unknown operations to the rest of the app", async () => {
    const request = new Request(`${ORIGIN}/api/v1/admin/does.notExist`, { method: "POST" });
    expect(await handleMutation(request, () => mutationDeps())).toBeNull();
  });
});
