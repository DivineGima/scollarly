import { describe, expect, it } from "vitest";
import { hashPasswordPbkdf2, isHashVariant, PBKDF2_ITERATIONS, timingSafeEqual, verifyPasswordPbkdf2 } from "@/server/auth/password";

describe("PBKDF2 variant", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPasswordPbkdf2("correct horse battery staple");
    expect(await verifyPasswordPbkdf2({ hash, password: "correct horse battery staple" })).toBe(true);
    expect(await verifyPasswordPbkdf2({ hash, password: "correct horse battery stapl" })).toBe(false);
  });

  it("uses a fresh salt each time", async () => {
    expect(await hashPasswordPbkdf2("same")).not.toBe(await hashPasswordPbkdf2("same"));
  });

  it("stores the scheme and iteration count with the hash, within the Workers cap", async () => {
    const [scheme, iterations] = (await hashPasswordPbkdf2("x")).split("$");
    expect(scheme).toBe("pbkdf2-sha256");
    expect(Number(iterations)).toBe(PBKDF2_ITERATIONS);
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
  });

  it("treats equivalent Unicode forms of a password as equal (NFKC)", async () => {
    const hash = await hashPasswordPbkdf2("café");
    expect(await verifyPasswordPbkdf2({ hash, password: "café" })).toBe(true);
  });

  it("rejects malformed, truncated, foreign and over-cap hashes without throwing", async () => {
    const good = await hashPasswordPbkdf2("pw");
    const [, , salt, hash] = good.split("$");
    for (const bad of ["", "not-a-hash", "bcrypt$10$abc$def", "pbkdf2-sha256$100000$onlythree", `pbkdf2-sha256$0$${salt}$${hash}`, `pbkdf2-sha256$999999999$${salt}$${hash}`, `pbkdf2-sha256$abc$${salt}$${hash}`]) {
      expect(await verifyPasswordPbkdf2({ hash: bad, password: "pw" })).toBe(false);
    }
  });

  it("fails when the stored hash has been tampered with", async () => {
    const good = await hashPasswordPbkdf2("pw");
    const parts = good.split("$");
    parts[3] = btoa("x".repeat(32));
    expect(await verifyPasswordPbkdf2({ hash: parts.join("$"), password: "pw" })).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("compares content and length", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });
});

describe("isHashVariant", () => {
  it("accepts exactly the three measured variants", () => {
    expect(["default", "pbkdf2", "passwordless"].every(isHashVariant)).toBe(true);
    expect(isHashVariant("argon2")).toBe(false);
  });
});
