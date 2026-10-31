import * as z from "zod";
import { NUMBER_COUNTRIES } from "@/lib/constants";
import { errorResponseFor, jsonResponse } from "@/lib/http";
import { normalisePhone, type PhoneCountry } from "@/lib/phone";
import { parseRef } from "@/lib/ref";
import { requiredText, V } from "@/lib/schemas/common";
import { AuthError, type Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { profileOf, setProfileName } from "@/server/repositories/identity";
import { eraseMyAccount, exportMyData, progressOf, requestLink } from "@/server/repositories/student";
import { homeOf, preferencesOf } from "@/server/repositories/student-home";

/**
 * The student portal (S8.1 to S8.3; architecture 9.6, 10.8, 16 A11 to A13): plain data calls and mutations in the Worker entry
 * (ADR-040). Open to any signed-in user. A student sees only what row level security lets a student see, and who they are comes
 * from the session, never from anything the browser sends.
 */

/** A12: what the student typed is either a reference (`SC-...`) or a WhatsApp number. `country` is only needed for a number typed without `+`. */
export const requestLinkBody = z.strictObject({
  reference: z.string({ error: V.REQUIRED }).trim().min(1, V.REQUIRED).max(40, V.TOO_LONG),
  country: z.enum(NUMBER_COUNTRIES, { error: V.UNKNOWN_VALUE }).optional(),
});

export const setNameBody = z.strictObject({ name: requiredText(80) });
export const erasureBody = z.strictObject({ confirm: z.literal("DELETE", { error: V.REQUIRED }) });
const emptyBody = z.strictObject({});

/** Pure: reads what was typed as a reference or as a number, or says it is neither. */
export function readLinkInput(text: string, country?: PhoneCountry): { ref: string } | { number: string } | { problem: "INVALID" | "NEEDS_COUNTRY" } {
  // `parseRef` is forgiving about a missing prefix, so a ten digit local number would pass for a reference. A reference is only what
  // starts with SC, the way it is shown and printed on every application.
  if (/^\s*sc/i.test(text)) {
    const ref = parseRef(text);
    return ref ? { ref } : { problem: "INVALID" };
  }
  const phone = normalisePhone(text, country);
  if (phone.ok) return { number: phone.value.e164 };
  return { problem: phone.error === "NEEDS_COUNTRY" ? "NEEDS_COUNTRY" : "INVALID" };
}

const signedIn = { kind: "signed-in" } as const;

/** The first word of a name: what the screens greet and what the phone keeps offline (never the full name). Null for nothing. */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return first === "" ? null : first.slice(0, 40);
}

export function studentDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** A11: the student's stage, the six stages and what to do next. Offline, the screen shows the last copy it kept on the phone. */
    "me/progress": async (actor) => {
      const progress = await progressOf(env.db, actor);
      const names = progress.stages.map((s) => ({ code: s.code, position: s.position }));
      const lead = progress.leads[0] ?? null;
      return {
        userId: actor.userId,
        // `matching`: no linked application yet, `linked`: at least one. A student with a pending request still sees "matching".
        state: lead ? "linked" : "matching",
        pendingClaims: progress.pendingClaims,
        stages: names,
        lead: lead ? { ref: lead.ref, stage: lead.stageCode, updatedAt: lead.updatedAt.toISOString() } : null,
        otherLeads: Math.max(0, progress.leads.length - 1),
        whatsappE164: progress.whatsappE164,
      };
    },

    /**
     * S13.4, the student's Home: their name, answers, stage and the WhatsApp number in one call. When the person has not onboarded yet the
     * greeting falls back to the name Google gave us. The ordered university list is made on the phone from the public catalogue.
     */
    "me/home": async (actor, call) => {
      const home = await homeOf(env.db, actor);
      const fallback = home.contactName === null && call.token ? (await profileOf(env.db, call.token))?.name ?? null : null;
      return {
        userId: actor.userId,
        onboarded: home.onboarded,
        relationship: home.relationship,
        firstName: firstNameOf(home.contactName ?? fallback),
        courseFields: home.courseFields,
        level: home.level,
        intakeYear: home.intakeYear,
        lead: home.lead ? { ref: home.lead.ref, stage: home.lead.stageCode, updatedAt: home.lead.updatedAt.toISOString() } : null,
        stages: home.stages,
        whatsappE164: home.whatsappE164,
      };
    },

    /** S13.4: the answers only, so Universities can pre-select and order. */
    "me/preferences": async (actor) => {
      const preferences = await preferencesOf(env.db, actor);
      return { userId: actor.userId, onboarded: preferences.onboarded, firstName: firstNameOf(preferences.contactName), courseFields: preferences.courseFields, level: preferences.level, intakeYear: preferences.intakeYear };
    },

    /** A13 step 1: the name and email the sign-in gave us. */
    "me/profile": async (_actor, call) => {
      const profile = call.token ? await profileOf(env.db, call.token) : null;
      if (!profile) throw new AuthError("UNAUTHENTICATED", "Sign in required.");
      return { name: profile.name, email: profile.email };
    },
  };
}

