import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import type { Role } from "@/server/auth/actor";

/**
 * The seven steps and the rules for moving a file between them (architecture 24.4, ADR-065, PRD_5 FR-42). Pure: no database, no clock of
 * its own, so the table is tested without either. `changeStage` and `moveBack` in `lead-admin.ts` call it before they write anything; it is
 * the one place that says who may move a file where.
 *
 * - A manager or an admin moves a file to the NEXT step.
 * - An admin may also skip ahead (to put right a missed step).
 * - Only an admin moves a file BACK, one step at a time, and must say why in a note.
 * - Nobody else moves anything.
 */

/**
 * Step 2 to step 3 needs the four required documents approved (and a passport when the university asks). Shipped off in S16.3, because
 * without documents the rule would block every file (review finding L4); switched on in S17.1, when the documents arrived.
 */
export const DOCUMENT_RULE_ENABLED = true;

/** The university has this many days to answer once the file is sent (PRD_5 FR-42). */
export const UNIVERSITY_CLOCK_DAYS = 3;
/** A student who has done nothing for this long is "gone quiet", and for this long the admin is offered to close the file (FR-48). */
export const QUIET_AFTER_DAYS = 14;
export const SUGGEST_CLOSE_AFTER_DAYS = 45;

const DAY_MS = 86_400_000;

export type StepCode = (typeof PIPELINE_STAGE_CODES)[number];

export function stepIndex(code: string): number {
  return (PIPELINE_STAGE_CODES as readonly string[]).indexOf(code);
}

export function isStepCode(code: string): code is StepCode {
  return stepIndex(code) >= 0;
}

export type MoveRefusal = "unknown_step" | "not_allowed" | "documents_missing" | "note_required";
export type MoveDecision = { ok: true; direction: "same" | "forward" | "back" } | { ok: false; reason: MoveRefusal };

export interface MoveInput {
  from: string;
  to: string;
  role: Role;
  /** Only read when the document rule is on. */
  documentsApproved?: boolean;
  /** Overrides `DOCUMENT_RULE_ENABLED`, so a test can try both states. */
  documentRule?: boolean;
  /** Required for a move back. */
  note?: string | null;
}

export function decideMove(input: MoveInput): MoveDecision {
  const from = stepIndex(input.from);
  const to = stepIndex(input.to);
  if (from < 0 || to < 0) return { ok: false, reason: "unknown_step" };
  if (input.role !== "manager" && input.role !== "admin") return { ok: false, reason: "not_allowed" };
  if (from === to) return { ok: true, direction: "same" };

  if (to > from) {
    if (input.role === "manager" && to !== from + 1) return { ok: false, reason: "not_allowed" };
    // The admin may skip ahead; a manager is held to the rule.
    if ((input.documentRule ?? DOCUMENT_RULE_ENABLED) && input.role === "manager" && input.from === "documents" && input.documentsApproved !== true) {
      return { ok: false, reason: "documents_missing" };
    }
    return { ok: true, direction: "forward" };
  }

  if (input.role !== "admin" || to !== from - 1) return { ok: false, reason: "not_allowed" };
  if (!input.note || input.note.trim() === "") return { ok: false, reason: "note_required" };
  return { ok: true, direction: "back" };
}

/** The step before this one, or null at the first. */
export function previousStep(code: string): StepCode | null {
  const i = stepIndex(code);
  return i > 0 ? (PIPELINE_STAGE_CODES[i - 1] ?? null) : null;
}

export type UniversityClock = { state: "none" } | { state: "running" | "overdue"; dueAt: Date };

/** The three-day clock of step 3. Overdue is computed on read, so nothing needs a job (architecture 24.4). */
export function universityClock(submittedAt: Date | null, stage: string, now: Date): UniversityClock {
  if (submittedAt === null || stage !== "university_review") return { state: "none" };
  const dueAt = new Date(submittedAt.getTime() + UNIVERSITY_CLOCK_DAYS * DAY_MS);
  return { state: now.getTime() > dueAt.getTime() ? "overdue" : "running", dueAt };
}

export type Quietness = "active" | "quiet" | "suggest_close";

/** Quiet and suggest-closing, computed on read from the last thing the student did. Only an open file can go quiet. */
export function quietness(lastStudentActivityAt: Date, status: string, now: Date): Quietness {
  if (status !== "open") return "active";
  const idleDays = (now.getTime() - lastStudentActivityAt.getTime()) / DAY_MS;
  if (idleDays >= SUGGEST_CLOSE_AFTER_DAYS) return "suggest_close";
  if (idleDays >= QUIET_AFTER_DAYS) return "quiet";
  return "active";
}
