import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSession } from "@/server/repositories/identity";
import { q } from "./helpers/fixtures";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * F30 (migration 0018): a staff or owner account that also holds a password login (a "credential" account in Neon Auth) gets no session, so a
 * stranger who pre-registered a password on a staff email cannot use it once Neon links the staff member's Google login to that account.
 */

let t: TestDb;

const resolveAsRuntime = async (token: string) => {
  await t.asRuntime();
  try {
    return await resolveSession(t.db, token);
  } finally {
    await t.asOwner();
  }
};

const addAccount = (userId: string, provider: string) =>
  t.run(`insert into neon_auth.account ("accountId", "providerId", "userId") values (${q(`acc-${provider}-${userId}`)}, ${q(provider)}, ${q(userId)})`);

const setRole = (userId: string, role: string) => t.run(`insert into public.app_user (id, role) values (${q(userId)}, ${q(role)}) on conflict (id) do update set role = excluded.role`);

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("F30: staff and the owner sign in with Google only", () => {
  it.each(["manager", "admin"])("refuses a %s whose account also has a password login", async (role) => {
    const user = await t.signIn();
    await setRole(user.userId, role);
    await addAccount(user.userId, "google");
    expect((await resolveAsRuntime(user.token))?.userId).toBe(user.userId);
    await addAccount(user.userId, "credential");
    expect(await resolveAsRuntime(user.token)).toBeNull();
  });

  it("lets a staff member with Google only through", async () => {
    const user = await t.signIn();
    await setRole(user.userId, "manager");
    await addAccount(user.userId, "google");
    expect((await resolveAsRuntime(user.token))?.role).toBe("manager");
  });

  it("does not touch a student with a password login", async () => {
    const user = await t.signIn({ verified: false });
    await addAccount(user.userId, "credential");
    const session = await resolveAsRuntime(user.token);
    expect(session?.role).toBe("student");
  });
});
