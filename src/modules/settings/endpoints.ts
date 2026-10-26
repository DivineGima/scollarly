import { errorResponseFor, jsonResponse } from "@/lib/http";
import { type Actor, AuthError } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { PUBLIC_PAGE_PATHS } from "@/server/edge/fast-path";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { readSettings } from "@/server/repositories/settings-read";
import { updateSettings } from "@/server/repositories/settings";
import { EDITABLE_SETTING_KEYS, MEDIA_BUDGET_MAX_BYTES, MEDIA_BUDGET_MIN_BYTES, PUBLIC_SETTING_KEYS, updateSettingsBody } from "./schema";

/**
 * The Settings screen (S10.1; architecture 8.3, 16 C4). The owner only, and saving needs a 2FA check inside the last 10 minutes. A change
 * takes effect for what happens afterwards: a lead already stored keeps the SLA target it was given (`sla_due_at`, `sla_hours_applied`
 * are written once, architecture 10.7), and the public site is told to refresh when a setting that appears on it changed.
 */

/** Every public page whose text can carry the WhatsApp or contact number. The offline page is a fixed copy and is left alone. */
const PUBLIC_REFRESH_PATHS = [...PUBLIC_PAGE_PATHS].filter((path) => path !== "/offline");

export const settingsMutations: Record<string, Mutation> = {
  /** C4 step 2. Validation first (a bad value is a 400 naming the field), then one statement for the whole change. */
  "admin/settings.update": {
    access: { kind: "role", role: "owner", stepUp: true },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(updateSettingsBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const { changed, missing } = await updateSettings(env.db, actor as Actor, parsed.value.changes);
      if (missing.length > 0) return errorResponseFor("NOT_FOUND", "A setting does not exist.", requestId, { fields: Object.fromEntries(missing.map((key) => [key, "UNKNOWN_VALUE"])) });
      const touchesSite = changed.some((key) => (PUBLIC_SETTING_KEYS as readonly string[]).includes(key));
      return jsonResponse({ changed, revalidate: touchesSite ? { areas: ["site"], paths: PUBLIC_REFRESH_PATHS } : null });
    },
  },
};

export function settingsDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** C4 step 1: the current values and the limits the form shows. */
    "admin/settings": async (actor) => {
      if (actor.role !== "owner") throw new AuthError("FORBIDDEN", "Not allowed.");
      const all = await readSettings(env.db);
      return {
        values: Object.fromEntries(EDITABLE_SETTING_KEYS.map((key) => [key, all[key] ?? null])),
        timezone: "Africa/Douala",
        limits: { mediaBudgetMinBytes: MEDIA_BUDGET_MIN_BYTES, mediaBudgetMaxBytes: MEDIA_BUDGET_MAX_BYTES },
      };
    },
  };
}
