/**
 * The daily purge of student files (S17.3; architecture 24.7, ADR-068, PRD_5 FR-49). It is a step of its own in the daily job, with its own record,
 * so a failure here never blocks the rollup. The rule (who is purgeable) is in the database (migration 0025); this file only carries it out:
 *
 *  - at most `PURGE_LIMIT` objects a run, because the free plan allows about 50 outbound requests per invocation (one delete each, one call for the
 *    batch of candidates, one to mark them), and the rest go the next day;
 *  - an object is deleted first and its row marked after, in one call for the batch; a delete that fails leaves its row for the next run, so the
 *    whole run can be repeated without harm (idempotent), and deleting an object that is already gone is not an error.
 */

export const PURGE_LIMIT = 40;

export interface PurgeDeps {
  candidates: (limit: number) => Promise<{ id: string; key: string }[]>;
  deleteObject: (key: string) => Promise<void>;
  /** Marks the rows purged; returns how many the database accepted. */
  markPurged: (ids: string[]) => Promise<number>;
}

export interface PurgeResult {
  found: number;
  deleted: number;
  marked: number;
  failed: number;
}

export async function runPurge(deps: PurgeDeps, limit: number = PURGE_LIMIT): Promise<PurgeResult> {
  const batch = await deps.candidates(Math.min(limit, PURGE_LIMIT));
  const deletedIds: string[] = [];
  let failed = 0;
  for (const item of batch) {
    try {
      await deps.deleteObject(item.key);
      deletedIds.push(item.id);
    } catch {
      failed += 1; // the row stays; tomorrow's run tries again
    }
  }
  // The deleted objects are gone whatever happens next, so a failure to mark them is thrown: the run is recorded as failed and tomorrow's run
  // finds the same rows (their objects are already gone, which a delete does not mind).
  const marked = await deps.markPurged(deletedIds);
  return { found: batch.length, deleted: deletedIds.length, marked, failed };
}

/**
 * Deletes the objects of an erased student (FR-49). The keys are read BEFORE the erasure (afterwards the rows no longer hold them) and the objects
 * are deleted AFTER it succeeds, so an erasure that is refused (identity not confirmed, sign-in too old) never costs a student their files. Each
 * delete is tried twice. Returns how many could not be deleted, so the caller can say so in its log (counts only, never a key).
 */
export async function deleteAfterErasure(deleteObject: (key: string) => Promise<void>, keys: readonly string[]): Promise<number> {
  let failed = 0;
  for (const key of keys) {
    try {
      await deleteObject(key);
    } catch {
      try {
        await deleteObject(key);
      } catch {
        failed += 1;
      }
    }
  }
  return failed;
}
