import * as z from "zod";
import { errorResponseFor, newRequestId } from "@/lib/http";
import { countryCodeSchema, uuidSchema, V } from "@/lib/schemas/common";
import { AuthError } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { funnelData, performanceOf, performanceOfAll } from "@/server/repositories/analytics";
import { buildFunnel, resolveRange } from "./funnel";

/**
 * The analytics screens (S7.2, S7.3; architecture 16 B10): plain data calls in the Worker entry (ADR-040). Staff only, checked by
 * the facade first and by row level security again. The filters are in the URL, so a view can be bookmarked; a value the screen
 * could not have produced is a 400 with the field named, never a silent "show everything".
 */

const date = z.string({ error: V.INVALID }).regex(/^\d{4}-\d{2}-\d{2}$/, V.INVALID);

export const analyticsQuery = z.strictObject({
  from: date.optional(),
  to: date.optional(),
  country: countryCodeSchema.optional(),
  university: uuidSchema.optional(),
});

export const performanceQuery = z.strictObject({ from: date.optional(), to: date.optional() });

const invalid = (fields: Record<string, string>) => errorResponseFor("VALIDATION", "Check the filters.", newRequestId(), { fields });

function stageLabel(name: Record<string, string> | string, fallback: string): string {
  return typeof name === "string" ? name : (name.en ?? fallback);
}

export function analyticsDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** B10 steps 1 to 4 and 6: the funnel and the sources, for a date range, country and university. */
    "admin/analytics": async (actor, call) => {
      const parsed = analyticsQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "query"), i.message])));
      const range = resolveRange(parsed.data, env.now());
      if ("problem" in range) return invalid({ [range.field]: range.problem });

      const data = await funnelData(env.db, actor, {
        from: range.from,
        to: range.to,
        start: range.start,
        end: range.end,
        ...(parsed.data.country ? { country: parsed.data.country } : {}),
        ...(parsed.data.university ? { universityId: parsed.data.university } : {}),
      });
      const names = new Map(data.stages.map((s) => [s.code, stageLabel(s.name, s.code)]));
      const funnel = buildFunnel({ pageViews: data.pageViews, waTaps: data.waTaps, leadsByStage: data.leadsByStage, stages: data.stages, includeVisits: data.collectPageViews });
      return {
        range: { from: range.from, to: range.to },
        collectPageViews: data.collectPageViews,
        funnel: funnel.map((row) => {
          const code = row.key.startsWith("stage:") ? row.key.slice("stage:".length) : null;
          return { key: row.key, count: row.count, ratio: row.ratio, stage: code, label: code ? (names.get(code) ?? code) : null };
        }),
        sources: { byCountry: data.byCountry, byUniversity: data.byUniversity, byPage: data.byPage },
        universities: data.universities,
        payments: data.payments,
        totalLeads: [...data.leadsByStage.values()].reduce((sum, n) => sum + n, 0),
      };
    },

    /** B10 step 5: the signed-in admin's own numbers. The person is the actor; there is no way to ask for someone else's. */
    "admin/performance": async (actor, call) => {
      const parsed = performanceQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "query"), i.message])));
      const now = env.now();
      const range = resolveRange(parsed.data, now);
      if ("problem" in range) return invalid({ [range.field]: range.problem });
      return { range: { from: range.from, to: range.to }, ...(await performanceOf(env.db, actor, range, now)) };
    },

    /** C3 (S9.4): every admin's numbers. The owner only; an admin gets a 403 here and can only ever read their own through `admin/performance`. */
    "admin/performance-all": async (actor, call) => {
      if (actor.role !== "owner") throw new AuthError("FORBIDDEN", "Not allowed.");
      const parsed = performanceQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "query"), i.message])));
      const now = env.now();
      const range = resolveRange(parsed.data, now);
      if ("problem" in range) return invalid({ [range.field]: range.problem });
      return { range: { from: range.from, to: range.to }, admins: await performanceOfAll(env.db, actor, range, now) };
    },
  };
}
