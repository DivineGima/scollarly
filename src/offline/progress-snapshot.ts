import { offlineDb, type ProgressSnapshot } from "./db";

/**
 * The offline copy of the student portal (architecture 11.2, S8.1). It is NOT a cached page (`/me` is never cached, 11.1): it is
 * one small record, `{ user id, lead reference, stage code, last updated }`, so `/me` can show the last stage it knew when the phone
 * has no signal. It holds no name, no number and no email.
 *
 * One record at a time. It is deleted on sign-out, and replaced when a different user signs in on the same phone, so one student
 * never sees another's progress on a shared device. Every function swallows storage errors (some private windows have no
 * IndexedDB): the snapshot is a convenience, and `/me` works without it.
 */

/** Keeps `snapshot` as the only record: any other user's record is removed first. */
export async function saveProgressSnapshot(snapshot: ProgressSnapshot): Promise<void> {
  try {
    const db = await offlineDb();
    const tx = db.transaction("progressSnapshot", "readwrite");
    await tx.store.clear();
    await tx.store.put(snapshot);
    await tx.done;
  } catch {
    // No storage: nothing to show offline, nothing else lost.
  }
}

/** The kept record, or null when there is none. */
export async function readProgressSnapshot(): Promise<ProgressSnapshot | null> {
  try {
    const db = await offlineDb();
    return (await db.getAll("progressSnapshot"))[0] ?? null;
  } catch {
    return null;
  }
}

/** Sign-out, a different user, or a student with nothing linked: forget it. */
export async function clearProgressSnapshot(): Promise<void> {
  try {
    const db = await offlineDb();
    await db.clear("progressSnapshot");
  } catch {
    // Nothing to clear.
  }
}
