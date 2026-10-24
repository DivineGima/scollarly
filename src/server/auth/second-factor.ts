import * as OTPAuth from "otpauth";

/**
 * The owner's second factor (ADR-013, ADR-037). Neon Auth has no authenticator-app 2FA yet, so this is ours, built on
 * the `otpauth` library (RFC 6238) for the code maths. What this file adds is the part around it: the secret is
 * encrypted at rest, ten single-use recovery codes are stored as hashes, five wrong codes lock the account for a while,
 * a code that was already used is refused (replay), and a success stamps the session's step-up time.
 *
 * It talks to storage only through `SecondFactorStore`, so the rules are testable without a database and the Drizzle
 * implementation lives in `repositories/second-factor.ts`.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;
const PERIOD_SECONDS = 30;
const CLOCK_DRIFT_STEPS = 1; // accept the previous and the next 30 second code
const ISSUER = "Scollarly";
// No 0, 1, I, L, O or U, so a code read aloud or from paper is not misread. 30 symbols; rejection sampling keeps it unbiased.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface TotpRecord {
  userId: string;
  secretEncrypted: string;
  confirmed: boolean;
  lastUsedStep: number | null;
  failedCount: number;
  lockedUntil: Date | null;
}

export interface SecondFactorStore {
  getTotp(userId: string): Promise<TotpRecord | null>;
  /** Stores a new, unconfirmed secret. Must not replace a confirmed one (returns false then). */
  saveUnconfirmed(userId: string, secretEncrypted: string): Promise<boolean>;
  /** Atomically accepts a step only if it is newer than the last used one. Marks the secret confirmed. Resets failures. */
  acceptStep(userId: string, step: number): Promise<boolean>;
  /** Atomically adds one failure and locks until `lockUntil` once `max` is reached. Returns the new state. */
  recordFailure(userId: string, max: number, lockUntil: Date): Promise<{ failedCount: number; lockedUntil: Date | null }>;
  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  /** Atomically marks one unused code as used. Returns false when no unused code with this hash exists. */
  consumeRecoveryCode(userId: string, hash: string): Promise<boolean>;
  markStepUp(sessionId: string, userId: string, at: Date): Promise<void>;
}

export type VerifyResult = "ok" | "invalid" | "locked" | "replayed" | "not_enrolled";

export interface SecondFactorDeps {
  store: SecondFactorStore;
  /** Base64 of 32 random bytes, a Worker secret. */
  encryptionKey: string;
  now?: () => Date;
}

