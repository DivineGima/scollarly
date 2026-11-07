import { runDailyRollup, type RollupResult } from "@/modules/analytics/rollup";
import { getDb } from "@/server/db/runtime";
import { getDocumentStore } from "@/server/media/runtime";
import { runPurge, type PurgeResult } from "@/server/media/purge";
import { markPurged, purgeCandidates } from "@/server/repositories/documents";
import { recordJob } from "@/server/repositories/health";
import { rollRawEvents, saveAggregateRows } from "@/server/repositories/rollup";
import { runUsageCheck } from "./usage-job";

/**
 * The scheduled handler (architecture 8.5): once a day at 23:05 UTC (00:05 WAT) the anonymous counts of the collector and the
 * raw tap rows are rolled into `event_daily_agg` and the old raw rows are purged (S7.1). Overdue leads, stale fees and tours and
 * expired invites are not jobs; each is a query (8.5). After the rollup the usage check runs (S10.2, `usage-job.ts`), and each of the two
 * writes a job record the owner's Health page shows.
 *
 * Nothing runs more often than daily, so Neon is never kept awake by the schedule.
 */

export interface CollectorStub {
  recordCron(scheduledTime: number): Promise<void>;
  drainAggregates(): Promise<Record<string, number>>;
  restoreAggregates(counts: Record<string, number>): Promise<void>;
}

/** The line written to Workers Logs. Counts of rows only: no key, no event and no identifier. */
export function rollupLogLine(result: RollupResult): string {
  return JSON.stringify({ level: result.failed.length > 0 ? "error" : "info", job: "rollup", ...result });
}

export async function runScheduled(env: CloudflareEnv, scheduledTime: number, now: () => Date = () => new Date()): Promise<RollupResult> {
  const collector = env.COLLECTOR.get(env.COLLECTOR.idFromName("global")) as unknown as CollectorStub;
  // Bookkeeping from Stage 0. If it fails the rollup must still run: a day's counts are worth more than the "it ran" marker.
  await collector.recordCron(scheduledTime).catch((error: unknown) => {
    console.error(JSON.stringify({ level: "error", job: "rollup", step: "recordCron", error: error instanceof Error ? error.name : typeof error }));
  });
  const db = getDb(env);
  const result = await runDailyRollup({
    drain: () => collector.drainAggregates(),
    restore: (counts) => collector.restoreAggregates(counts),
    saveCounts: (rows) => saveAggregateRows(db, rows),
    rollRaw: (todayWat) => rollRawEvents(db, todayWat),
    now,
  });
  console.log(rollupLogLine(result));
  // The record is bookkeeping for the Health page: if it cannot be written the run still counts for what it did.
  await recordJob(db, "rollup", result.failed.length === 0, { keys: result.keys, rows: result.rows, rawCounted: result.rawCounted, rawPurged: result.rawPurged, failed: result.failed.length }).catch(() => undefined);
  const usage = await runUsageCheck(db);
  // The purge of student files is a step of its own (architecture 24.7): its failure is recorded and thrown, but it never stops the work above.
  const purge = await runDocumentPurge(env, db);
  // A failed run is thrown, so Cloudflare lists it as failed instead of quietly succeeding.
  if (result.failed.length > 0) throw new Error(`The daily rollup failed: ${result.failed.join(", ")}`);
  if (usage === null) throw new Error("The daily usage check failed.");
  if (purge === null) throw new Error("The daily purge of student files failed.");
  return result;
}

/** Counts only in the log and the job record: no key, no student and no document is ever written down. Null when the step failed. */
export async function runDocumentPurge(env: CloudflareEnv, db: ReturnType<typeof getDb>): Promise<PurgeResult | null> {
  let store: ReturnType<typeof getDocumentStore>;
  try {
    store = getDocumentStore(env);
  } catch {
    // Storage is not set up for this deployment (a preview, a test): with no files to purge the step has nothing to do. But if files are waiting
    // (the secrets were lost), the run fails so the retention promise is not silently broken.
    const waiting = await purgeCandidates(db, 1).catch(() => null);
    if (waiting === null || waiting.length > 0) {
      console.error(JSON.stringify({ level: "error", job: "purge", message: "storage is not configured and files are waiting to be purged" }));
      await recordJob(db, "purge", false, {}).catch(() => undefined);
      return null;
    }
    console.warn(JSON.stringify({ level: "warn", job: "purge", message: "storage is not configured; nothing to purge" }));
    return { found: 0, deleted: 0, marked: 0, failed: 0 };
  }
  try {
    const result = await runPurge({
      candidates: (limit) => purgeCandidates(db, limit),
      deleteObject: (key) => store.deleteObject(key),
      markPurged: (ids) => markPurged(db, ids),
    });
    console.log(JSON.stringify({ level: result.failed > 0 ? "error" : "info", job: "purge", ...result }));
    await recordJob(db, "purge", result.failed === 0, { ...result }).catch(() => undefined);
    return result.failed === 0 ? result : null;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", job: "purge", error: error instanceof Error ? error.name : typeof error }));
    await recordJob(db, "purge", false, {}).catch(() => undefined);
    return null;
  }
}
