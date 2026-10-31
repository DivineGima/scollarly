import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountMutations } from "@/modules/account/endpoints";
import { createAuthFacade } from "@/server/auth/facade";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleLanding } from "@/server/edge/landing";
import { handleMutation, type Mutation } from "@/server/edge/mutations";
import { resolveSession } from "@/server/repositories/identity";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { q } from "./helpers/fixtures";

/**
 * S13.2 (architecture 21.3, ADR-042), against a real database: a new Google login is not a Scollarly account until the person
 * confirms it. Sign in sends them to the confirm screen and creates nothing; Create account confirms and goes on; an unconfirmed login
 * can call nothing but account/confirm.
 */

const ORIGIN = "https://scollarly.test";
let t: TestDb;
let env: EndpointEnv;
let facade: ReturnType<typeof createAuthFacade>;

beforeAll(async () => {
  t = await createTestDb();
  env = { db: t.db, ownerEmail: "someone.else@example.test", totpKey: Buffer.from(randomBytes(32)).toString("base64"), now: () => new Date() };
  facade = createAuthFacade((token) => resolveSession(t.db, token));
});
afterAll(async () => {
  await t.close();
});

const cookieOf = (user: SignedInUser) => `__Secure-neon-auth.session_token=${user.token}.sig`;

/** Runs `/auth/landing` as the Worker does (the runtime role) and returns where it sent the person. */
async function landing(user: SignedInUser, query = ""): Promise<string> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}/auth/landing${query}`, { headers: { cookie: cookieOf(user) } });
    const response = (await handleLanding(request, () => ({ checkSession: facade.checkSession, env, waitUntil: () => undefined }))) as Response;
    const target = new URL(response.headers.get("location") ?? "", ORIGIN);
    return `${target.pathname}${target.search}`;
  } finally {
    await t.asOwner();
  }
}

const confirmedAt = async (user: SignedInUser) => ((await t.run(`select account_confirmed_at from app_user where id = ${q(user.userId)}`)) as { account_confirmed_at: unknown }[])[0]?.account_confirmed_at ?? null;
const auditCount = async (user: SignedInUser) => ((await t.run(`select count(*)::int as n from audit_log where action = 'account.confirmed' and actor_id = ${q(user.userId)}`)) as { n: number }[])[0]?.n;

describe("Sign in with a Google login that has no account", () => {
  it("shows the confirm screen and confirms nothing", async () => {
    const person = await t.signIn();
    expect(await landing(person)).toBe("/account/confirm");
    expect(await confirmedAt(person)).toBeNull();
    expect(await auditCount(person)).toBe(0);
    // Going back (or closing the tab) and returning later starts from the same place.
    expect(await landing(person)).toBe("/account/confirm");
    expect(await confirmedAt(person)).toBeNull();
  });

  it("treats a tampered or unknown intent as a plain sign in", async () => {
    const person = await t.signIn();
    expect(await landing(person, "?intent=admin&as=owner")).toBe("/account/confirm");
    expect(await confirmedAt(person)).toBeNull();
  });
});

describe("Create account", () => {
  it("confirms the account in the same step and goes on (to the student home until onboarding exists)", async () => {
    const parent = await t.signIn();
    expect(await landing(parent, "?intent=sign-up&as=parent&course=law")).toBe("/me");
    expect(await confirmedAt(parent)).not.toBeNull();
    expect(await auditCount(parent)).toBe(1);
    // Signing in later is an ordinary sign in.
    expect(await landing(parent)).toBe("/me");
    expect(await auditCount(parent)).toBe(1);
  });

  it("does nothing new for a person who already has an account", async () => {
    const person = await t.signIn();
    await landing(person, "?intent=sign-up");
    expect(await landing(person, "?intent=sign-up&as=parent")).toBe("/me");
    expect(await auditCount(person)).toBe(1);
  });
});

describe("what an unconfirmed login can call", () => {
  const request = (path: string, user: SignedInUser) =>
    new Request(`${ORIGIN}${path}`, { method: "POST", headers: { cookie: cookieOf(user), origin: ORIGIN, "content-type": "application/json" }, body: "{}" });

  const probe: Mutation = { access: { kind: "signed-in" }, handle: async () => new Response(JSON.stringify({ ran: true }), { status: 200 }) };
  const call = async (path: string, user: SignedInUser) => {
    await t.asRuntime();
    try {
      return (await handleMutation(request(path, user), () => ({
        checkSession: facade.checkSession,
        mutations: { ...accountMutations, "me/probe": probe },
        env,
        limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }),
      }))) as Response;
    } finally {
      await t.asOwner();
    }
  };

  it("refuses everything but account/confirm, then lets the person in once they confirm, and confirming twice is harmless", async () => {
    const person = await t.signIn();
    const refused = await call("/api/v1/me/probe", person);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_NOT_CONFIRMED");

    const first = await call("/api/v1/account/confirm", person);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ confirmed: true, created: true, next: "/me" });
    const second = await call("/api/v1/account/confirm", person);
    expect(await second.json()).toEqual({ confirmed: true, created: false, next: "/me" });
    expect(await auditCount(person)).toBe(1);

    expect((await call("/api/v1/me/probe", person)).status).toBe(200);
  });

  it("refuses a signed-out caller, and a body it does not understand", async () => {
    const stranger = await t.signIn({ verified: false });
    expect((await call("/api/v1/account/confirm", stranger)).status).toBe(401);
    const person = await t.signIn();
    await t.asRuntime();
    try {
      const bad = new Request(`${ORIGIN}/api/v1/account/confirm`, { method: "POST", headers: { cookie: cookieOf(person), origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ as: "admin" }) });
      const response = (await handleMutation(bad, () => ({ checkSession: facade.checkSession, mutations: accountMutations, env, limit: async () => ({ allowed: true, remaining: 100, retryAfterSeconds: 0 }) }))) as Response;
      expect(response.status).toBe(400);
    } finally {
      await t.asOwner();
    }
    expect(await confirmedAt(person)).toBeNull();
  });
});

describe("accounts that existed before", () => {
  it("lands an owner and an invited admin as before, because promotion confirms the account", async () => {
    const admin = await t.signIn();
    await t.run(`insert into app_user (id) values (${q(admin.userId)}) on conflict do nothing`);
    await t.run(`update app_user set role = 'admin' where id = ${q(admin.userId)}`);
    expect(await confirmedAt(admin)).not.toBeNull();
    expect(await landing(admin)).toBe("/admin");
  });
});
