import * as z from "zod";
import { jsonResponse } from "@/lib/http";
import { TOUR_KEYS } from "@/modules/nav/config";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { staffHome } from "@/server/repositories/admin-home";
import { markTourSeen } from "@/server/repositories/tours";
import { fillSeries, periodWindows, readPeriod } from "./periods";

/**
 * The staff Home and the first-visit tours (S13.6, architecture 21.9, 21.10). `GET admin/home?period=week|month` answers the tiles, the line
 * of leads per day, the latest activity and the "needs you today" counts, for the caller's role: an admin gets their own working numbers,
 * the owner the owner's tiles. `POST admin/tour.seen` records that a tab's tour was shown.
 */

const tourBody = z.strictObject({ tab: z.enum(TOUR_KEYS as unknown as [string, ...string[]]) });

export function homeDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    "admin/home": async (actor, call) => {
      const windows = periodWindows(env.now(), readPeriod(call.url.searchParams.get("period")));
      const home = await staffHome(env.db, actor, windows);
      return {
        period: windows.period,
        role: actor.role,
        days: windows.days,
        // The day names are WAT calendar days; the numbers are counts only, so the phone may keep them offline (architecture 21.11).
        series: fillSeries(windows.labels, home.series),
        totals: home.totals,
        activity: home.activity,
      };
    },
  };
}

export const tourMutations: Record<string, Mutation> = {
  "admin/tour.seen": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(tourBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      await markTourSeen(env.db, actor as Actor, parsed.value.tab);
      return jsonResponse({ seen: true });
    },
  },
};
