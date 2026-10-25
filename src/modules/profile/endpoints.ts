import * as z from "zod";
import { errorResponseFor, jsonResponse } from "@/lib/http";
import { requiredText } from "@/lib/schemas/common";
import { type Actor, AuthError, isStepUpFresh } from "@/server/auth/actor";
import { createSecondFactor } from "@/server/auth/second-factor";
import { contextOf } from "@/server/db/rls";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { writeAudit } from "@/server/repositories/audit";
import { mySessions, profileOf, revokeOtherSessions, setProfileName } from "@/server/repositories/identity";
import { createSecondFactorStore } from "@/server/repositories/second-factor";

/**
 * The signed-in person's own page data (B11 My profile, C6 Security) and the admin menu's data. Identified by the session
 * token, never by an id the browser sends.
 */

const nameBody = z.strictObject({ name: requiredText(80) });
const emptyBody = z.strictObject({});

export const profileMutations: Record<string, Mutation> = {
  /** B11: "Edit name". */
  "admin/profile.setName": {
    access: { kind: "role", role: "admin" },
    async handle({ env, token, body, requestId }) {
      const parsed = parseBody(nameBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      if (!token || !(await setProfileName(env.db, token, parsed.value.name))) {
        return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { name: "INVALID" } });
      }
      return jsonResponse({ saved: true });
    },
  },

  /** B11: "sign out of other devices". The current session stays. */
  "admin/profile.signOutOthers": {
    access: { kind: "role", role: "admin" },
    async handle({ env, token, body, requestId }) {
      const parsed = parseBody(emptyBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      return jsonResponse({ ended: token ? await revokeOtherSessions(env.db, token) : 0 });
    },
  },

  /** C6 step 3: "Sign out everywhere" (this session stays). */
  "admin/security.signOutEverywhere": {
    access: { kind: "role", role: "owner" },
    async handle({ actor, env, token, body, requestId }) {
      const parsed = parseBody(emptyBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const ended = token ? await revokeOtherSessions(env.db, token) : 0;
      await writeAudit(env.db, actor as Actor, { action: "security.signOutEverywhere", entityType: "app_user", entityId: (actor as Actor).userId, meta: { ended } });
      return jsonResponse({ ended });
    },
  },

  /** C6 step 2: new recovery codes, shown once; the old ones stop working. Needs a fresh 2FA check. */
  "admin/security.regenerateRecoveryCodes": {
    access: { kind: "role", role: "owner", stepUp: true },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(emptyBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const owner = actor as Actor;
      const factor = createSecondFactor({ store: createSecondFactorStore(env.db, contextOf(owner)), encryptionKey: env.totpKey, now: env.now });
      const recoveryCodes = await factor.regenerateRecoveryCodes(owner.userId);
      if (!recoveryCodes) return errorResponseFor("CONFLICT", "Two-factor sign-in is not set up yet.", requestId);
      await writeAudit(env.db, owner, { action: "security.recoveryCodesRegenerated", entityType: "app_user", entityId: owner.userId });
      return jsonResponse({ recoveryCodes });
    },
  },
};

export function profileDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** Who is signed in and what the menu may show. The role is the effective role, so an owner without 2FA never sees owner items. */
    "admin/session": async (actor, call) => {
      const profile = call.token ? await profileOf(env.db, call.token) : null;
      if (!profile) throw new AuthError("UNAUTHENTICATED", "Sign in required.");
      return { role: actor.role, name: profile.name, email: profile.email, stepUpFresh: isStepUpFresh(actor, env.now()) };
    },

    /** C6 step 1: 2FA status and active sessions (the current one is marked). Owner only. */
    "admin/security": async (actor, call) => {
      if (actor.role !== "owner" || !call.token) throw new AuthError("FORBIDDEN", "Not allowed.");
      const [record, sessions] = await Promise.all([
        createSecondFactorStore(env.db, contextOf(actor)).getTotp(actor.userId),
        mySessions(env.db, call.token),
      ]);
      return { twoFactorEnabled: record?.confirmed === true, stepUpFresh: isStepUpFresh(actor, env.now()), sessions };
    },
  };
}
