import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S11.2: every click flow of architecture section 16 (Parts A, B and C) has an end-to-end test. The headings are read from the current
 * `system_architecture_N.md`, so a flow added to the document without a test fails here. Each flow names the spec file and a piece of a
 * test or describe title that must still exist in it, so renaming or deleting the test also fails here instead of leaving a quiet gap.
 * What each test proves is read in the spec; this file only keeps the map honest.
 */

const E2E = "tests/e2e";
const map: Record<string, { file: string; title: string }[]> = {
  A1: [{ file: "stage3-public.spec.ts", title: "home shows the confirmed figure and testimonial" }],
  A2: [{ file: "stage3-public.spec.ts", title: "A2: the universities list" }],
  A3: [{ file: "stage3-public.spec.ts", title: "FR-3: nothing loads before a tap" }, { file: "stage3-public.spec.ts", title: "a university that does not exist is a 404" }],
  A4: [{ file: "stage3-public.spec.ts", title: "FR-2: fees" }, { file: "stage3-public.spec.ts", title: "FR-1: with JavaScript off, every public page shows its main content" }],
  A5: [{ file: "stage4-leads.spec.ts", title: "the full application (A5)" }],
  A5b: [{ file: "stage4-leads.spec.ts", title: "the quick WhatsApp form (A5b, ADR-030)" }],
  A6: [{ file: "stage3-public.spec.ts", title: '"/contact": ["+14155550100"' }],
  A7: [{ file: "stage3-public.spec.ts", title: "A7: a post cannot inject markup" }],
  A8: [{ file: "offline.spec.ts", title: "service worker and offline page (S0.8)" }, { file: "stage3-public.spec.ts", title: '"/privacy"' }],
  A9: [{ file: "stage2-auth.spec.ts", title: "A9 sign in" }],
  A10: [{ file: "stage2-auth.spec.ts", title: "A10 sign out" }],
  A11: [{ file: "stage6-8.spec.ts", title: "A11 /me progress" }],
  A12: [{ file: "stage6-8.spec.ts", title: "A12 link my application" }],
  A13: [{ file: "stage6-8.spec.ts", title: "A13 profile and my data" }],
  B0: [{ file: "stage2-auth.spec.ts", title: "B0 accept an invite" }],
  B1: [{ file: "stage5-leads.spec.ts", title: "B1 Overview" }],
  B2: [{ file: "stage5-leads.spec.ts", title: "B2 Leads list" }],
  B3: [{ file: "stage5-leads.spec.ts", title: "B3 Lead detail" }],
  B4: [{ file: "stage5-leads.spec.ts", title: "B4 Link requests" }],
  B5: [{ file: "stage5-leads.spec.ts", title: "B5 Data requests" }],
  B6: [{ file: "stage6-8.spec.ts", title: "B6 the standard content flow" }, { file: "stage6-8.spec.ts", title: "B6 the content hub and lists" }],
  B7: [{ file: "stage6-8.spec.ts", title: "B6 step 4 and B7: images" }],
  B8: [{ file: "stage6-8.spec.ts", title: "B8 stale content" }],
  B9: [{ file: "stage9-11.spec.ts", title: "B9 payments" }],
  B10: [{ file: "stage6-8.spec.ts", title: "B10 analytics" }, { file: "stage9-11.spec.ts", title: "S9.3 payments in analytics" }],
  B11: [{ file: "stage2-auth.spec.ts", title: "B11: saves the name and signs out other devices" }],
  C0: [{ file: "stage2-auth.spec.ts", title: "C0 first sign-in as owner: enrol two-factor" }],
  C1: [{ file: "stage2-auth.spec.ts", title: "C1 later sign-ins: the code prompt" }],
  C2: [{ file: "stage2-auth.spec.ts", title: "C2 team" }],
  C3: [{ file: "stage9-11.spec.ts", title: "C3 every admin's performance" }],
  C4: [{ file: "stage9-11.spec.ts", title: "C4 settings" }],
  C5: [{ file: "stage2-auth.spec.ts", title: "C5 audit log" }],
  C6: [{ file: "stage2-auth.spec.ts", title: "C6 security" }],
  C7: [{ file: "stage9-11.spec.ts", title: "C7 health" }],
};

