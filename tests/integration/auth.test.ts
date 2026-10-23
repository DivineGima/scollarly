import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type Auth } from "@/server/auth/auth";
import { AuthError, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import { createAuthFacade } from "@/server/auth/facade";
import type { HashVariant } from "@/server/auth/password";
import type { EmailMessage } from "@/server/email/send";
import { countOwners, ensureProbeUser, promoteToOwner } from "@/server/repositories/phase0-probe";
import { createTestDb, type TestDb } from "./helpers/db";
import { totpFromUri } from "./helpers/totp";

const SECRET = "integration-test-secret-integration-test-secret";
const BASE = "http://localhost:3000";
const PASSWORD = "A-long-enough-password-1!";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

function harness(variant: HashVariant = "default") {
  const sent: EmailMessage[] = [];
  const auth = createAuth({
    db: t.db,
    secret: SECRET,
    baseURL: BASE,
    variant,
    sendEmail: async (message) => {
      sent.push(message);
      return { sent: true };
    },
  });
  return { auth, sent, facade: createAuthFacade(() => auth) };
}

const cookieHeader = (setCookies: string[]) => setCookies.map((c) => c.split(";")[0]).join("; ");
const linkFrom = (m: EmailMessage | undefined) => new URL(m?.text.match(/https?:\/\/\S+/)?.[0] ?? "");
const rows = async <T>(sql: string) => (await t.run(sql)) as T[];

async function signUp(auth: Auth, email: string, extra: Record<string, unknown> = {}) {
  return auth.api.signUpEmail({ body: { name: "Test User", email, password: PASSWORD, ...extra } });
}

async function verifyEmail(sent: EmailMessage[], auth: Auth) {
  const token = linkFrom(sent.at(-1)).searchParams.get("token");
  expect(token).toBeTruthy();
  await auth.api.verifyEmail({ query: { token: token! } });
}

/** Starts TOTP enrolment for the signed-in user and returns what the authenticator app would receive. */
async function enrolTotp(auth: Auth, cookie: string) {
  const result = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: new Headers({ cookie }) });
  if (result.method !== "totp") throw new Error("expected a TOTP enrolment");
  return result;
}

async function signIn(auth: Auth, email: string, password = PASSWORD) {
  const { headers, response } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return { response, setCookie: headers.getSetCookie(), cookie: cookieHeader(headers.getSetCookie()) };
}

