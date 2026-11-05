import { errorResponse, jsonResponse } from "@/lib/http";
import { slaSettingsFrom } from "@/modules/sla/service";
import { firstNameOf } from "@/modules/student/endpoints";
import { type Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { cachedSettings } from "@/server/edge/settings-cache";
import { logError } from "@/server/log";
import { insertApplication } from "@/server/repositories/applications";
import { homeOf } from "@/server/repositories/student-home";
import { applyFromProfile, type ApplyOutcome } from "./service";

/**
 * The application (S15.3; architecture 23.3): what the Apply screen needs and the one write that makes the application. Both are open to
 * any confirmed signed-in account that has finished onboarding (the mutation layer refuses the rest with `ONBOARDING_REQUIRED`); the write is
 * also refused by the database function for anything that is not a student-role account with a profile.
 */

/** The key of this file's entry in the per-isolate settings cache (the SLA hours). */
const SETTINGS_KEY = "endpoint";

export function applicationDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /**
     * What the Apply screen needs, in one round trip: whether this account has applied (and the reference and stage if so), the first name, and
     * the course fields the programme suggestions start from. The programme list itself is the public catalogue embedded in the page.
     */
    "me/application-context": async (actor) => {
      const home = await homeOf(env.db, actor);
      return {
        userId: actor.userId,
        onboarded: home.onboarded,
        relationship: home.relationship,
        firstName: firstNameOf(home.contactName),
        courseFields: home.courseFields,
        lead: home.lead ? { ref: home.lead.ref, stage: home.lead.stageCode, updatedAt: home.lead.updatedAt.toISOString() } : null,
      };
    },
  };
}

export function toResponse(outcome: ApplyOutcome, requestId: string): Response {
  if (outcome.ok) return jsonResponse({ status: outcome.replayed ? "replayed" : "created", ref: outcome.ref }, outcome.status);
  switch (outcome.status) {
    case 400:
      return errorResponse(400, outcome.code, outcome.message, requestId, { fields: outcome.fields });
    case 429:
      return errorResponse(429, outcome.code, outcome.message, requestId, { headers: { "Retry-After": String(outcome.retryAfterSeconds) }, fields: outcome.fields });
    case 409:
      // The reference rides in `fields`, like every other detail of an error, so the phone can show the application that already exists.
      return outcome.code === "ALREADY_APPLIED"
        ? errorResponse(409, outcome.code, outcome.message, requestId, { fields: { ref: outcome.ref } })
        : errorResponse(409, outcome.code, outcome.message, requestId);
    default:
      return errorResponse(outcome.status, outcome.code, outcome.message, requestId);
  }
}

export const applicationMutations: Record<string, Mutation> = {
  /** Makes the application: one idempotent write from the profile (the key is the header `Idempotency-Key`). One account applies once. */
  "me/application": {
    access: { kind: "signed-in" },
    async handle({ actor, env, body, request, requestId }) {
      const outcome = await applyFromProfile(
        {
          insert: (row) => insertApplication(env.db, actor as Actor, row),
          slaSettings: async () => slaSettingsFrom(await cachedSettings(env.db, SETTINGS_KEY, env.now().getTime())),
          now: env.now,
          newId: () => crypto.randomUUID(),
          onError: (error) => logError(requestId, "me/application", error),
        },
        { idempotencyKey: request.headers.get("idempotency-key"), body },
      );
      return toResponse(outcome, requestId);
    },
  },
};
