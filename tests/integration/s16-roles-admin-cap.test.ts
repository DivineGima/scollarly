import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { q } from "./helpers/fixtures";

/** Stage 16 (architecture 24.2): at most two admins, and an invite names the role it creates. Its own file, so it has the whole database to itself: an admin's role is permanent. */

describe("S16.1 roles: at most two admins, and an invite names the role it creates", () => {
  let u: TestDb;
  const uone = async (statement: string) => ((await u.run(statement)) as Record<string, unknown>[])[0];
  beforeAll(async () => {
    u = await createTestDb();
  });
  afterAll(async () => {
    await u.close();
  });

  it("an accepted invite makes the manager, a second admin is allowed, a third is refused as an invalid invite", async () => {
    const accept = async (email: string, role: "manager" | "admin") => {
      const user = await u.signIn({ email });
      await u.run(`insert into admin_invite (id, email, token_hash, invited_by, expires_at, role) values (gen_random_uuid(), ${q(email)}, ${q(`h-${email}`)}, 'x', now() + interval '1 day', ${q(role)})`);
      const result = await uone(`select public.app_accept_invite(${q(user.token)}, ${q(`h-${email}`)}) as r`);
      return { userId: user.userId, result: result?.r };
    };
    const manager = await accept("m@example.test", "manager");
    expect(manager.result).toBe("accepted");
    expect((await uone(`select role from app_user where id = ${q(manager.userId)}`))?.role).toBe("manager");

    const admin1 = await accept("a1@example.test", "admin");
    const admin2 = await accept("a2@example.test", "admin");
    expect([admin1.result, admin2.result]).toEqual(["accepted", "accepted"]);
    const third = await accept("a3@example.test", "admin");
    expect(third.result).toBe("invalid");
    expect((await uone(`select count(*)::int as n from app_user where role = 'admin'`))?.n).toBe(2);
    expect((await uone(`select role from app_user where id = ${q(third.userId)}`))?.role).toBe("student"); // nothing was changed for them
  });

  it("an invite names only a manager or an admin", async () => {
    await expect(u.run(`insert into admin_invite (id, email, token_hash, invited_by, expires_at, role) values (gen_random_uuid(), 'z@example.test', 'hz', 'x', now() + interval '1 day', 'owner')`)).rejects.toThrow();
  });
});

