import { describe, expect, it } from "vitest";
import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import {
  decideMove,
  DOCUMENT_RULE_ENABLED,
  previousStep,
  quietness,
  QUIET_AFTER_DAYS,
  stepIndex,
  SUGGEST_CLOSE_AFTER_DAYS,
  UNIVERSITY_CLOCK_DAYS,
  universityClock,
} from "@/modules/pipeline/steps";

const DAY = 86_400_000;
const NOW = new Date("2026-11-07T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("the seven steps (architecture 24.4)", () => {
  it("are the owner's seven, in order", () => {
    expect(PIPELINE_STAGE_CODES).toEqual(["course_interest", "documents", "university_review", "offer_letter", "registration", "visa", "arrived"]);
    expect(stepIndex("registration")).toBe(4);
    expect(stepIndex("nope")).toBe(-1);
  });

  it("has the document rule switched on (S17.1)", () => {
    expect(DOCUMENT_RULE_ENABLED).toBe(true);
  });
});

describe("the document rule (step 2 to step 3)", () => {
  const move = { from: "documents", to: "university_review" } as const;

  it("holds a manager back until the documents are approved", () => {
    expect(decideMove({ ...move, role: "manager" })).toEqual({ ok: false, reason: "documents_missing" });
    expect(decideMove({ ...move, role: "manager", documentsApproved: false })).toEqual({ ok: false, reason: "documents_missing" });
    expect(decideMove({ ...move, role: "manager", documentsApproved: true })).toEqual({ ok: true, direction: "forward" });
  });

  it("does not hold an admin, who may put a file right", () => {
    expect(decideMove({ ...move, role: "admin" })).toEqual({ ok: true, direction: "forward" });
  });

  it("does not apply to any other step", () => {
    expect(decideMove({ from: "course_interest", to: "documents", role: "manager" })).toEqual({ ok: true, direction: "forward" });
  });

  it("can be switched off for a test, and then lets the manager through", () => {
    expect(decideMove({ ...move, role: "manager", documentRule: false })).toEqual({ ok: true, direction: "forward" });
  });
});

describe("decideMove", () => {
  it("lets a manager and an admin move one step forward", () => {
    for (const role of ["manager", "admin"] as const) {
      expect(decideMove({ from: "course_interest", to: "documents", role })).toEqual({ ok: true, direction: "forward" });
      expect(decideMove({ from: "visa", to: "arrived", role })).toEqual({ ok: true, direction: "forward" });
    }
  });

  it("refuses a manager who skips a step, and lets an admin do it", () => {
    expect(decideMove({ from: "course_interest", to: "offer_letter", role: "manager" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(decideMove({ from: "course_interest", to: "offer_letter", role: "admin" })).toEqual({ ok: true, direction: "forward" });
  });

  it("refuses a student and anyone who is not staff", () => {
    expect(decideMove({ from: "course_interest", to: "documents", role: "student" })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("calls the same step 'same' and an unknown step unknown", () => {
    expect(decideMove({ from: "visa", to: "visa", role: "manager" })).toEqual({ ok: true, direction: "same" });
    expect(decideMove({ from: "visa", to: "nope", role: "admin" })).toEqual({ ok: false, reason: "unknown_step" });
    expect(decideMove({ from: "nope", to: "visa", role: "admin" })).toEqual({ ok: false, reason: "unknown_step" });
  });

  it("lets only an admin go back, one step, and only with a note", () => {
    expect(decideMove({ from: "registration", to: "offer_letter", role: "manager", note: "wrong tap" })).toEqual({ ok: false, reason: "not_allowed" });
    expect(decideMove({ from: "registration", to: "offer_letter", role: "admin" })).toEqual({ ok: false, reason: "note_required" });
    expect(decideMove({ from: "registration", to: "offer_letter", role: "admin", note: "   " })).toEqual({ ok: false, reason: "note_required" });
    expect(decideMove({ from: "registration", to: "offer_letter", role: "admin", note: "wrong tap" })).toEqual({ ok: true, direction: "back" });
    expect(decideMove({ from: "registration", to: "documents", role: "admin", note: "two steps" })).toEqual({ ok: false, reason: "not_allowed" });
  });

  it("finds the step before, and none before the first", () => {
    expect(previousStep("documents")).toBe("course_interest");
    expect(previousStep("arrived")).toBe("visa");
    expect(previousStep("course_interest")).toBeNull();
    expect(previousStep("nope")).toBeNull();
  });
});

describe("the three-day clock of step 3 (FR-42)", () => {
  it("does not run before the file is sent or after it has moved on", () => {
    expect(universityClock(null, "university_review", NOW)).toEqual({ state: "none" });
    expect(universityClock(days(1), "offer_letter", NOW)).toEqual({ state: "none" });
  });

  it("runs for three days, and is overdue after", () => {
    expect(UNIVERSITY_CLOCK_DAYS).toBe(3);
    expect(universityClock(days(1), "university_review", NOW).state).toBe("running");
    expect(universityClock(days(3), "university_review", NOW).state).toBe("running"); // exactly three days: not yet
    expect(universityClock(new Date(NOW.getTime() - 3 * DAY - 1), "university_review", NOW).state).toBe("overdue");
    expect(universityClock(days(5), "university_review", NOW).state).toBe("overdue");
  });
});

describe("quiet and suggest-closing (FR-48)", () => {
  it("uses the owner's 14 and 45 days, at the boundary", () => {
    expect(QUIET_AFTER_DAYS).toBe(14);
    expect(SUGGEST_CLOSE_AFTER_DAYS).toBe(45);
    expect(quietness(days(13.9), "open", NOW)).toBe("active");
    expect(quietness(days(14), "open", NOW)).toBe("quiet");
    expect(quietness(days(44.9), "open", NOW)).toBe("quiet");
    expect(quietness(days(45), "open", NOW)).toBe("suggest_close");
  });

  it("only an open file can go quiet", () => {
    expect(quietness(days(100), "closed", NOW)).toBe("active");
    expect(quietness(days(100), "arrived", NOW)).toBe("active");
  });
});
