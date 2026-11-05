import { errorResponse, jsonResponse } from "@/lib/http";
import { type Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { logError } from "@/server/log";
import { completeProfile, onboardingStateOf } from "@/server/repositories/onboarding";
import { completeOnboarding, type CompleteOnboardingOutcome } from "./service";

/**
 * Onboarding (S13.3, changed in S15.2; architecture 21.4, 21.6, 23.2): the state of the caller's onboarding and the one write that finishes
 * it. Both are open to any confirmed signed-in account; the write is also refused by the database function for anything that is not a
 * student-role account.
 */

export function onboardingDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** Whether the caller has already finished (a second device, or a reload after finishing), so the screens do not ask again. */
    "me/onboarding-state": async (actor) => ({ userId: actor.userId, ...(await onboardingStateOf(env.db, actor)) }),
  };
}

export function toResponse(outcome: CompleteOnboardingOutcome, requestId: string): Response {
  // `ref: null`: no lead is made now. The phone's queue reads a null reference from an onboarding as "done" (offline/send.ts).
  if (outcome.ok) return jsonResponse({ status: outcome.replayed ? "replayed" : "created", ref: null }, outcome.status);
  if (outcome.status === 400) return errorResponse(400, outcome.code, outcome.message, requestId, { fields: outcome.fields });
  return errorResponse(outcome.status, outcome.code, outcome.message, requestId);
}

export const onboardingMutations: Record<string, Mutation> = {
  /** Finishes onboarding: one idempotent write that makes the profile (the account's one row is the replay guard) and no lead (PRD_4 F24). */
  "me/onboarding": {
    access: { kind: "signed-in" },
    beforeOnboarding: true,
    async handle({ actor, env, body, requestId }) {
      const outcome = await completeOnboarding(
        {
          insert: (row) => completeProfile(env.db, actor as Actor, row),
          now: env.now,
          onError: (error) => logError(requestId, "me/onboarding", error),
        },
        { body },
      );
      return toResponse(outcome, requestId);
    },
  },
};
