import { offlineDb, type DashboardSnapshot } from "./db";

/**
 * The staff's offline copy of Home (architecture 21.11, ADR-047): the tile numbers and the leads-per-day line, the period and when it was
 * last known. **No lead name, number, reference or email**: the Home's list of latest activity is never kept. One record at a time; it is
 * deleted on sign-out and replaced when a different person signs in on the same phone. The screen shows it with "Last updated" and no way
 * to change anything. Every function swallows storage errors (some private windows have no IndexedDB).
 */

export async function saveDashboardSnapshot(snapshot: DashboardSnapshot): Promise<void> {
  try {
    const db = await offlineDb();
    const tx = db.transaction("dashboardSnapshot", "readwrite");
    await tx.store.clear();
    await tx.store.put(snapshot);
    await tx.done;
  } catch {
    // No storage: nothing to show offline, nothing else lost.
  }
}

/** The kept copy for this person and period, or null. Another person's copy is never returned. */
export async function readDashboardSnapshot(userId: string, period: string): Promise<DashboardSnapshot | null> {
  try {
    const db = await offlineDb();
    const row = (await db.getAll("dashboardSnapshot"))[0];
    return row && row.userId === userId && row.period === period ? row : null;
  } catch {
    return null;
  }
}

export async function clearDashboardSnapshot(): Promise<void> {
  try {
    const db = await offlineDb();
    await db.clear("dashboardSnapshot");
  } catch {
    // Nothing to clear.
  }
}