export const studentMutations: Record<string, Mutation> = {
  /** A13 step 1: edit the display name. The email is the Google account's and cannot be changed here. */
  "me/profile.setName": {
    access: signedIn,
    async handle({ env, token, body, requestId }) {
      const parsed = parseBody(setNameBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      if (!token || !(await setProfileName(env.db, token, parsed.value.name))) {
        return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { name: "INVALID" } });
      }
      return jsonResponse({ saved: true });
    },
  },

  /** A12: ask an admin to link an application. Nothing is linked here, and the answer does not say whether anything matched. */
  "me/student.requestLink": {
    access: signedIn,
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(requestLinkBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const input = readLinkInput(parsed.value.reference, parsed.value.country);
      if ("problem" in input) return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { reference: input.problem } });
      const outcome = await requestLink(env.db, actor as Actor, input);
      if (outcome === "rate_limited") return errorResponseFor("RATE_LIMITED", "Too many requests. Try again tomorrow.", requestId, { headers: { "Retry-After": "86400" } });
      return jsonResponse({ status: "sent" });
    },
  },

  /** A13 step 2: the student's own data as one JSON document. Logged as a done data request in the same transaction. */
  "me/student.exportData": {
    access: signedIn,
    async handle({ actor, env, token, body, requestId }) {
      const parsed = parseBody(emptyBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const [data, profile] = await Promise.all([exportMyData(env.db, actor as Actor), token ? profileOf(env.db, token) : Promise.resolve(null)]);
      return jsonResponse({ exportedAt: env.now().toISOString(), account: profile ? { name: profile.name, email: profile.email } : null, ...data });
    },
  },

  /**
   * A13 step 3: delete my data. Needs a sign-in in the last 10 minutes (checked in the database from the session's own creation time)
   * and the word DELETE. Anonymises the linked leads, deletes the account, ends the session. Payments are kept without the link.
   */
  "me/student.requestErasure": {
    access: signedIn,
    async handle({ actor, env, token, body, requestId }) {
      const parsed = parseBody(erasureBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      if (!token) return errorResponseFor("UNAUTHENTICATED", "Sign in required.", requestId);
      const outcome = await eraseMyAccount(env.db, actor as Actor, token);
      switch (outcome) {
        case "erased":
          return jsonResponse({ erased: true });
        case "reauth_required":
          return errorResponseFor("STEP_UP_REQUIRED", "Sign in again to confirm.", requestId, { fields: { session: "REAUTH_REQUIRED" } });
        case "staff_account":
          return errorResponseFor("CONFLICT", "A team account cannot delete itself.", requestId, { fields: { account: "STAFF" } });
        case "not_found":
          return errorResponseFor("NOT_FOUND", "That account does not exist.", requestId);
      }
    },
  },
};