describe("sign-up and email verification (architecture 9.1 rule 5)", () => {
  it("creates an unverified student, sends one verification email, and issues no session", async () => {
    const { auth, sent } = harness();
    await signUp(auth, "new@example.test");
    const [user] = await rows<{ email_verified: boolean; role: string }>(`select email_verified, role from "user" where email = 'new@example.test'`);
    expect(user).toMatchObject({ email_verified: false, role: "student" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("new@example.test");
    const sessions = await rows<{ n: number }>(`select count(*)::int as n from session s join "user" u on u.id = s.user_id where u.email = 'new@example.test'`);
    expect(sessions[0]?.n).toBe(0);
  });

  it("refuses sign-in until the email is verified, then allows it", async () => {
    const { auth, sent } = harness();
    await signUp(auth, "verify@example.test");
    await expect(signIn(auth, "verify@example.test")).rejects.toMatchObject({ status: "FORBIDDEN" });
    await verifyEmail(sent, auth);
    const { response } = await signIn(auth, "verify@example.test");
    expect("token" in response && response.token).toBeTruthy();
  });

  it("rejects a wrong password", async () => {
    const { auth, sent } = harness();
    await signUp(auth, "wrongpw@example.test");
    await verifyEmail(sent, auth);
    await expect(signIn(auth, "wrongpw@example.test", "not-the-password-1!")).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("always creates a Student: a role supplied at sign-up never becomes the stored role (FR-7)", async () => {
    const { auth } = harness();
    await signUp(auth, "sneaky@example.test", { role: "owner" }).catch(() => undefined);
    const found = await rows<{ role: string }>(`select role from "user" where email = 'sneaky@example.test'`);
    expect(found.every((r) => r.role === "student")).toBe(true);
    expect(await countOwners(t.db)).toBe(0);
  });

  it("never stores the plain password", async () => {
    const { auth } = harness();
    await signUp(auth, "hashed@example.test");
    const [acct] = await rows<{ password: string }>(`select a.password from account a join "user" u on u.id = a.user_id where u.email = 'hashed@example.test'`);
    expect(acct?.password).toBeTruthy();
    expect(acct?.password).not.toContain(PASSWORD);
  });
});

describe("privacy: raw IP addresses are never stored (CLAUDE.md)", () => {
  it("stores no IP in session.ip_address even when the request carries one (empty, never the address)", async () => {
    const { auth, sent } = harness();
    await signUp(auth, "noip@example.test");
    await verifyEmail(sent, auth);
    await auth.api.signInEmail({
      body: { email: "noip@example.test", password: PASSWORD },
      headers: new Headers({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "203.0.113.9" }),
    });
    const sessions = await rows<{ ip_address: string | null }>(`select s.ip_address from session s join "user" u on u.id = s.user_id where u.email = 'noip@example.test'`);
    expect(sessions.length).toBeGreaterThan(0);
    // Better Auth writes "" (not SQL NULL) when IP tracking is off. Either way no address is kept.
    for (const s of sessions) {
      expect(s.ip_address ?? "").toBe("");
      expect(JSON.stringify(s)).not.toContain("203.0.113.9");
    }
    const anywhere = await rows<{ n: number }>(`select count(*)::int as n from session where ip_address like '%203.0.113.9%' or user_agent like '%203.0.113.9%'`);
    expect(anywhere[0]?.n).toBe(0);
  });
});

describe("S0.4: password hash variants all sign in", () => {
  for (const variant of ["default", "pbkdf2"] as const) {
    it(`variant "${variant}" signs up, verifies, signs in, and rejects a wrong password`, async () => {
      const { auth, sent } = harness(variant);
      const email = `${variant}-variant@example.test`;
      await signUp(auth, email);
      await verifyEmail(sent, auth);
      expect((await signIn(auth, email)).setCookie.length).toBeGreaterThan(0);
      await expect(signIn(auth, email, "definitely-not-it-1!")).rejects.toBeTruthy();
      const [acct] = await rows<{ password: string }>(`select a.password from account a join "user" u on u.id = a.user_id where u.email = '${email}'`);
      if (variant === "pbkdf2") expect(acct?.password.startsWith("pbkdf2-sha256$")).toBe(true);
      else expect(acct?.password.startsWith("pbkdf2-sha256$")).toBe(false);
    });
  }

  it('variant "passwordless" signs in through an emailed link with no password at all', async () => {
    const { auth, sent } = harness("passwordless");
    await ensureProbeUser(t.db, { id: "pwless-1", email: "pwless@example.test", name: "Pwless", role: "student", passwordHash: null });
    await auth.api.signInMagicLink({ body: { email: "pwless@example.test" }, headers: new Headers() });
    const token = linkFrom(sent.at(-1)).searchParams.get("token");
    expect(token).toBeTruthy();
    const { headers } = await auth.api.magicLinkVerify({ query: { token: token! }, headers: new Headers(), returnHeaders: true });
    expect(headers.getSetCookie().length).toBeGreaterThan(0);
    const credentialRows = await rows<{ n: number }>(`select count(*)::int as n from account where user_id = 'pwless-1' and password is not null`);
    expect(credentialRows[0]?.n).toBe(0);
  });
});

describe("ADR-020: staff are looked up fresh, so removal bites on the next request", () => {
  async function adminCookie() {
    const { auth, sent, facade } = harness();
    const email = `admin-${Math.random().toString(36).slice(2, 8)}@example.test`;
    await signUp(auth, email);
    await verifyEmail(sent, auth);
    await t.run(`update "user" set role = 'admin' where email = '${email}'`);
    const { cookie } = await signIn(auth, email);
    return { email, cookie, facade };
  }

  it("recognises an admin, then refuses them on the very next request after demotion", async () => {
    const { email, cookie, facade } = await adminCookie();
    const headers = new Headers({ cookie });
    expect((await facade.requireRole(headers, "admin")).role).toBe("admin");
    await t.run(`update "user" set role = 'student' where email = '${email}'`);
    await expect(facade.requireRole(headers, "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a removed admin whose sessions were revoked, even with the old cookie", async () => {
    const { email, cookie, facade } = await adminCookie();
    const headers = new Headers({ cookie });
    expect(await facade.checkSession(headers)).not.toBeNull();
    await t.run(`delete from session where user_id = (select id from "user" where email = '${email}')`);
    expect(await facade.checkSession(headers)).toBeNull();
    await expect(facade.requireRole(headers, "admin")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns null for a request with no cookie, or a forged one", async () => {
    const { facade } = harness();
    expect(await facade.checkSession(new Headers())).toBeNull();
    expect(await facade.checkSession(new Headers({ cookie: "better-auth.session_token=forged.value" }))).toBeNull();
  });
});

describe("S0.4: TOTP 2FA, recovery codes and the 10-minute step-up (architecture 9.3)", () => {
  async function ownerWithoutTwoFactor(email: string) {
    const { auth, sent, facade } = harness();
    await signUp(auth, email);
    await verifyEmail(sent, auth);
    const [u] = await rows<{ id: string }>(`select id from "user" where email = '${email}'`);
    // One owner at a time (the partial unique index): clear the previous test's owner first.
    await t.run(`update "user" set role = 'student' where role = 'owner'`);
    await promoteToOwner(t.db, u!.id);
    const first = await signIn(auth, email);
    return { auth, facade, email, userId: u!.id, cookie: first.cookie };
  }

  it("an owner session that has not passed 2FA has no admin or owner powers", async () => {
    const { facade, cookie } = await ownerWithoutTwoFactor("owner-no2fa@example.test");
    const actor = await facade.checkSession(new Headers({ cookie }));
    expect(actor).toMatchObject({ storedRole: "owner", role: "student", twoFactorVerifiedAt: null });
    await expect(facade.requireRole(new Headers({ cookie }), "admin")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(facade.requireOwner(new Headers({ cookie }))).rejects.toBeInstanceOf(AuthError);
  });

  it("enrols TOTP, issues recovery codes, challenges at sign-in, and stamps the verified session", async () => {
    const email = "owner-2fa@example.test";
    const { auth, facade, cookie } = await ownerWithoutTwoFactor(email);

    const enrol = await enrolTotp(auth, cookie);
    expect(enrol.backupCodes.length).toBeGreaterThanOrEqual(8);
    await auth.api.verifyTOTP({ body: { code: totpFromUri(enrol.totpURI) }, headers: new Headers({ cookie }) });
    const [flag] = await rows<{ two_factor_enabled: boolean }>(`select two_factor_enabled from "user" where email = '${email}'`);
    expect(flag?.two_factor_enabled).toBe(true);

    // A new sign-in is now challenged and has no session until the second factor is checked.
    const challenge = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    expect("twoFactorRedirect" in challenge.response && challenge.response.twoFactorRedirect).toBe(true);
    const challengeCookie = cookieHeader(challenge.headers.getSetCookie());

    const verified = await auth.api.verifyTOTP({ body: { code: totpFromUri(enrol.totpURI) }, headers: new Headers({ cookie: challengeCookie }), returnHeaders: true });
    const sessionCookie = cookieHeader(verified.headers.getSetCookie());
    const actor = await facade.requireOwner(new Headers({ cookie: sessionCookie }));
    expect(actor.role).toBe("owner");
    expect(actor.twoFactorVerifiedAt).toBeInstanceOf(Date);
    expect(Date.now() - actor.twoFactorVerifiedAt!.getTime()).toBeLessThan(60_000);

    // Step-up: fine now, refused after 10 minutes, restored by re-confirming the code in the same session.
    await expect(facade.requireOwner(new Headers({ cookie: sessionCookie }), { stepUp: true })).resolves.toMatchObject({ role: "owner" });
    const later = new Date(actor.twoFactorVerifiedAt!.getTime() + STEP_UP_WINDOW_MS + 1);
    await expect(facade.requireOwner(new Headers({ cookie: sessionCookie }), { stepUp: true, now: later })).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });

    await t.run(`update session set two_factor_verified_at = now() - interval '11 minutes' where id = '${actor.sessionId}'`);
    await expect(facade.requireOwner(new Headers({ cookie: sessionCookie }), { stepUp: true })).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    await auth.api.verifyTOTP({ body: { code: totpFromUri(enrol.totpURI) }, headers: new Headers({ cookie: sessionCookie }) });
    await expect(facade.requireOwner(new Headers({ cookie: sessionCookie }), { stepUp: true })).resolves.toMatchObject({ role: "owner" });
  });

  it("rejects a wrong TOTP code and leaves the session unstamped", async () => {
    const email = "owner-badcode@example.test";
    const { auth, facade, cookie } = await ownerWithoutTwoFactor(email);
    const enrol = await enrolTotp(auth, cookie);
    await auth.api.verifyTOTP({ body: { code: totpFromUri(enrol.totpURI) }, headers: new Headers({ cookie }) });
    const challenge = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    const challengeCookie = cookieHeader(challenge.headers.getSetCookie());
    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers: new Headers({ cookie: challengeCookie }) })).rejects.toBeTruthy();
    const stamped = await rows<{ n: number }>(`select count(*)::int as n from session s join "user" u on u.id = s.user_id where u.email = '${email}' and s.two_factor_verified_at is not null`);
    // Only the enrolment session (stamped when the enrolment code was confirmed) may carry a stamp; the failed challenge created none.
    expect(stamped[0]?.n).toBeLessThanOrEqual(1);
    expect(await facade.checkSession(new Headers({ cookie: challengeCookie }))).toBeNull();
  });

  it("accepts a recovery code once and refuses it the second time", async () => {
    const email = "owner-recovery@example.test";
    const { auth, facade, cookie } = await ownerWithoutTwoFactor(email);
    const enrol = await enrolTotp(auth, cookie);
    await auth.api.verifyTOTP({ body: { code: totpFromUri(enrol.totpURI) }, headers: new Headers({ cookie }) });
    const code = enrol.backupCodes[0]!;

    const first = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    const ok = await auth.api.verifyBackupCode({ body: { code }, headers: new Headers({ cookie: cookieHeader(first.headers.getSetCookie()) }), returnHeaders: true });
    const actor = await facade.requireOwner(new Headers({ cookie: cookieHeader(ok.headers.getSetCookie()) }));
    expect(actor.twoFactorVerifiedAt).toBeInstanceOf(Date);

    const second = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    await expect(auth.api.verifyBackupCode({ body: { code }, headers: new Headers({ cookie: cookieHeader(second.headers.getSetCookie()) }) })).rejects.toBeTruthy();
  });

  it("the database refuses a second owner whatever the application does", async () => {
    await ownerWithoutTwoFactor("owner-first@example.test");
    expect(await countOwners(t.db)).toBe(1);
    await t.run(`insert into "user" (id, name, email) values ('would-be-owner', 'X', 'would-be@example.test')`);
    await expect(promoteToOwner(t.db, "would-be-owner")).rejects.toThrow();
  });
});
