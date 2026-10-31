import * as z from "zod";
import { jsonResponse } from "@/lib/http";
import { COURSE_FIELDS } from "@/lib/courses";
import { PROFILE_RELATIONSHIPS } from "@/lib/constants";
import { onboardingPath } from "@/modules/auth/intent";
import type { Actor } from "@/server/auth/actor";
import { contextOf } from "@/server/db/rls";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { confirmAccount } from "@/server/repositories/account";

/**
 * The one operation open to a Google login that has no confirmed account yet (architecture 21.3, `Access` kind `account`).
 */

const confirmBody = z.strictObject({
  as: z.enum(PROFILE_RELATIONSHIPS).optional(),
  course: z.enum(COURSE_FIELDS).optional(),
});

export const accountMutations: Record<string, Mutation> = {
  /** `/account/confirm`, "Create account": confirms the caller's own account and says where to go next. Idempotent. */
  "account/confirm": {
    access: { kind: "account" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(confirmBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const me = actor as Actor;
      const created = await confirmAccount(env.db, contextOf({ userId: me.userId, role: "student" }));
      return jsonResponse({ confirmed: true, created, next: onboardingPath(parsed.value.as ?? "student", parsed.value.course ?? null) });
    },
  },
};
