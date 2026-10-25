import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";
import {
  createSecondFactor,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  normaliseRecoveryCode,
  type SecondFactorStore,
  type TotpRecord,
} from "@/server/auth/second-factor";

const KEY = Buffer.alloc(32, 7).toString("base64");

/** An in-memory store with the same atomic rules the Drizzle store gets from SQL. */
function fakeStore() {
  const totp = new Map<string, TotpRecord>();
  const recovery = new Map<string, { hash: string; used: boolean }[]>();
  const stepUps = new Map<string, Date>();
  const store: SecondFactorStore = {
    async getTotp(userId) {
      const r = totp.get(userId);
      return r ? { ...r } : null;
    },
    async saveUnconfirmed(userId, secretEncrypted) {
      const existing = totp.get(userId);
      if (existing?.confirmed) return false;
      totp.set(userId, { userId, secretEncrypted, confirmed: false, lastUsedStep: null, failedCount: 0, lockedUntil: null });
      return true;
    },
    async acceptStep(userId, step) {
      const r = totp.get(userId);
      if (!r || (r.lastUsedStep !== null && r.lastUsedStep >= step)) return false;
      totp.set(userId, { ...r, lastUsedStep: step, confirmed: true, failedCount: 0, lockedUntil: null });
      return true;
    },
    async recordFailure(userId, max, lockUntil, at) {
      const r = totp.get(userId);
      if (!r) return { failedCount: 0, lockedUntil: null };
      const expired = r.lockedUntil !== null && r.lockedUntil <= at;
      const failedCount = expired ? 1 : r.failedCount + 1;
      const lockedUntil = failedCount >= max ? lockUntil : expired ? null : r.lockedUntil;
      totp.set(userId, { ...r, failedCount, lockedUntil });
      return { failedCount, lockedUntil };
    },
    async replaceRecoveryCodes(userId, hashes) {
      recovery.set(userId, hashes.map((hash) => ({ hash, used: false })));
    },
    async consumeRecoveryCode(userId, hash) {
      const entry = recovery.get(userId)?.find((c) => c.hash === hash && !c.used);
      if (!entry) return false;
      entry.used = true;
      return true;
    },
    async markStepUp(sessionId, _userId, at) {
      stepUps.set(sessionId, at);
    },
  };
  return { store, totp, recovery, stepUps };
}

function setup(startAt = new Date("2026-10-24T10:00:10Z")) {
  const fake = fakeStore();
  const clock = { now: startAt };
  const factor = createSecondFactor({ store: fake.store, encryptionKey: KEY, now: () => clock.now });
  const codeFor = (secret: string, at: Date) =>
    new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp: at.getTime() });
  return { ...fake, factor, clock, codeFor };
}

async function enrolled(s: ReturnType<typeof setup>) {
  const begin = await s.factor.beginEnrolment("owner-1", "owner@example.test");
  if (!begin) throw new Error("enrolment refused");
  const done = await s.factor.confirmEnrolment("owner-1", "sess-1", s.codeFor(begin.secret, s.clock.now));
  if (typeof done === "string") throw new Error(`confirm failed: ${done}`);
  return { secret: begin.secret, recoveryCodes: done.recoveryCodes };
}

describe("enrolment", () => {
  it("gives an authenticator URI and a secret, stores the secret encrypted, and is not active until confirmed", async () => {
    const s = setup();
    const begin = await s.factor.beginEnrolment("owner-1", "owner@example.test");
    expect(begin?.otpauthUri).toMatch(/^otpauth:\/\/totp\/Scollarly:owner%40example\.test\?/);
    expect(begin?.otpauthUri).toContain("issuer=Scollarly");
    const stored = s.totp.get("owner-1");
    expect(stored?.confirmed).toBe(false);
    expect(stored?.secretEncrypted).not.toContain(begin?.secret ?? "x");
    expect(await s.factor.verifyCode("owner-1", "sess-1", s.codeFor(begin?.secret ?? "", s.clock.now))).toBe("not_enrolled");
  });

  it("confirms with the first code, returns ten recovery codes once and stamps the step-up time of the session", async () => {
    const s = setup();
    const { recoveryCodes } = await enrolled(s);
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(s.totp.get("owner-1")?.confirmed).toBe(true);
    expect(s.stepUps.get("sess-1")).toEqual(s.clock.now);
    expect(s.recovery.get("owner-1")).toHaveLength(10);
  });

  it("refuses a wrong first code and stays unconfirmed", async () => {
    const s = setup();
    await s.factor.beginEnrolment("owner-1", "owner@example.test");
    expect(await s.factor.confirmEnrolment("owner-1", "sess-1", "000000")).toBe("invalid");
    expect(s.totp.get("owner-1")?.confirmed).toBe(false);
  });

  it("refuses to start a second enrolment over a confirmed secret", async () => {
    const s = setup();
    await enrolled(s);
    expect(await s.factor.beginEnrolment("owner-1", "owner@example.test")).toBeNull();
  });
});

