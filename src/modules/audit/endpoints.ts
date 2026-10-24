import { errorResponseFor, newRequestId } from "@/lib/http";
import { AuthError } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { AUDIT_PAGE_SIZE, listAudit, listAuditActions } from "@/server/repositories/audit";
import { listTeam } from "@/server/repositories/team";
import { auditQuery, watRange } from "./schema";

/**
 * The Audit page (S2.7; architecture 16 C5): a read-only list, newest first, for the owner only. The database also refuses
 * anyone else (policy `audit_log_read`), so a missing check here returns an empty list, never the log.
 */
export function auditDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "admin/audit": async (actor, call) => {
      if (actor.role !== "owner") throw new AuthError("FORBIDDEN", "Not allowed.");
      const parsed = auditQuery.safeParse(Object.fromEntries(call.url.searchParams));
      const range = parsed.success ? watRange(parsed.data.from, parsed.data.to) : null;
      // A filter the screen could not have produced. Say so plainly instead of silently showing everything.
      if (!parsed.success || !range) return errorResponseFor("VALIDATION", "Check the filters.", newRequestId());
      const { actor: actorId, action, before } = parsed.data;

      const [rows, team, actions] = await Promise.all([
        listAudit(env.db, actor, {
          ...(actorId ? { actorId } : {}),
          ...(action ? { action } : {}),
          ...range,
          ...(before ? { before: { id: before } } : {}),
          limit: AUDIT_PAGE_SIZE + 1,
        }),
        listTeam(env.db, actor),
        listAuditActions(env.db, actor),
      ]);

      const page = rows.slice(0, AUDIT_PAGE_SIZE);
      const last = page[page.length - 1];
      const emailOf = new Map(team.map((m) => [m.userId, m.email]));
      return {
        entries: page.map((row) => ({
          id: row.id,
          at: row.at.toISOString(),
          // A person no longer on the team has no email to show; the id is kept so the trail still groups by person.
          actorId: row.actorId,
          actorEmail: row.actorId ? (emailOf.get(row.actorId) ?? null) : null,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          meta: row.meta,
        })),
        people: team.map((m) => ({ id: m.userId, email: m.email })),
        actions,
        nextBefore: rows.length > AUDIT_PAGE_SIZE && last ? last.id : null,
      };
    },
  };
}
