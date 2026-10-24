import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { effectiveRole, isRole } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import { createSecondFactor } from "@/server/auth/second-factor";
import { ANONYMOUS, contextOf, inContext, type RlsContext } from "@/server/db/rls";
import { insertMediaAssetQuery } from "@/server/repositories/media";
import { adminOverviewQuery, ownRowQuery, readPhase0TitleQuery, rlsProbe, writePhase0TitleQuery } from "@/server/repositories/phase0-probe";
import { bootstrapOwner, resolveSession, setRoleQuery } from "@/server/repositories/identity";
import { insertStubLead } from "@/server/repositories/phase0-leads";
import { createSecondFactorStore } from "@/server/repositories/second-factor";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const count = async (table: string, where = "true") => ((await t.run(`select count(*)::int as n from ${table} where ${where}`)) as { n: number }[])[0]?.n ?? 0;
const asUser = (u: SignedInUser, role: RlsContext["role"] = "student"): RlsContext => ({ userId: u.userId, role });

/** Runs `fn` as the Worker's runtime role (row level security applies), then returns to the owner role. */
async function asRuntime<T>(fn: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await fn();
  } finally {
    await t.asOwner();
  }
}

describe("ADR-038: the runtime role is not the owner and every table is locked", () => {
  it("is a login role with no superuser and no BYPASSRLS", async () => {
    const [role] = (await t.run(`select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'app_runtime'`)) as { rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }[];
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
  });

  it("has row level security enabled AND forced, and at least one policy, on every table in public", async () => {
    const tables = (await t.run(`
      select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`)) as { name: string; enabled: boolean; forced: boolean; policies: number }[];
    expect(tables.length).toBeGreaterThanOrEqual(7);
    for (const table of tables) {
      expect(table, `${table.name} must have RLS enabled, forced and a policy`).toMatchObject({ enabled: true, forced: true });
      expect(table.policies, table.name).toBeGreaterThan(0);
    }
  });

  it("cannot read Neon Auth's own tables, the very tables that hold sessions", async () => {
    await t.signIn();
    await asRuntime(async () => {
      await expect(t.run(`select token from neon_auth.session`)).rejects.toThrow(/permission denied/);
      await expect(t.run(`select email from neon_auth."user"`)).rejects.toThrow(/permission denied/);
    });
  });

  it("reports itself as the runtime role through the live probe", async () => {
    const result = await asRuntime(() => rlsProbe(t.db));
    expect(result).toMatchObject({ role: "app_runtime", bypassesRls: false, appUserRowsVisibleWithoutContext: 0, neonAuthReadable: false });
  });
});

describe("ADR-034: the one session query", () => {
  it("returns nothing for an unknown, expired or banned session, and for an unverified email still reports it", async () => {
    const expired = await t.signIn({ expiresInMs: -1000 });
    const banned = await t.signIn({ banned: true });
    const unverified = await t.signIn({ verified: false });
    await asRuntime(async () => {
      expect(await resolveSession(t.db, "z".repeat(32))).toBeNull();
      expect(await resolveSession(t.db, expired.token)).toBeNull();
      expect(await resolveSession(t.db, banned.token)).toBeNull();
      expect(await resolveSession(t.db, unverified.token)).toMatchObject({ emailVerified: false });
    });
  });

  it("creates the app_user row on the first request and is idempotent after that", async () => {
    const user = await t.signIn();
    expect(await count("app_user", `id = '${user.userId}'`)).toBe(0);
    const first = await asRuntime(() => resolveSession(t.db, user.token));
    const second = await asRuntime(() => resolveSession(t.db, user.token));
    expect(first).toMatchObject({ userId: user.userId, sessionId: user.sessionId, email: user.email, emailVerified: true, role: "student", stepUpAt: null });
    expect(second).toEqual(first);
    expect(await count("app_user", `id = '${user.userId}'`)).toBe(1);
  });

  it("creates exactly one row when the first requests arrive together (two tabs, double click)", async () => {
    const user = await t.signIn();
    await asRuntime(async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => resolveSession(t.db, user.token)));
      expect(results.every((r) => r?.userId === user.userId)).toBe(true);
    });
    expect(await count("app_user", `id = '${user.userId}'`)).toBe(1);
  });

  it("ends the session as soon as Neon Auth deletes it (sign-out), and cuts staff access on the next request", async () => {
    const admin = await t.signIn();
    await asRuntime(() => resolveSession(t.db, admin.token));
    await t.run(`update app_user set role = 'admin' where id = '${admin.userId}'`);
    expect(await asRuntime(() => resolveSession(t.db, admin.token))).toMatchObject({ role: "admin" });
    await t.run(`update app_user set role = 'student' where id = '${admin.userId}'`);
    expect(await asRuntime(() => resolveSession(t.db, admin.token))).toMatchObject({ role: "student" });
    await t.run(`delete from neon_auth.session where id = '${admin.sessionId}'`);
    expect(await asRuntime(() => resolveSession(t.db, admin.token))).toBeNull();
  });

  it("treats a token that is merely similar as unknown (no prefix or case matching)", async () => {
    const user = await t.signIn();
    await asRuntime(async () => {
      expect(await resolveSession(t.db, user.token.slice(0, 20))).toBeNull();
      expect(await resolveSession(t.db, user.token.toUpperCase())).toBeNull();
      expect(await resolveSession(t.db, `${user.token}x`)).toBeNull();
    });
  });

  it("works end to end through the facade with a real cookie value", async () => {
    const user = await t.signIn();
    const facade = createAuthFacade((token) => asRuntime(() => resolveSession(t.db, token)));
    const actor = await facade.checkSession(new Headers({ cookie: `__Secure-neon-auth.session_token=${encodeURIComponent(`${user.token}.c2ln`)}` }));
    expect(actor).toMatchObject({ userId: user.userId, role: "student" });
    expect(await facade.checkSession(new Headers())).toBeNull();
  });
});

