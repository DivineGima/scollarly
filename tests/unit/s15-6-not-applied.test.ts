import { describe, expect, it } from "vitest";
import { firstNameAndInitial, notAppliedItem } from "@/modules/leads/not-applied";
import { funnelFromStages, ONBOARDED_STEP, withOnboardedStep } from "@/modules/crm/metrics";

/** S15.6 (PRD_4 F27, FR-38; architecture 23.6): the pure rules of the "Not applied yet" list and the onboarded funnel step. */

describe("firstNameAndInitial", () => {
  it("keeps a first name and the first letter of the last word", () => {
    expect(firstNameAndInitial("Amina Nkeng Fon")).toBe("Amina F.");
    expect(firstNameAndInitial("  Kofi   mensah ")).toBe("Kofi M.");
  });

  it("keeps a one-word name whole and gives an empty name nothing", () => {
    expect(firstNameAndInitial("Kofi")).toBe("Kofi");
    expect(firstNameAndInitial("   ")).toBe("");
  });

  it("takes a whole character as the initial, not half of one", () => {
    expect(firstNameAndInitial("Zoe Élodie")).toBe("Zoe É.");
  });
});

describe("notAppliedItem", () => {
  it("never carries the full name, and sends the time as a UTC instant", () => {
    const item = notAppliedItem({ userId: "u1", applicantName: "Amina Nkeng Fon", country: "CM", courseFields: ["law"], onboardedAt: new Date("2026-11-01T10:00:00Z"), whatsappE164: "+237612345678" });
    expect(item).toEqual({ id: "u1", name: "Amina F.", country: "CM", courseFields: ["law"], onboardedAt: "2026-11-01T10:00:00.000Z", whatsapp: "+237612345678" });
    expect(JSON.stringify(item)).not.toContain("Nkeng");
  });
});

describe("withOnboardedStep", () => {
  const steps = funnelFromStages([
    { code: "new", position: 1, count: 4 },
    { code: "contacted", position: 2, count: 2 },
  ]);

  it("puts the onboarded step first and leaves the stage steps as they were", () => {
    const funnel = withOnboardedStep(steps, 10);
    expect(funnel[0]).toEqual({ code: ONBOARDED_STEP, reached: 10, ofAll: null, ofPrevious: null });
    expect(funnel.slice(1)).toEqual(steps);
  });

  it("leaves the funnel alone when a filter a profile does not have is set", () => {
    expect(withOnboardedStep(steps, null)).toEqual(steps);
  });

  it("shows a zero when nobody finished a profile in the range", () => {
    expect(withOnboardedStep(steps, 0)[0]?.reached).toBe(0);
  });
});
