import { describe, expect, it } from "vitest";
import { ADMIN_ONLY_SECTIONS, INBOX_SECTIONS, isInboxSection, sectionsFor, totalNeedingAction, type InboxSection } from "@/modules/inbox/sections";
import { nextStep, previousStep } from "@/modules/pipeline/steps";

const counts = (over: Partial<Record<InboxSection, number>> = {}) =>
  ({ new: 0, to_review: 0, overdue: 0, letter_ready: 0, payment_proof: 0, quiet: 0, unassigned: 0, ...over }) as Record<InboxSection, number>;

describe("the Inbox sections (architecture 24.9)", () => {
  it("lists the six sections of FR-51 in the order of what needs action, and the Admin's Unassigned last", () => {
    expect(INBOX_SECTIONS).toEqual(["new", "to_review", "overdue", "letter_ready", "payment_proof", "quiet", "unassigned"]);
    expect(ADMIN_ONLY_SECTIONS).toEqual(["unassigned"]);
  });

  it("shows a manager every section except Unassigned, and the Admin all of them", () => {
    expect(sectionsFor("manager")).toEqual(["new", "to_review", "overdue", "letter_ready", "payment_proof", "quiet"]);
    expect(sectionsFor("admin")).toEqual(INBOX_SECTIONS);
  });

  it("counts only the sections the role sees in the daily summary", () => {
    const all = counts({ new: 2, to_review: 3, quiet: 1, unassigned: 4 });
    expect(totalNeedingAction(all, "manager")).toBe(6);
    expect(totalNeedingAction(all, "admin")).toBe(10);
    expect(totalNeedingAction(counts(), "admin")).toBe(0);
  });

  it("recognises a section name, and nothing else", () => {
    expect(isInboxSection("quiet")).toBe(true);
    expect(isInboxSection("")).toBe(false);
    expect(isInboxSection("__proto__")).toBe(false);
  });
});

describe("the Next step button's target", () => {
  it("is the step after this one, and none after the last or for an unknown step", () => {
    expect(nextStep("course_interest")).toBe("documents");
    expect(nextStep("visa")).toBe("arrived");
    expect(nextStep("arrived")).toBeNull();
    expect(nextStep("share_results")).toBeNull();
  });

  it("is the inverse of the step before", () => {
    for (const code of ["documents", "university_review", "offer_letter", "registration", "visa", "arrived"]) {
      const before = previousStep(code);
      expect(before && nextStep(before)).toBe(code);
    }
  });
});