describe("verifyCode", () => {
  it("accepts the current code and stamps the step-up time", async () => {
    const s = setup();
    const { secret } = await enrolled(s);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    expect(await s.factor.verifyCode("owner-1", "sess-2", s.codeFor(secret, s.clock.now))).toBe("ok");
    expect(s.stepUps.get("sess-2")).toEqual(s.clock.now);
  });

  it("accepts a code one step either side (clock drift) but not three", async () => {
    const s = setup();
    const { secret } = await enrolled(s);
    const now = new Date(s.clock.now.getTime() + 5 * 60_000);
    s.clock.now = now;
    expect(await s.factor.verifyCode("owner-1", "s", s.codeFor(secret, new Date(now.getTime() - 30_000)))).toBe("ok");
    s.clock.now = new Date(now.getTime() + 5 * 60_000);
    expect(await s.factor.verifyCode("owner-1", "s", s.codeFor(secret, new Date(s.clock.now.getTime() - 90_000)))).toBe("invalid");
  });

  it("refuses to use the same code twice (replay), even from another session", async () => {
    const s = setup();
    const { secret } = await enrolled(s);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    const code = s.codeFor(secret, s.clock.now);
    expect(await s.factor.verifyCode("owner-1", "s1", code)).toBe("ok");
    expect(await s.factor.verifyCode("owner-1", "s2", code)).toBe("replayed");
    expect(s.stepUps.has("s2")).toBe(false);
  });

  it("rejects codes that are not six digits", async () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12a456"]) {
      const s = setup(); // a fresh owner each time: five wrong codes in a row would lock the account (tested below)
      await enrolled(s);
      expect(await s.factor.verifyCode("owner-1", "s", bad), bad).toBe("invalid");
    }
  });

  it("allows spaces inside a pasted code", async () => {
    const s = setup();
    const { secret } = await enrolled(s);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    const code = s.codeFor(secret, s.clock.now);
    expect(await s.factor.verifyCode("owner-1", "s", `${code.slice(0, 3)} ${code.slice(3)}`)).toBe("ok");
  });

  it("locks after five wrong codes, even for the right code, and unlocks after the lockout", async () => {
    const s = setup();
    const { secret } = await enrolled(s);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) expect(await s.factor.verifyCode("owner-1", "s", "000000")).toBe("invalid");
    expect(await s.factor.verifyCode("owner-1", "s", "000000")).toBe("locked");
    expect(await s.factor.verifyCode("owner-1", "s", s.codeFor(secret, s.clock.now))).toBe("locked");
    s.clock.now = new Date(s.clock.now.getTime() + LOCKOUT_MS + 1000);
    expect(await s.factor.verifyCode("owner-1", "s", s.codeFor(secret, s.clock.now))).toBe("ok");
    expect(s.totp.get("owner-1")?.failedCount).toBe(0);
  });

  it("gives a full set of attempts again once a lockout has expired (one wrong code does not re-lock at once)", async () => {
    const s = setup();
    await enrolled(s);
    s.clock.now = new Date(s.clock.now.getTime() + 60_000);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await s.factor.verifyCode("owner-1", "s", "000000");
    expect(s.totp.get("owner-1")?.lockedUntil).not.toBeNull();
    s.clock.now = new Date(s.clock.now.getTime() + LOCKOUT_MS + 1000);
    expect(await s.factor.verifyCode("owner-1", "s", "000000")).toBe("invalid");
    expect(s.totp.get("owner-1")).toMatchObject({ failedCount: 1, lockedUntil: null });
    for (let i = 2; i < MAX_FAILED_ATTEMPTS; i++) expect(await s.factor.verifyCode("owner-1", "s", "000000")).toBe("invalid");
    expect(await s.factor.verifyCode("owner-1", "s", "000000")).toBe("locked");
  });

  it("returns not_enrolled for a user with no secret", async () => {
    expect(await setup().factor.verifyCode("nobody", "s", "123456")).toBe("not_enrolled");
  });
});

