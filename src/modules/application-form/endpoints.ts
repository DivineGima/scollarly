import { errorResponseFor, jsonResponse, newRequestId } from "@/lib/http";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { readFormState, saveForm } from "@/server/repositories/application-form";
import { profileOf } from "@/server/repositories/identity";
import { formBody } from "./schema";
import { decidePassport, prefillOf } from "./service";

/**
 * The step-2 form (S17.2; FR-43, architecture 24.2). Two calls: what the form shows (prefilled), and the save. The form belongs to an
 * application, so before the student has applied, and once the file is closed, it is read-only and the save is refused. The passport number
 * is asked only when the application's university asks for it.
 */

export function applicationFormDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "me/application-form": async (actor, call) => {
      const state = await readFormState(env.db, actor);
      if (!state) return errorResponseFor("NOT_FOUND", "There is no profile yet.", newRequestId());
      const email = call.token ? ((await profileOf(env.db, call.token))?.email ?? null) : null;
      const form = prefillOf(state.profile, email);
      return { ...form, application: state.application, passportRequired: state.passportRequired, editable: state.application?.status === "open" };
    },
  };
}

export const applicationFormMutations: Record<string, Mutation> = {
  "me/applicationForm.save": {
    access: { kind: "signed-in" },
    async handle({ actor, env, body, requestId }) {
      const me = actor as Actor;
      if (me.role !== "student") return errorResponseFor("FORBIDDEN", "Not allowed.", requestId);
      const parsed = parseBody(formBody, body, requestId);
      if (!parsed.ok) return parsed.response;

      const state = await readFormState(env.db, me);
      if (!state) return errorResponseFor("NOT_FOUND", "There is no profile yet.", requestId);
      if (!state.application) return errorResponseFor("CONFLICT", "Apply first, then fill in this form.", requestId, { fields: { form: "NOT_APPLIED" } });
      if (state.application.status !== "open") return errorResponseFor("CONFLICT", "This application is closed.", requestId, { fields: { form: "CLOSED" } });

      const passport = decidePassport(state.passportRequired, parsed.value.passportNumber);
      if (!passport.ok) return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { passportNumber: "REQUIRED" } });
      if (!(await saveForm(env.db, me, parsed.value, passport.store))) return errorResponseFor("NOT_FOUND", "There is no profile yet.", requestId);
      return jsonResponse({ saved: true });
    },
  },
};
