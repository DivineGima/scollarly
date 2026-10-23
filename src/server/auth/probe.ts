import { hashPassword as betterAuthScrypt } from "better-auth/crypto";
import { sha256Hex } from "@/lib/hash";
import { createHttpDb } from "@/server/db/client";
import { createEmailSender, type EmailMessage } from "@/server/email/send";
import { getEnv } from "@/server/env";
import { ensureProbeUser, findUserIdByEmail } from "@/server/repositories/phase0-probe";
import { createAuth } from "./auth";
import { getAuth } from "./instance";
import { hashPasswordPbkdf2, type HashVariant } from "./password";

/**
 * Stage 0 only (S0.4): signs in a verified probe user through the real Better Auth path so the CPU of
 * each password-hash variant can be measured end to end (hash verify, database reads, session insert).
 * Removed with the other probes once the gate is decided. Probe users use the reserved `.invalid` domain.
 */

/**
 * The probe users exist in the real database with a verified email, so their password must not be
 * guessable from this repository. It is derived from the secret probe token instead of being written here.
 */
async function probePassword(probeToken: string): Promise<string> {
  return `${(await sha256Hex(`${probeToken}:phase0-probe-password`)).slice(0, 40)}aA1!`;
}

export type ProbeRole = "student" | "admin";

export interface SigninProbeResult {
  variant: HashVariant;
  role: ProbeRole;
  ok: boolean;
  /** Set-Cookie headers so the measurement script can call the stub pages as this user. */
  setCookie: string[];
  note?: string;
}

function probeIdentity(variant: HashVariant, role: ProbeRole) {
  return { id: `phase0-probe-${variant}-${role}`, email: `probe-${variant}-${role}@phase0.invalid`, name: `Phase 0 probe (${variant}, ${role})` };
}

async function passwordHashFor(variant: HashVariant, password: string): Promise<string | null> {
  if (variant === "pbkdf2") return hashPasswordPbkdf2(password);
  if (variant === "default") return betterAuthScrypt(password);
  return null;
}

export async function runSigninProbe(variant: HashVariant, role: ProbeRole): Promise<SigninProbeResult> {
  const env = getEnv();
  const db = createHttpDb(env.DATABASE_URL);
  const who = probeIdentity(variant, role);
  const password = await probePassword(env.PHASE0_PROBE_TOKEN);

  if (!(await findUserIdByEmail(db, who.email))) {
    await ensureProbeUser(db, { ...who, role, passwordHash: await passwordHashFor(variant, password) });
  }

  if (variant !== "passwordless") {
    const { headers, response } = await getAuth(variant).api.signInEmail({
      body: { email: who.email, password },
      headers: new Headers(),
      returnHeaders: true,
    });
    const ok = !("twoFactorRedirect" in response);
    return { variant, role, ok, setCookie: headers.getSetCookie(), ...(ok ? {} : { note: "two-factor challenge issued" }) };
  }

  // Passwordless: request a magic link with a capturing sender (no email is sent), then verify its token.
  const captured: EmailMessage[] = [];
  const auth = createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    sendEmail: async (message) => {
      captured.push(message);
      return createEmailSender({})(message);
    },
    variant,
  });
  await auth.api.signInMagicLink({ body: { email: who.email }, headers: new Headers() });
  const link = captured[0]?.text.match(/https?:\/\/\S+/)?.[0];
  const token = link ? new URL(link).searchParams.get("token") : null;
  if (!token) return { variant, role, ok: false, setCookie: [], note: "no magic link token was produced" };
  const { headers } = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(), returnHeaders: true });
  return { variant, role, ok: true, setCookie: headers.getSetCookie() };
}
