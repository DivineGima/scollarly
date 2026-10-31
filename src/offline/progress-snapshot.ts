import { offlineDb, type ProgressSnapshot } from "./db";

/**
 * The offline copy of the student app (architecture 11.2, 21.11; S8.1, S13.4). It is NOT a cached page: it is one small record so the
 * app can show what it last knew when the phone has no signal: the last stage (reference, stage code, date) and, since S13.4, the
 * first name and the course fields and level the student chose. It holds no full name, no number and no email.
 *
 * One record at a time. It is deleted on sign-out, and replaced when a different user signs in on the same phone, so one student
 * never sees another's progress or answers on a shared device. Every function swallows storage errors (some private windows have no
 * IndexedDB): the snapshot is a convenience, and the app works without it.
 */

/** The profile part of a snapshot, as the Home and Universities screens learn it. */
export interface ProfileSnapshotFields {
  firstName: string | null;
  courseFields: string[];
  level: string | null;
}

/** Whether the snapshot holds a stage to show (a student with no linked application has only profile fields). */
export function hasStage(snapshot: ProgressSnapshot): boolean {
  return snapshot.leadRef !== "";
}

const profileOf = (snapshot: ProgressSnapshot | undefined, userId: string): Partial<ProfileSnapshotFields> =>
  snapshot && snapshot.userId === userId
    ? { ...(snapshot.firstName !== undefined ? { firstName: snapshot.firstName } : {}), ...(snapshot.courseFields ? { courseFields: snapshot.courseFields } : {}), ...(snapshot.level !== undefined ? { level: snapshot.level } : {}) }
    : {};

/** Keeps `snapshot` as the only record: any other user's record is removed first. The same user's profile fields are kept. */
export async function saveProgressSnapshot(snapshot: ProgressSnapshot): Promise<void> {
  try {
    const db = await offlineDb();
    const tx = db.transaction("progressSnapshot", "readwrite");
    const existing = (await tx.store.getAll())[0];
    await tx.store.clear();
    await tx.store.put({ ...profileOf(existing, snapshot.userId), ...snapshot });
    await tx.done;
  } catch {
    // No storage: nothing to show offline, nothing else lost.
  }
}

/** Adds the profile fields to this user's record (creating a record with no stage if there is none); another user's record is removed. */
export async function saveProfileSnapshot(userId: string, fields: ProfileSnapshotFields, now: number = Date.now()): Promise<void> {
  try {
    const db = await offlineDb();
    const tx = db.transaction("progressSnapshot", "readwrite");
    const existing = (await tx.store.getAll())[0];
    await tx.store.clear();
    const base: ProgressSnapshot = existing && existing.userId === userId ? existing : { userId, leadRef: "", stageCode: "", updatedAt: now };
    await tx.store.put({ ...base, ...fields });
    await tx.done;
  } catch {
    // No storage.
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

/** A student with nothing linked: forget the stage but keep what they chose. With nothing else to keep, the record goes. */
export async function clearStageFromSnapshot(userId: string): Promise<void> {
  try {
    const db = await offlineDb();
    const tx = db.transaction("progressSnapshot", "readwrite");
    const existing = (await tx.store.getAll())[0];
    await tx.store.clear();
    if (existing && existing.userId === userId && (existing.courseFields?.length || existing.firstName)) {
      await tx.store.put({ ...existing, leadRef: "", stageCode: "" });
    }
    await tx.done;
  } catch {
    // Nothing to clear.
  }
}

/** Sign-out, erasure: forget all of it. */
export async function clearProgressSnapshot(): Promise<void> {
  try {
    const db = await offlineDb();
    await db.clear("progressSnapshot");
  } catch {
    // Nothing to clear.
  }
}
