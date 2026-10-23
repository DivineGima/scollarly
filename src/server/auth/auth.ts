import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { magicLink, twoFactor } from "better-auth/plugins";
import type { Db } from "@/server/db/client";
import { schema } from "@/server/db/schema";
import type { EmailSender } from "@/server/email/send";
import { hashPasswordPbkdf2, type HashVariant, verifyPasswordPbkdf2 } from "./password";

export interface AuthConfigInput {
  db: Db;
  secret: string;
  baseURL: string;
  sendEmail: EmailSender;
  /** Defers background work past the response (ctx.waitUntil on Workers). */
  runInBackground?: (task: Promise<unknown>) => void;
  googleClientId?: string;
  googleClientSecret?: string;
  /** Password hashing variant being measured (S0.4). Production picks one after the gate. */
  variant?: HashVariant;
}

const STEP_UP_PATHS = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

/**
 * Better Auth, configured for the architecture:
 *  - email verification is mandatory before any session (9.1 rule 5)
 *  - Google and email accounts link only on a verified email (pre-hijacking, 9.1 rule 5)
 *  - cookie cache of at most 60 s exists, but the facade bypasses it for staff (ADR-020)
 *  - raw IP addresses are never stored (CLAUDE.md), so IP tracking is off
 *  - passing a TOTP or recovery-code check stamps the session, which drives the 10-minute step-up (9.3)
 */
export function createAuth(input: AuthConfigInput) {
  const variant = input.variant ?? "default";
  const background = input.runInBackground ?? ((task) => void task.catch(() => undefined));

  const sendVerification = async ({ user, url }: { user: { email: string }; url: string }) => {
    background(
      input.sendEmail({
        to: user.email,
        subject: "Verify your email for Scollarly",
        text: `Open this link to verify your email:\n\n${url}\n\nIf you did not create an account, ignore this message.`,
      }),
    );
  };

  return betterAuth({
    appName: "Scollarly",
    secret: input.secret,
    baseURL: input.baseURL,
    database: drizzleAdapter(input.db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: variant !== "passwordless",
      requireEmailVerification: true,
      autoSignIn: false,
      ...(variant === "pbkdf2" ? { password: { hash: hashPasswordPbkdf2, verify: verifyPasswordPbkdf2 } } : {}),
    },
    emailVerification: { sendOnSignUp: true, sendVerificationEmail: sendVerification },
    socialProviders:
      input.googleClientId && input.googleClientSecret
        ? { google: { clientId: input.googleClientId, clientSecret: input.googleClientSecret } }
        : {},
    account: { accountLinking: { enabled: true } },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "student", input: false },
      },
    },
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
      additionalFields: {
        twoFactorVerifiedAt: { type: "date", required: false, input: false },
      },
    },
    advanced: {
      ipAddress: { disableIpTracking: true },
      backgroundTasks: { handler: background },
    },
    plugins: [
      twoFactor({ issuer: "Scollarly" }),
      ...(variant === "passwordless"
        ? [
            magicLink({
              sendMagicLink: async ({ email, url }) => {
                background(
                  input.sendEmail({ to: email, subject: "Your Scollarly sign-in link", text: `Open this link to sign in:\n\n${url}` }),
                );
              },
            }),
          ]
        : []),
    ],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (!STEP_UP_PATHS.has(ctx.path)) return;
        if (ctx.context.returned instanceof Error) return; // the check failed, do not stamp
        const current = ctx.context.newSession ?? ctx.context.session;
        const token = current?.session.token;
        if (!token) return;
        await ctx.context.internalAdapter.updateSession(token, { twoFactorVerifiedAt: new Date() });
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
