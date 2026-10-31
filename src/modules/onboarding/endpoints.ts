import { errorResponse, jsonResponse } from "@/lib/http";
import { type Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { cachedSettings } from "@/server/edge/settings-cache";
import { logError } from "@/server/log";
import { completeOnboarding as insertOnboarding, onboardingStateOf } from "@/server/repositories/onboarding";
import { slaSettingsFrom } from "@/modules/sla/service";
import { completeOnboarding, type CompleteOnboardingOutcome } from "./service";

/**
 * Onboarding (S13.3, architecture 21.4, 21.6): the state of the caller's onboarding and the one write that finishes it. Both are open
 * to any confirmed signed-in account; the write is also refused by the database function for anything that is not a student-role account.
 */

/** The key of this file's entry in the per-isolate settings cache (the SLA hours). */
const SETTINGS_KEY = "endpoint";

export function onboardingDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** Whether the caller has already finished (a second device, or a reload after finishing), so the screens do not ask again. */
    "me/onboarding-state": async (actor) => ({ userId: actor.userId, ...(await onboardingStateOf(env.db, actor)) }),
  };
}

export function toResponse(outcome: CompleteOnboardingOutcome, requestId: string): Response {
  if (outcome.ok) return jsonResponse({ status: outcome.replayed ? "replayed" : "created", ref: outcome.ref }, outcome.status);
  switch (outcome.status) {
    case 400:
      return errorResponse(400, outcome.code, outcome.message, requestId, { fields: outcome.fields });
    case 429:
      return errorResponse(429, outcome.code, outcome.message, requestId, { headers: { "Retry-After": String(outcome.retryAfterSeconds) }, fields: outcome.fields });
    default:
      return errorResponse(outcome.status, outcome.code, outcome.message, requestId);
  }
}

export const onboardingMutations: Record<string, Mutation> = {
  /** Finishes onboarding: one idempotent write that makes the profile and exactly one lead (the key is the header `Idempotency-Key`). */
  "me/onboarding": {
    access: { kind: "signed-in" },
    async handle({ actor, env, body, request, requestId }) {
      const outcome = await completeOnboarding(
        {
          insert: (row) => insertOnboarding(env.db, actor as Actor, row),
          slaSettings: async () => slaSettingsFrom(await cachedSettings(env.db, SETTINGS_KEY, env.now().getTime())),
          now: env.now,
          newId: () => crypto.randomUUID(),
          onError: (error) => logError(requestId, "me/onboarding", error),
        },
        { idempotencyKey: request.headers.get("idempotency-key"), body },
      );
      return toResponse(outcome, requestId);
    },
  },
};
