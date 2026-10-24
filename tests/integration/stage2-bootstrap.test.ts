import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { handleLanding } from "@/server/edge/landing";
import { createAuthFacade } from "@/server/auth/facade";
import { resolveSession } from "@/server/repositories/identity";
import { createTestDb, type SignedInUser, type TestDb } from "./helpers/db";
import { q } from "./helpers/fixtures";

/**
 * S2.3 owner bootstrap (architecture 9.3): the first verified sign-in with OWNER_EMAIL becomes the owner, once.
 * Needs a database with no owner yet, so it has its own.
 */

const ORIGIN = "https://scollarly.test";
const OWNER_EMAIL = "Owner.Person@Example.test";

let t: TestDb;
let env: EndpointEnv;
let facade: ReturnType<typeof createAuthFacade>;

beforeAll(async () => {
  t = await createTestDb();
  env = { db: t.db, ownerEmail: OWNER_EMAIL, totpKey: Buffer.from(randomBytes(32)).toString("base64"), now: () => new Date() };
  facade = createAuthFacade((token) => resolveSession(t.db, token));
});
afterAll(async () => {
  await t.close();
});

async function landing(user: SignedInUser): Promise<string> {
  await t.asRuntime();
  try {
    const request = new Request(`${ORIGIN}/auth/landing`, { headers: { cookie: `__Secure-neon-auth.session_token=${user.token}.sig` } });
    const response = (await handleLanding(request, () => ({ checkSession: facade.checkSession, env, waitUntil: () => undefined }))) as Response;
    return new URL(response.headers.get("location") ?? "", ORIGIN).pathname;
  } finally {
    await t.asOwner();
  }
}

const roleOf = async (user: SignedInUser) => ((await t.run(`select role from app_user where id = ${q(user.userId)}`)) as { role: string }[])[0]?.role;

describe("owner bootstrap", () => {
  it("does not make anyone else the owner, and does not trust an unverified email", async () => {
    const other = await t.signIn({ email: "someone@example.test" });
    expect(await landing(other)).toBe("/me");
    expect(await roleOf(other)).toBe("student");

    // The exact owner address, but Google has not verified it: no session is trusted, so nothing is bootstrapped.
    const unverified = await t.signIn({ email: OWNER_EMAIL, verified: false });
    expect(await landing(unverified)).toBe("/sign-in");
    expect(await t.run(`select count(*)::int as n from app_user where role = 'owner'`)).toEqual([{ n: 0 }]);
  });

  it("gives the owner role to the verified OWNER_EMAIL, whatever its letter case, and sends them to enrol 2FA", async () => {
    const person = await t.signIn({ email: OWNER_EMAIL.toLowerCase() });
    expect(await landing(person)).toBe("/two-factor/enrol");
    expect(await roleOf(person)).toBe("owner");
    expect(await t.run(`select count(*)::int as n from audit_log where action = 'security.ownerBootstrapped' and actor_id = ${q(person.userId)}`)).toEqual([{ n: 1 }]);
  });

  it("is idempotent for the owner and never gives a second person the role", async () => {
    // A second account that Google also reports as verified with the same address (written in another case).
    const second = await t.signIn({ email: "OWNER.PERSON@EXAMPLE.TEST" });
    expect(await landing(second)).toBe("/me");
    expect(await roleOf(second)).toBe("student");
    expect(await t.run(`select count(*)::int as n from app_user where role = 'owner'`)).toEqual([{ n: 1 }]);
  });
});
