import * as z from "zod";
import { errorResponseFor, newRequestId } from "@/lib/http";
import { V } from "@/lib/schemas/common";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { inboxFor } from "@/server/repositories/inbox";
import { INBOX_SECTIONS } from "./sections";

/**
 * `GET admin/inbox?section=` (architecture 24.9): the counts of every section and the rows of one, in one data call. The area prefix makes it
 * staff-only; what a manager sees is decided by row level security under the query.
 */
const inboxQuery = z.strictObject({ section: z.enum(INBOX_SECTIONS, { error: V.UNKNOWN_VALUE }).default("new") });

export function inboxDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "admin/inbox": async (actor, call) => {
      const parsed = inboxQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return errorResponseFor("VALIDATION", "Check the section.", newRequestId(), { fields: { section: "UNKNOWN_VALUE" } });
      const me = actor as Actor;
      return inboxFor(env.db, me, me.role === "admin" ? "admin" : "manager", parsed.data.section);
    },
  };
}