describe("recovery codes", () => {
  it("work once, with or without dashes and in any case", async () => {
    const s = setup();
    const { recoveryCodes } = await enrolled(s);
    const code = recoveryCodes[0] ?? "";
    expect(await s.factor.verifyRecoveryCode("owner-1", "r1", code.toLowerCase().replace(/-/g, " "))).toBe("ok");
    expect(s.stepUps.has("r1")).toBe(true);
    expect(await s.factor.verifyRecoveryCode("owner-1", "r2", code)).toBe("invalid");
    expect(s.stepUps.has("r2")).toBe(false);
  });

  it("count wrong guesses toward the lockout", async () => {
    const s = setup();
    await enrolled(s);
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) expect(await s.factor.verifyRecoveryCode("owner-1", "s", "AAAA-AAAA-AAAA-AAAA")).toBe("invalid");
    expect(await s.factor.verifyRecoveryCode("owner-1", "s", "AAAA-AAAA-AAAA-AAAA")).toBe("locked");
  });

  it("are generated unambiguous and unique", () => {
    const codes = generateRecoveryCodes(200);
    expect(new Set(codes).size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}(-[2-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it("are replaced on request: ten new ones work, every old one stops", async () => {
    const s = setup();
    const { recoveryCodes: old } = await enrolled(s);
    const fresh = await s.factor.regenerateRecoveryCodes("owner-1");
    expect(fresh).toHaveLength(10);
    expect(fresh?.some((code) => old.includes(code))).toBe(false);
    expect(await s.factor.verifyRecoveryCode("owner-1", "sess-9", old[0] ?? "")).toBe("invalid");
    expect(await s.factor.verifyRecoveryCode("owner-1", "sess-9", fresh?.[0] ?? "")).toBe("ok");
  });

  it("are not issued to an account with no confirmed authenticator", async () => {
    const s = setup();
    expect(await s.factor.regenerateRecoveryCodes("owner-1")).toBeNull();
    await s.factor.beginEnrolment("owner-1", "owner@example.test");
    expect(await s.factor.regenerateRecoveryCodes("owner-1")).toBeNull();
    expect(s.recovery.get("owner-1")).toBeUndefined();
  });

  it("hash differently per user and ignore formatting", async () => {
    expect(await hashRecoveryCode("a", "ABCD-EFGH-JKMN-PQRS")).toBe(await hashRecoveryCode("a", "abcd efgh jkmn pqrs"));
    expect(await hashRecoveryCode("a", "ABCD-EFGH-JKMN-PQRS")).not.toBe(await hashRecoveryCode("b", "ABCD-EFGH-JKMN-PQRS"));
    expect(normaliseRecoveryCode(" ab-cd ")).toBe("ABCD");
  });
});

describe("secret encryption", () => {
  it("round-trips and uses a fresh nonce each time", async () => {
    const a = await encryptSecret("JBSWY3DPEHPK3PXP", KEY);
    const b = await encryptSecret("JBSWY3DPEHPK3PXP", KEY);
    expect(a).not.toBe(b);
    expect(await decryptSecret(a, KEY)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("fails with the wrong key, a tampered value or an unknown format", async () => {
    const stored = await encryptSecret("JBSWY3DPEHPK3PXP", KEY);
    await expect(decryptSecret(stored, Buffer.alloc(32, 9).toString("base64"))).rejects.toThrow();
    const [v, iv, ct] = stored.split(".");
    await expect(decryptSecret(`${v}.${iv}.${(ct ?? "").slice(0, -2)}AA`, KEY)).rejects.toThrow();
    await expect(decryptSecret("v9.x.y", KEY)).rejects.toThrow("Unsupported");
  });

  it("rejects a key that is not 32 bytes", async () => {
    await expect(encryptSecret("x", Buffer.alloc(16).toString("base64"))).rejects.toThrow("32 bytes");
  });
});
