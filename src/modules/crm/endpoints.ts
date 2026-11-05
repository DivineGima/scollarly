import { errorResponseFor, newRequestId } from "@/lib/http";
import { DAY_MS, watDateString } from "@/lib/time";
import { parseDate } from "@/modules/analytics/funnel";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import { performanceOfAll } from "@/server/repositories/analytics";
import { writeAudit } from "@/server/repositories/audit";
import { crmOverview, exportLeads, pipelineBoard } from "@/server/repositories/crm";
import { fillSeries } from "@/modules/dashboard/periods";
import { readCrmFilters } from "./filters";
import { formatMinutes, funnelFromStages, percentOf, toCsv, topSlices, withOnboardedStep } from "./metrics";

/**
 * The CRM screens (PRD_3 F18 amended, architecture 22.8, ADR-057, ADR-058): plain data calls in the Worker entry (ADR-040), staff only, checked by
 * the facade first and by row level security again. `admin/crm` answers the numbers and charts, `admin/pipeline` the board, `admin/export` the file.
 * The filters are in the address; one the screen could not have produced is a 400 naming the field.
 */

const invalid = (fields: Record<string, string>) => errorResponseFor("VALIDATION", "Check the filters.", newRequestId(), { fields });

/** Every WAT calendar day from `from` to `to`, oldest first, so a day with no leads is a zero on the chart rather than a gap. */
export function daysBetween(from: string, to: string): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return [];
  const labels: string[] = [];
  for (let at = start.getTime(); at <= end.getTime(); at += DAY_MS) labels.push(watDateString(new Date(at + DAY_MS / 2)));
  return labels;
}

const stageLabel = (name: Record<string, string> | string, fallback: string): string => (typeof name === "string" ? name : (name.en ?? fallback));

/** Soft limit on exports per Worker instance: five in ten minutes for one person. It is a brake, not a security boundary (the file holds no name, number or email). */
const EXPORT_LIMIT = 5;
const EXPORT_WINDOW_MS = 10 * 60_000;
const exportsByUser = new Map<string, number[]>();

export function exportAllowed(userId: string, now: number): boolean {
  const recent = (exportsByUser.get(userId) ?? []).filter((at) => now - at < EXPORT_WINDOW_MS);
  if (recent.length >= EXPORT_LIMIT) {
    exportsByUser.set(userId, recent);
    return false;
  }
  exportsByUser.set(userId, [...recent, now]);
  return true;
}

export function crmDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "admin/crm": async (actor, call) => {
      const now = env.now();
      const read = readCrmFilters(call.url.searchParams, now);
      if (!read.ok) return invalid(read.fields);
      const f = read.filters;
      const [data, admins] = await Promise.all([
        crmOverview(env.db, actor, f),
        // Every admin's numbers side by side are the owner's view only (architecture 9, C3); an admin never gets this call's second half.
        actor.role === "owner" ? performanceOfAll(env.db, actor, { start: f.range.start, end: f.range.end }, now) : Promise.resolve(null),
      ]);
      const funnel = funnelFromStages(data.stages.map((stage) => ({ code: stage.code, position: stage.position, count: stage.count })));
      const labelOf = new Map(data.stages.map((stage) => [stage.code, stageLabel(stage.name, stage.code)]));
      return {
        range: { from: f.range.from, to: f.range.to },
        filters: { country: f.country, source: f.source, assigned: f.assigned },
        totals: {
          leads: data.current.leads,
          previousLeads: data.previous.leads,
          answered: data.current.answered,
          previousAnswered: data.previous.answered,
          answeredPercent: percentOf(data.current.answered, data.current.leads),
          avgFirstResponse: formatMinutes(data.current.avgFirstResponseMinutes),
          previousAvgFirstResponseMinutes: data.previous.avgFirstResponseMinutes,
          overdue: data.overdue,
          arrived: data.arrived,
          arrivedPercent: percentOf(data.arrived, data.current.leads),
          onboarded: data.onboarding?.onboarded ?? null,
          appliedOfOnboarded: data.onboarding?.applied ?? null,
          appliedOfOnboardedPercent: data.onboarding ? percentOf(data.onboarding.applied, data.onboarding.onboarded) : null,
        },
        series: fillSeries(daysBetween(f.range.from, f.range.to), data.days),
        stages: data.stages.map((stage) => ({ code: stage.code, label: labelOf.get(stage.code) ?? stage.code, count: stage.count })),
        funnel: withOnboardedStep(funnel, data.onboarding?.onboarded ?? null).map((step) => ({ ...step, label: labelOf.get(step.code) ?? step.code })),
        countries: topSlices(data.countries, 8),
        sources: topSlices(data.sources, 8),
        admins:
          admins === null
            ? null
            : admins.map((admin) => ({ userId: admin.userId, name: admin.name, assigned: admin.assigned, answered: admin.answered, overdue: admin.overdue, medianMinutes: admin.medianMinutes })),
      };
    },

    "admin/pipeline": async (actor, call) => {
      const now = env.now();
      const read = readCrmFilters(call.url.searchParams, now);
      if (!read.ok) return invalid(read.fields);
      const columns = await pipelineBoard(env.db, actor, read.filters, now);
      return {
        filters: { country: read.filters.country, source: read.filters.source, assigned: read.filters.assigned },
        columns: columns.map((column) => ({ code: column.code, label: stageLabel(column.name, column.code), total: column.total, cards: column.cards })),
      };
    },

    /** The leads in the filtered range as a CSV file. It answers with the file itself (a `Response`), never JSON. */
    "admin/export": async (actor: Actor, call) => {
      const now = env.now();
      const read = readCrmFilters(call.url.searchParams, now);
      if (!read.ok) return invalid(read.fields);
      if (!exportAllowed(actor.userId, now.getTime())) {
        return errorResponseFor("RATE_LIMITED", "Too many exports. Try again in a few minutes.", newRequestId(), { headers: { "Retry-After": "600" } });
      }
      const { rows, truncated } = await exportLeads(env.db, actor, read.filters, now);
      // The export is a record of who took data out and how much; the filters are kept, never a name or a number.
      await writeAudit(env.db, actor, { action: "leads.exported", entityType: "lead", meta: { rows: rows.length, truncated, from: read.filters.range.from, to: read.filters.range.to, country: read.filters.country, source: read.filters.source, assigned: read.filters.assigned } });
      const header = ["reference", "received_at_utc", "stage", "country", "source", "intake", "assigned", "first_response_minutes", "overdue"];
      const body = toCsv(header, rows.map((row) => [row.ref, row.receivedAt, row.stage, row.country, row.source, row.intake, row.assigned ? "yes" : "no", row.firstResponseMinutes, row.overdue ? "yes" : "no"]));
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="scollarly-leads-${read.filters.range.from}-to-${read.filters.range.to}.csv"`,
          "Cache-Control": "no-store",
          "X-Export-Rows": String(rows.length),
          "X-Export-Truncated": truncated ? "yes" : "no",
        },
      });
    },
  };
}