describe("S2.3: owner bootstrap from OWNER_EMAIL", () => {
  it("promotes only the verified user whose email matches, once", async () => {
    const owner = await t.signIn({ email: "founder@example.test" });
    const impostor = await t.signIn({ email: "someone-else@example.test" });
    const unverified = await t.signIn({ email: "unverified-founder@example.test", verified: false });
    await asRuntime(async () => {
      await resolveSession(t.db, owner.token);
      await resolveSession(t.db, impostor.token);
      await resolveSession(t.db, unverified.token);
      expect(await bootstrapOwner(t.db, impostor.userId, "founder@example.test")).toBe(false);
      expect(await bootstrapOwner(t.db, unverified.userId, "unverified-founder@example.test")).toBe(false);
      expect(await bootstrapOwner(t.db, owner.userId, "")).toBe(false);
      expect(await bootstrapOwner(t.db, owner.userId, "FOUNDER@example.test")).toBe(true); // email match ignores case
    });
    expect(await count("app_user", `id = '${owner.userId}' and role = 'owner'`)).toBe(1);
  });

  it("refuses a second owner even for the right email, and the runtime role cannot promote itself", async () => {
    const second = await t.signIn({ email: "second@example.test" });
    await asRuntime(async () => {
      await resolveSession(t.db, second.token);
      expect(await bootstrapOwner(t.db, second.userId, "second@example.test")).toBe(false);
      await expect(t.run(`update app_user set role = 'owner' where id = '${second.userId}'`)).resolves.toEqual([]); // RLS: no row visible to update
    });
    expect(await count("app_user", "role = 'owner'")).toBe(1);
  });
});

