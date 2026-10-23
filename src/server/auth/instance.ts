import { createHttpDb } from "@/server/db/client";
import { createEmailSender } from "@/server/email/send";
import { getEnv, runInBackground } from "@/server/env";
import { type Auth, createAuth } from "./auth";
import type { HashVariant } from "./password";

// One Better Auth instance per hash variant per isolate. The Neon HTTP driver is stateless, so reuse is safe
// and saves the cost of building the instance on every request (measured in Stage 0).
const instances = new Map<HashVariant, Auth>();

export function getAuth(variant: HashVariant = "default"): Auth {
  const existing = instances.get(variant);
  if (existing) return existing;
  const env = getEnv();
  const auth = createAuth({
    db: createHttpDb(env.DATABASE_URL),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    sendEmail: createEmailSender(env),
    runInBackground,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    variant,
  });
  instances.set(variant, auth);
  return auth;
}
