import { sql } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";
import { staleItemsOf, staleQuery } from "./content-admin";

/**
 * What the owner's Health page reads and what the daily job writes (S10.2; architecture 13.2, 16 C7). The job has no signed-in person, so
 * its two calls are SECURITY DEFINER functions (migration 0011); the page reads as the owner.
 */

/** The deep health check (`GET /api/v1/health?deep=1`): resolves when the database answers a trivial query. */
export async function pingDatabase(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}

export interface UsageSnapshot {
  dbBytes: number;
  imageBytes: number;
  imageBudgetBytes: number;
}

/** The three counters. No signed-in person needed: the function returns sizes only. */
export async function usageSnapshot(db: Db): Promise<UsageSnapshot> {
  const result = await db.execute(sql`select * from public.app_usage_snapshot()`);
  const row = rowsOf<{ db_bytes: string | number; image_bytes: string | number; image_budget: string | number }>(result)[0];
  return { dbBytes: Number(row?.db_bytes ?? 0), imageBytes: Number(row?.image_bytes ?? 0), imageBudgetBytes: Number(row?.image_budget ?? 0) };
}

/** Records that a job ran. `detail` holds counts only (the function adds `ok`). */
export async function recordJob(db: Db, job: "rollup" | "usage", ok: boolean, detail: Record<string, number | string | boolean> = {}): Promise<void> {
  await db.execute(sql`select public.app_record_job(${job}::text, ${ok}::boolean, ${JSON.stringify(detail)}::jsonb)`);
}

export interface JobStatus {
  job: "rollup" | "usage";
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastFailedAt: string | null;
}

export interface HealthData {
  usage: UsageSnapshot;
  jobs: JobStatus[];
  stale: { fees: number; campus: number; resources: number };
  collectPageViews: boolean;
  /** Share of active leads whose stage moved in the last N days (PRD metric); null until the owner sets N. */
  pipeline: { days: number; active: number; fresh: number } | null;
}

export const JOBS: readonly JobStatus["job"][] = ["rollup", "usage"];

export async function healthData(db: Db, actor: Actor): Promise<HealthData> {
  // One batch, so the owner's page pays for Neon's wake-up once (architecture 12) and the reads see one consistent moment.
  const [usage, jobs, flags, freshness, staleResult] = await runAs(
    db,
    actor,
    db.execute(sql`select * from public.app_usage_snapshot()`),
    db.execute(sql`
      select substring(action from 5) as job, max(at) as last_run,
             max(at) filter (where (meta->>'ok')::boolean) as last_ok,
             max(at) filter (where not (meta->>'ok')::boolean) as last_failed
        from audit_log where action in ('job.rollup', 'job.usage') group by action`),
    db.execute(sql`select key, value from site_setting where key in ('collect_page_views', 'pipeline_freshness_days')`),
    db.execute(sql`
      select count(*)::int as active,
             count(*) filter (where exists (
               select 1 from lead_activity a
                where a.lead_id = l.id and a.type in ('created', 'stage_changed')
                  and a.created_at > now() - make_interval(days => f.days))) ::int as fresh,
             f.days
        from lead l,
             (select (value #>> '{}')::int as days from site_setting where key = 'pipeline_freshness_days' and jsonb_typeof(value) = 'number') f
       where l.stage_code <> 'arrived' and l.merged_into_id is null and l.anonymised_at is null
       group by f.days`),
    staleQuery(db),
  );
  const stale = staleItemsOf(staleResult);

  const u = rowsOf<{ db_bytes: string | number; image_bytes: string | number; image_budget: string | number }>(usage)[0];
  const status = new Map(rowsOf<{ job: string; last_run: string | Date | null; last_ok: string | Date | null; last_failed: string | Date | null }>(jobs).map((r) => [r.job, r]));
  const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
  const setting = new Map(rowsOf<{ key: string; value: unknown }>(flags).map((r) => [r.key, r.value]));
  const f = rowsOf<{ active: number; fresh: number; days: number }>(freshness)[0];
  const days = setting.get("pipeline_freshness_days");
  return {
    usage: { dbBytes: Number(u?.db_bytes ?? 0), imageBytes: Number(u?.image_bytes ?? 0), imageBudgetBytes: Number(u?.image_budget ?? 0) },
    jobs: JOBS.map((job) => {
      const r = status.get(job);
      return { job, lastRunAt: iso(r?.last_run), lastOkAt: iso(r?.last_ok), lastFailedAt: iso(r?.last_failed) };
    }),
    stale: {
      fees: stale.filter((s) => s.type === "fees").length,
      campus: stale.filter((s) => s.type === "campus").length,
      resources: stale.filter((s) => s.type === "resources").length,
    },
    collectPageViews: setting.get("collect_page_views") !== false,
    pipeline: typeof days === "number" ? { days, active: f?.active ?? 0, fresh: f?.fresh ?? 0 } : null,
  };
}
