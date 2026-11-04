import * as z from "zod";
import { countryCodeSchema, V } from "@/lib/schemas/common";
import { resolveRange, type DateRange } from "@/modules/analytics/funnel";
import { ASSIGNED, type Assigned } from "./metrics";

/**
 * The filters of the CRM screens (PRD_3 F18 amended, architecture 22.8): a date range in WAT, a country, where the lead came from, and whom it is
 * assigned to. They live in the address so a view can be bookmarked and the export is the same query. A value the screen could not have produced is
 * a 400 with the field named, never a silent "show everything" (the rule the analytics screens already follow).
 */

const date = z.string({ error: V.INVALID }).regex(/^\d{4}-\d{2}-\d{2}$/, V.INVALID);

export { ASSIGNED, type Assigned } from "./metrics";

export const crmQuery = z.strictObject({
  from: date.optional(),
  to: date.optional(),
  country: countryCodeSchema.optional(),
  /** The page group a lead was made on (`/apply`, `onboarding`, `/`, a university page): what the lead's own `source.page` holds. */
  source: z
    .string({ error: V.INVALID })
    .min(1, V.INVALID)
    .max(80, V.INVALID)
    .regex(/^[A-Za-z0-9/_\-.]+$/, V.INVALID)
    .optional(),
  assigned: z.enum(ASSIGNED, { error: V.INVALID }).optional(),
});

export interface CrmFilters {
  range: DateRange;
  country: string | null;
  source: string | null;
  assigned: Assigned;
}

export type CrmFiltersResult = { ok: true; filters: CrmFilters } | { ok: false; fields: Record<string, string> };

/** Reads the query string. Pure: the clock is passed in, so "today" is testable. */
export function readCrmFilters(params: URLSearchParams, now: Date): CrmFiltersResult {
  const parsed = crmQuery.safeParse(Object.fromEntries(params));
  if (!parsed.success) return { ok: false, fields: Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? "query"), issue.message])) };
  const range = resolveRange(parsed.data, now);
  if ("problem" in range) return { ok: false, fields: { [range.field]: range.problem } };
  return { ok: true, filters: { range, country: parsed.data.country ?? null, source: parsed.data.source ?? null, assigned: parsed.data.assigned ?? "all" } };
}

/** The same filters as a query string, for the links that carry them (the export, the board). Empty values are left out. */
export function filtersToQuery(input: { from?: string; to?: string; country?: string; source?: string; assigned?: string }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}