function flowsInArchitecture(): string[] {
  const text = readFileSync("system_architecture/system_architecture_1.md", "utf8");
  const section = text.slice(text.indexOf("## 16. Page and click map"), text.indexOf("## 17. Phase 0"));
  return [...section.matchAll(/^#### ([ABC]\d+b?)\./gm)].map((m) => m[1] as string);
}

describe("S11.2: every click flow of section 16 has an end-to-end test", () => {
  const flows = flowsInArchitecture();

  it("finds the flows of all three parts in the architecture", () => {
    expect(flows.length).toBeGreaterThanOrEqual(34);
    expect(flows.filter((f) => f.startsWith("A")).length).toBeGreaterThanOrEqual(14);
    expect(flows.filter((f) => f.startsWith("B")).length).toBeGreaterThanOrEqual(12);
    expect(flows.filter((f) => f.startsWith("C")).length).toBeGreaterThanOrEqual(8);
  });

  it("maps every flow, and maps nothing that is not a flow", () => {
    expect(flows.filter((f) => !(f in map))).toEqual([]);
    expect(Object.keys(map).filter((f) => !flows.includes(f))).toEqual([]);
  });

  it.each(Object.entries(map))("%s is proven by a test that still exists", (_flow, proofs) => {
    expect(proofs.length).toBeGreaterThan(0);
    for (const { file, title } of proofs) {
      const source = readFileSync(`${E2E}/${file}`, "utf8");
      expect(source.includes(title), `${file} should contain "${title}"`).toBe(true);
    }
  });
});

/**
 * Version 2 (S13.6, architecture 21.17): the click flows of the refactor. Same rule as above: the headings are read from the current
 * architecture, so a flow added to it without a test fails here, and a renamed or deleted test fails here instead of leaving a quiet gap.
 * Part D (the landing page) joins in S13.7.
 */
const mapV2: Record<string, { file: string; title: string }[]> = {
  "A2.1": [{ file: "s13-2-sign-up.spec.ts", title: "Create account" }],
  "A2.2": [{ file: "s13-3-onboarding.spec.ts", title: "a student" }, { file: "s13-3-onboarding.spec.ts", title: "a parent" }],
  "A2.3": [
    { file: "s13-4-student-app.spec.ts", title: "the floating bar" },
    { file: "s13-4-student-app.spec.ts", title: "Home" },
    { file: "s13-4-student-app.spec.ts", title: "Universities" },
    { file: "s13-4-student-app.spec.ts", title: "Help" },
  ],
  "A2.4": [{ file: "s13-5-notifications.spec.ts", title: "the student's Notifications" }],
  "B2.1": [{ file: "s13-6-admin-hubs.spec.ts", title: "B2.1 Home" }, { file: "s13-6-admin-hubs.spec.ts", title: "the first-visit tour" }],
  "B2.2": [{ file: "s13-6-admin-hubs.spec.ts", title: "B2.2 to B2.4 the hubs" }],
  "B2.3": [{ file: "s13-6-admin-hubs.spec.ts", title: "B2.2 to B2.4 the hubs" }],
  "B2.4": [{ file: "s13-6-admin-hubs.spec.ts", title: "B2.2 to B2.4 the hubs" }],
  "B2.5": [{ file: "s13-6-admin-hubs.spec.ts", title: "B2.5 the floating bar" }, { file: "s13-5-notifications.spec.ts", title: "staff Notifications" }],
};

function flowsInArchitecture2(): string[] {
  const text = readFileSync("system_architecture/system_architecture_2.md", "utf8");
  const section = text.slice(text.indexOf("### 21.17 Page and click map"), text.indexOf("#### Part D: Public"));
  return [...section.matchAll(/^##### ([AB]2\.\d)/gm)].map((m) => m[1] as string);
}

describe("S13.6: every click flow of the refactor (21.17) has an end-to-end test", () => {
  const flows = flowsInArchitecture2();

  it("finds the flows of both parts in the architecture", () => {
    expect(flows.filter((f) => f.startsWith("A2.")).length).toBe(4);
    expect(flows.filter((f) => f.startsWith("B2.")).length).toBe(5);
  });

  it("maps every flow, and maps nothing that is not a flow", () => {
    expect(flows.filter((f) => !(f in mapV2))).toEqual([]);
    expect(Object.keys(mapV2).filter((f) => !flows.includes(f))).toEqual([]);
  });

  it.each(Object.entries(mapV2))("%s is proven by a test that still exists", (_flow, proofs) => {
    expect(proofs.length).toBeGreaterThan(0);
    for (const { file, title } of proofs) {
      const source = readFileSync(`${E2E}/${file}`, "utf8");
      expect(source.includes(title), `${file} should contain "${title}"`).toBe(true);
    }
  });
});