export function createSecondFactor(deps: SecondFactorDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  function totpFor(secretBase32: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: ISSUER,
      label,
      algorithm: "SHA1",
      digits: 6,
      period: PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }

  /** The accepted 30 second step for this code, or null if the code is wrong or outside the drift window. */
  function matchStep(secretBase32: string, code: string): number | null {
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) return null;
    const at = now().getTime();
    const delta = totpFor(secretBase32, "check").validate({ token: clean, timestamp: at, window: CLOCK_DRIFT_STEPS });
    if (delta === null) return null;
    return Math.floor(at / 1000 / PERIOD_SECONDS) + delta;
  }

  async function failed(userId: string): Promise<"invalid" | "locked"> {
    const result = await store.recordFailure(userId, MAX_FAILED_ATTEMPTS, new Date(now().getTime() + LOCKOUT_MS));
    return result.lockedUntil && result.lockedUntil > now() ? "locked" : "invalid";
  }

  /** Starts enrolment: a new secret that the owner adds to an authenticator app. Not active until confirmed. */
  async function beginEnrolment(userId: string, accountName: string): Promise<{ otpauthUri: string; secret: string } | null> {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const saved = await store.saveUnconfirmed(userId, await encryptSecret(secret, deps.encryptionKey));
    if (!saved) return null; // already enrolled: changing the factor needs a deliberate reset, not a second enrolment
    return { otpauthUri: totpFor(secret, accountName).toString(), secret };
  }

  /** Finishes enrolment with the first code. Returns the recovery codes, shown to the owner exactly once. */
  async function confirmEnrolment(userId: string, sessionId: string, code: string): Promise<{ recoveryCodes: string[] } | VerifyResult> {
    const result = await verifyCode(userId, sessionId, code, { allowUnconfirmed: true });
    if (result !== "ok") return result;
    const recoveryCodes = generateRecoveryCodes();
    await store.replaceRecoveryCodes(userId, await Promise.all(recoveryCodes.map((c) => hashRecoveryCode(userId, c))));
    return { recoveryCodes };
  }

  async function verifyCode(userId: string, sessionId: string, code: string, options: { allowUnconfirmed?: boolean } = {}): Promise<VerifyResult> {
    const record = await store.getTotp(userId);
    if (!record || (!record.confirmed && !options.allowUnconfirmed)) return "not_enrolled";
    if (record.lockedUntil && record.lockedUntil > now()) return "locked";

    const secret = await decryptSecret(record.secretEncrypted, deps.encryptionKey);
    const step = matchStep(secret, code);
    if (step === null) return failed(userId);
    if (!(await store.acceptStep(userId, step))) return "replayed";
    await store.markStepUp(sessionId, userId, now());
    return "ok";
  }

  /** A recovery code works once. Wrong codes count toward the same lockout. */
  async function verifyRecoveryCode(userId: string, sessionId: string, code: string): Promise<VerifyResult> {
    const record = await store.getTotp(userId);
    if (!record || !record.confirmed) return "not_enrolled";
    if (record.lockedUntil && record.lockedUntil > now()) return "locked";
    const ok = await store.consumeRecoveryCode(userId, await hashRecoveryCode(userId, code));
    if (!ok) return failed(userId);
    await store.markStepUp(sessionId, userId, now());
    return "ok";
  }

  /**
   * C6: new recovery codes; the old ones stop working (they are marked used). Only for a confirmed enrolment. The caller must
   * already have required a fresh step-up. Returns null when the account is not enrolled.
   */
  async function regenerateRecoveryCodes(userId: string): Promise<string[] | null> {
    const record = await store.getTotp(userId);
    if (!record || !record.confirmed) return null;
    const recoveryCodes = generateRecoveryCodes();
    await store.replaceRecoveryCodes(userId, await Promise.all(recoveryCodes.map((c) => hashRecoveryCode(userId, c))));
    return recoveryCodes;
  }

  return { beginEnrolment, confirmEnrolment, verifyCode, verifyRecoveryCode, regenerateRecoveryCodes };
}

export type SecondFactor = ReturnType<typeof createSecondFactor>;

// ---------------------------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------------------------

/** Ten codes of 16 symbols (about 78 bits), shown as `XXXX-XXXX-XXXX-XXXX`. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const symbols: string[] = [];
    while (symbols.length < 16) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      for (const byte of bytes) {
        if (byte < 240 && symbols.length < 16) symbols.push(RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length] ?? "");
      }
    }
    return [0, 4, 8, 12].map((i) => symbols.slice(i, i + 4).join("")).join("-");
  });
}

export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

/** SHA-256 over the user id and the normalised code. A code has about 78 bits, so a plain fast hash cannot be brute-forced. */
export async function hashRecoveryCode(userId: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${normaliseRecoveryCode(code)}`);
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

// ---------------------------------------------------------------------------------------------
// Secret encryption (AES-256-GCM)
// ---------------------------------------------------------------------------------------------

const VERSION = "v1";

export async function encryptSecret(plain: string, keyBase64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(keyBase64);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(cipher)}`;
}

export async function decryptSecret(stored: string, keyBase64: string): Promise<string> {
  const [version, iv, cipher] = stored.split(".");
  if (version !== VERSION || !iv || !cipher) throw new Error("Unsupported secret format");
  const key = await importKey(keyBase64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) as BufferSource }, key, fromBase64Url(cipher) as BufferSource);
  return new TextDecoder().decode(plain);
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  if (raw.byteLength !== 32) throw new Error("The 2FA encryption key must be 32 bytes (base64).");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
