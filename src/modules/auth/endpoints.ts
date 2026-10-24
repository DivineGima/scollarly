import { errorResponseFor, jsonResponse } from "@/lib/http";
import { type Actor, AuthError, isStepUpFresh } from "@/server/auth/actor";
import { createSecondFactor, LOCKOUT_MS, type VerifyResult } from "@/server/auth/second-factor";
import { contextOf } from "@/server/db/rls";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { inviteStatus } from "@/server/repositories/identity";
import { createSecondFactorStore } from "@/server/repositories/second-factor";
import { writeAudit } from "@/server/repositories/audit";
import { hashInviteToken } from "@/modules/team/service";
import { codeBody, inviteCheckBody } from "./schema";

/**
 * The owner's second factor and the invite check, as plain edge functions (ADR-037, ADR-040; architecture 16 C0, C1, B0).
 * Area `auth` is open to any signed-in session, because an owner who has not passed 2FA reads as a student; each operation
 * here then asks for the owner account itself (`stored-owner`).
 */

function secondFactorFor(env: EndpointEnv, actor: Actor) {
  return createSecondFactor({ store: createSecondFactorStore(env.db, contextOf(actor)), encryptionKey: env.totpKey, now: env.now });
}

/** The wording the screens map to their own text: a wrong code is a field error, a lockout is a rate limit, never a 500. */
export function verifyResponse(result: VerifyResult, requestId: string): Response {
  switch (result) {
    case "ok":
      return jsonResponse({ verified: true });
    case "invalid":
      return errorResponseFor("VALIDATION", "That code is not right.", requestId, { fields: { code: "INVALID_CODE" } });
    case "replayed":
      return errorResponseFor("VALIDATION", "That code was already used. Wait for the next one.", requestId, { fields: { code: "CODE_ALREADY_USED" } });
    case "locked":
      return errorResponseFor("RATE_LIMITED", "Too many wrong codes. Try again later.", requestId, { headers: { "Retry-After": String(Math.ceil(LOCKOUT_MS / 1000)) } });
    case "not_enrolled":
      return errorResponseFor("CONFLICT", "Two-factor sign-in is not set up yet.", requestId, { fields: { code: "NOT_ENROLLED" } });
  }
}

export const authMutations: Record<string, Mutation> = {
  /** C0 step 2: a new secret and the otpauth link for the QR code. Refused once an authenticator is confirmed. */
  "auth/twoFactor.begin": {
    access: { kind: "stored-owner" },
    async handle({ actor, env, requestId }) {
      const started = await secondFactorFor(env, actor as Actor).beginEnrolment((actor as Actor).userId, env.ownerEmail || "owner");
      if (!started) return errorResponseFor("CONFLICT", "Two-factor sign-in is already set up.", requestId, { fields: { code: "ALREADY_ENROLLED" } });
      return jsonResponse(started);
    },
  },

  /** C0 step 2 to 3: the first code confirms the secret; the recovery codes are in this one response and nowhere else. */
  "auth/twoFactor.confirm": {
    access: { kind: "stored-owner" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(codeBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const owner = actor as Actor;
      const result = await secondFactorFor(env, owner).confirmEnrolment(owner.userId, owner.sessionId, parsed.value.code);
      if (typeof result === "string") return verifyResponse(result, requestId);
      await writeAudit(env.db, owner, { action: "security.twoFactorEnrolled", entityType: "app_user", entityId: owner.userId });
      return jsonResponse({ verified: true, recoveryCodes: result.recoveryCodes });
    },
  },

  /** C1 step 2, and the step-up prompt of every destructive owner action: a code stamps this session. */
  "auth/twoFactor.verify": {
    access: { kind: "stored-owner" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(codeBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const owner = actor as Actor;
      return verifyResponse(await secondFactorFor(env, owner).verifyCode(owner.userId, owner.sessionId, parsed.value.code), requestId);
    },
  },

  /** C1 step 3: a single-use recovery code instead of the app. */
  "auth/twoFactor.recovery": {
    access: { kind: "stored-owner" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(codeBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const owner = actor as Actor;
      const result = await secondFactorFor(env, owner).verifyRecoveryCode(owner.userId, owner.sessionId, parsed.value.code);
      if (result === "ok") await writeAudit(env.db, owner, { action: "security.recoveryCodeUsed", entityType: "app_user", entityId: owner.userId });
      return verifyResponse(result, requestId);
    },
  },

  /** B0 step 1: what the link says to a visitor. An unusable link says only that, with no reason (nothing to probe). */
  "invites/check": {
    access: { kind: "public" },
    limit: { max: 20, windowMs: 60_000 },
    async handle({ env, body, requestId }) {
      const parsed = parseBody(inviteCheckBody, body, requestId);
      if (!parsed.ok) return jsonResponse({ status: "unusable" });
      const hash = await hashInviteToken(parsed.value.token);
      const found = hash ? await inviteStatus(env.db, hash) : null;
      if (!found || found.status !== "open") return jsonResponse({ status: "unusable" });
      return jsonResponse({ status: "open", email: found.email });
    },
  },
};

export function authDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** Where the owner stands, so the two-factor pages show the right screen. Anyone but the owner account is refused. */
    "auth/two-factor-status": async (actor) => {
      if (actor.storedRole !== "owner") throw new AuthError("FORBIDDEN", "Not allowed.");
      const record = await createSecondFactorStore(env.db, contextOf(actor)).getTotp(actor.userId);
      return {
        enrolled: record?.confirmed === true,
        pending: record !== null && !record.confirmed,
        verified: actor.twoFactorVerifiedAt !== null,
        stepUpFresh: isStepUpFresh(actor, env.now()),
      };
    },
  };
}
