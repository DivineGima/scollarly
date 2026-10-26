import { DATABASE_BUDGET_BYTES, type Usage, usageLogLine, usageOf } from "@/modules/health/service";
import type { Db } from "@/server/db/client";
import { recordJob, usageSnapshot } from "@/server/repositories/health";

/**
 * The daily usage check (S10.2; architecture 8.5, 13.2). After the rollup, once a day: how full the database and the image store are.
 * It writes one structured line to Workers Logs (a `warn` line from 70%, which is what the Health banner also shows) and records that it
 * ran, so the owner's Health page can say when. Sizes only: no row, no name, no identifier. Nothing here wakes Neon more than the daily
 * rollup already does, and a failure here never stops the rollup (the caller runs it afterwards).
 *
 * GitHub's artifact storage cannot be read from the Worker (it would need a token stored as a secret); the weekly backup workflow checks it
 * itself and fails when it passes 70% (`.github/workflows/backup.yml`). Neon's compute hours are read in Neon's console (the Stage 0 probe
 * for a reporting API was never measured, so none is assumed).
 */
export async function runUsageCheck(db: Db, log: (line: string) => void = console.log): Promise<{ database: Usage; images: Usage } | null> {
  try {
    const snapshot = await usageSnapshot(db);
    const database = usageOf(snapshot.dbBytes, DATABASE_BUDGET_BYTES);
    const images = usageOf(snapshot.imageBytes, snapshot.imageBudgetBytes);
    log(usageLogLine(database, images));
    await recordJob(db, "usage", true, { databasePercent: Math.round(database.ratio * 100), imagePercent: Math.round(images.ratio * 100) });
    return { database, images };
  } catch (error) {
    // The class of the error only: a database message can carry connection details (architecture 13.4).
    console.error(JSON.stringify({ level: "error", job: "usage", error: error instanceof Error ? error.name : typeof error }));
    await recordJob(db, "usage", false).catch(() => undefined);
    return null;
  }
}