describe("row level security: a second lock under the facade", () => {
  it("lets a user read only their own app_user row, staff all rows, anonymous none", async () => {
    const a = await t.signIn();
    const b = await t.signIn();
    await asRuntime(async () => {
      await resolveSession(t.db, a.token);
      await resolveSession(t.db, b.token);
      const [own] = await inContext(t.db, asUser(a), ownRowQuery(t.db, a.userId));
      expect(own).toHaveLength(1);
      const [other] = await inContext(t.db, asUser(a), ownRowQuery(t.db, b.userId));
      expect(other).toHaveLength(0);
      const [asStaff] = await inContext(t.db, asUser(a, "admin"), ownRowQuery(t.db, b.userId));
      expect(asStaff).toHaveLength(1);
      const [anon] = await inContext(t.db, ANONYMOUS, ownRowQuery(t.db, a.userId));
      expect(anon).toHaveLength(0);
    });
  });

  it("does not let the context leak into the next request on the same connection", async () => {
    const a = await t.signIn();
    await asRuntime(async () => {
      await resolveSession(t.db, a.token);
      await inContext(t.db, asUser(a, "admin"), ownRowQuery(t.db, a.userId));
      const rows = (await t.run(`select count(*)::int as n from app_user`)) as { n: number }[];
      expect(rows[0]?.n).toBe(0); // no context outside inContext: nothing visible
    });
  });

  it("lets only the owner change roles", async () => {
    const owner = await t.signIn();
    const target = await t.signIn();
    await asRuntime(async () => {
      await resolveSession(t.db, owner.token);
      await resolveSession(t.db, target.token);
      const [byStudent] = await inContext(t.db, asUser(target, "student"), setRoleQuery(t.db, target.userId, "admin"));
      const [byAdmin] = await inContext(t.db, asUser(target, "admin"), setRoleQuery(t.db, target.userId, "admin"));
      expect(byStudent).toHaveLength(0);
      expect(byAdmin).toHaveLength(0);
      const [byOwner] = await inContext(t.db, asUser(owner, "owner"), setRoleQuery(t.db, target.userId, "admin"));
      expect(byOwner).toHaveLength(1);
    });
    expect(await count("app_user", `id = '${target.userId}' and role = 'admin'`)).toBe(1);
  });

  it("keeps the second factor of one user invisible and unwritable to another", async () => {
    const a = await t.signIn();
    const b = await t.signIn();
    await asRuntime(async () => {
      await resolveSession(t.db, a.token);
      await resolveSession(t.db, b.token);
      const storeA = createSecondFactorStore(t.db, asUser(a));
      expect(await storeA.saveUnconfirmed(a.userId, "v1.secret.a")).toBe(true);
      expect(await storeA.getTotp(a.userId)).toMatchObject({ confirmed: false });
      const storeB = createSecondFactorStore(t.db, asUser(b));
      expect(await storeB.getTotp(a.userId)).toBeNull(); // B cannot see A's row
      await expect(storeB.saveUnconfirmed(a.userId, "v1.forged.b")).rejects.toThrow(); // B cannot write a row for A
      await expect(storeB.markStepUp("any-session", a.userId, new Date())).rejects.toThrow();
    });
  });

  it("lets anyone read public content but only staff publish it", async () => {
    await asRuntime(async () => {
      await expect(inContext(t.db, ANONYMOUS, writePhase0TitleQuery(t.db, "defaced"))).rejects.toThrow();
      await expect(inContext(t.db, { userId: "x", role: "student" }, writePhase0TitleQuery(t.db, "defaced"))).rejects.toThrow();
      await inContext(t.db, { userId: "x", role: "admin" }, writePhase0TitleQuery(t.db, "Published"));
      const [anon] = await inContext(t.db, ANONYMOUS, readPhase0TitleQuery(t.db));
      expect(anon[0]?.value).toBe("Published");
    });
  });

  it("lets anyone submit a lead through the function, but only staff read leads", async () => {
    const key = randomUUID();
    const row = { id: randomUUID(), idempotencyKey: key, payloadHash: "h1", name: "Amina", whatsappE164: "+237651232301", countryCode: "CM" };
    await asRuntime(async () => {
      expect(await insertStubLead(t.db, row)).toEqual({ kind: "created", id: row.id });
      expect(await insertStubLead(t.db, { ...row, id: randomUUID() })).toEqual({ kind: "replayed", id: row.id });
      expect(await insertStubLead(t.db, { ...row, id: randomUUID(), payloadHash: "h2" })).toEqual({ kind: "key_reused" });
      await expect(t.run(`insert into phase0_lead_stub (id, idempotency_key, payload_hash, name, whatsapp_e164, country_code) values ('${randomUUID()}', '${randomUUID()}', 'x', 'x', '+1', 'CM')`)).rejects.toThrow(/permission denied/);
      const [anon] = await inContext(t.db, ANONYMOUS, adminOverviewQuery(t.db));
      expect(anon[0]?.n).toBe(0);
      const [staff] = await inContext(t.db, { userId: "s", role: "admin" }, adminOverviewQuery(t.db));
      expect(staff[0]?.n).toBe(1);
    });
  });

  it("lets only staff add image metadata, and anyone read it", async () => {
    const asset = { id: randomUUID(), kind: "photo" as const, width: 10, height: 10, bytes: 4, sha256: "e".repeat(64) };
    await asRuntime(async () => {
      await expect(inContext(t.db, ANONYMOUS, insertMediaAssetQuery(t.db, asset))).rejects.toThrow();
      const [added] = await inContext(t.db, { userId: "s", role: "admin" }, insertMediaAssetQuery(t.db, asset));
      expect(added).toHaveLength(1);
    });
  });
});

