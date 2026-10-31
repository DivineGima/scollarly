import { randomUuid } from "@/lib/uuid";
import { generateRef } from "@/lib/ref";
import { emptyValues, type OnboardingValues } from "@/modules/onboarding/payload";
import type { ProfileRelationship } from "@/lib/constants";
import type { CourseField } from "@/lib/courses";
import { offlineDb, type OnboardingDraft } from "./db";
import { listLeads, removeLead } from "./lead-queue";

/**
 * The questionnaire's draft on the phone (architecture 21.6, ADR-047): the answers so far, the screen the person was on, and the
 * idempotency key and reference made once when the draft starts. Nothing is sent until the last screen. One record per signed-in
 * person; it is deleted after a successful send and on sign-out, so one person never sees another's answers on a shared phone.
 * Every function swallows storage errors (some private windows have no IndexedDB): the questionnaire then simply works without a draft.
 */

export function newDraft(userId: string, relationship: ProfileRelationship, course: CourseField | null, now: number = Date.now()): OnboardingDraft {
  return { userId, values: emptyValues(relationship, course), step: "", key: randomUuid(), ref: generateRef(), updatedAt: now };
}

export async function readDraft(userId: string): Promise<OnboardingDraft | null> {
  try {
    const db = await offlineDb();
    return (await db.get("onboardingDraft", userId)) ?? null;
  } catch {
    return null;
  }
}

/** Keeps `draft` as the only record, so another person's draft on the same phone is removed. Returns false when nothing could be saved. */
export async function saveDraft(draft: OnboardingDraft): Promise<boolean> {
  try {
    const db = await offlineDb();
    const tx = db.transaction("onboardingDraft", "readwrite");
    await tx.store.clear();
    await tx.store.put(draft);
    await tx.done;
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    const db = await offlineDb();
    await db.clear("onboardingDraft");
  } catch {
    // Nothing to clear.
  }
}

/** Sign-out and erasure: forget the draft and any finished-but-unsent questionnaire, so the next person on this phone cannot send it as themselves. */
export async function clearOnboardingOnDevice(): Promise<void> {
  await clearDraft();
  try {
    for (const item of await listLeads()) if (item.kind === "onboarding") await removeLead(item.key);
  } catch {
    // No storage: nothing was kept.
  }
}

export type { OnboardingValues };