describe("ADR-037: the owner's second factor against the real tables", () => {
  const codeFor = (secret: string, at: Date) => new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: at.getTime() });
  const KEY = Buffer.alloc(32, 3).toString("base64");

  it("enrols, verifies, refuses replay and shows up as step-up time in the next session query", async () => {
    const owner = await t.signIn();
    await asRuntime(() => resolveSession(t.db, owner.token));
    const clock = { now: new Date() };
    const factor = createSecondFactor({ store: createSecondFactorStore(t.db, asUser(owner)), encryptionKey: KEY, now: () => clock.now });

    await asRuntime(async () => {
      const begin = await factor.beginEnrolment(owner.userId, owner.email);
      expect(begin?.secret).toBeTruthy();
      const confirmed = await factor.confirmEnrolment(owner.userId, owner.sessionId, codeFor(begin?.secret ?? "", clock.now));
      expect(typeof confirmed === "object" && confirmed.recoveryCodes).toHaveLength(10);
      expect(await resolveSession(t.db, owner.token)).toMatchObject({ stepUpAt: expect.any(Date) });

      clock.now = new Date(clock.now.getTime() + 120_000);
      const code = codeFor(begin?.secret ?? "", clock.now);
      expect(await factor.verifyCode(owner.userId, owner.sessionId, code)).toBe("ok");
      expect(await factor.verifyCode(owner.userId, owner.sessionId, code)).toBe("replayed");
      expect(await factor.beginEnrolment(owner.userId, owner.email)).toBeNull();
    });
    const stored = (await t.run(`select secret_encrypted from owner_totp where user_id = '${owner.userId}'`)) as { secret_encrypted: string }[];
    expect(stored[0]?.secret_encrypted).toMatch(/^v1\./);
  });

  it("uses each recovery code once and locks after five wrong codes, in the database", async () => {
    const owner = await t.signIn();
    await asRuntime(() => resolveSession(t.db, owner.token));
    const clock = { now: new Date() };
    const factor = createSecondFactor({ store: createSecondFactorStore(t.db, asUser(owner)), encryptionKey: KEY, now: () => clock.now });
    await asRuntime(async () => {
      const begin = await factor.beginEnrolment(owner.userId, owner.email);
      const done = await factor.confirmEnrolment(owner.userId, owner.sessionId, codeFor(begin?.secret ?? "", clock.now));
      const codes = typeof done === "object" ? done.recoveryCodes : [];
      expect(await factor.verifyRecoveryCode(owner.userId, owner.sessionId, codes[0] ?? "")).toBe("ok");
      expect(await factor.verifyRecoveryCode(owner.userId, owner.sessionId, codes[0] ?? "")).toBe("invalid");
      for (let i = 0; i < 3; i++) await factor.verifyCode(owner.userId, owner.sessionId, "000000");
      expect(await factor.verifyCode(owner.userId, owner.sessionId, "000000")).toBe("locked");
      expect(await factor.verifyCode(owner.userId, owner.sessionId, codeFor(begin?.secret ?? "", new Date(clock.now.getTime() + 600_000)))).toBe("locked");
    });
    expect(await count("recovery_code", `user_id = '${owner.userId}' and used_at is not null`)).toBe(1);
  });
});

describe("roles from the database always go through the same guards as the unit tests", () => {
  it("keeps the stored role values and the TypeScript role type in step", async () => {
    const [constraint] = (await t.run(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'app_user_role_check'`)) as { def: string }[];
    for (const role of ["student", "admin", "owner"]) {
      expect(constraint?.def).toContain(`'${role}'`);
      expect(isRole(role)).toBe(true);
    }
    expect(effectiveRole("owner", null)).toBe("student");
    expect(contextOf({ userId: "u", role: "admin" })).toEqual({ userId: "u", role: "admin" });
  });
});

