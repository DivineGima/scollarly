import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S13.9 traceability: every functional requirement of version 2 (FR-19 to FR-32, PRD_2) is mapped to the tests that prove it. Each entry names
 * a test file and a piece of a test title that must still exist in it, so deleting or renaming a test fails here instead of leaving a quiet
 * gap (the same idea as `flow-coverage.test.ts`). What each test proves is read in the test; this file only keeps the map honest. The table
 * in `tracker/tracker_2.md` is written from this map.
 *
 * A requirement that has no test yet goes in `PENDING` with its reason; the test below fails if one is both pending and mapped, or neither.
 */

const U = "tests/unit";
const I = "tests/integration";
const E = "tests/e2e";

const MAP: Record<string, { file: string; title: string }[]> = {
  "FR-19": [
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "shows an admin the four tabs and a More sheet" },
    { file: `${E}/s13-4-student-app.spec.ts`, title: "shows the four student tabs and the More button" },
    { file: `${U}/s13-foundations.test.ts`, title: "never offers an admin an owner-only row" },
    { file: `${I}/s13-6-admin-hubs.test.ts`, title: "refuses a student, and a signed-out caller" },
  ],
  "FR-20": [
    { file: `${U}/s13-foundations.test.ts`, title: "the legacy admin addresses" },
    { file: `${U}/s13-6-admin-hubs.test.ts`, title: "moves each to the section that took its place" },
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "Leads opens the Inbox, with the list, the link requests" },
  ],
  "FR-21": [
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "shows three steps once" },
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "the pages that are reached from More say what they are for" },
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "says what to do when nothing has happened" },
  ],
  "FR-22": [
    { file: `${E}/s13-7-landing.spec.ts`, title: "the finder lists the right universities" },
    { file: `${E}/s13-7-landing.spec.ts`, title: "axe finds no WCAG 2.1 A or AA violation" },
    { file: `${E}/s13-7-landing.spec.ts`, title: "the landing page shows no team bios" },
    { file: `${U}/s13-7-landing.test.ts`, title: "the universities for one course" },
  ],
  "FR-23": [
    { file: `${U}/s13-2-sign-up.test.ts`, title: "has no endpoint that says whether an email has an account" },
    { file: `${I}/s13-2-sign-up.test.ts`, title: "shows the confirm screen and confirms nothing" },
    { file: `${I}/s13-2-sign-up.test.ts`, title: "refuses everything but account/confirm" },
    { file: `${E}/s13-2-sign-up.spec.ts`, title: "is not served to someone who is signed out" },
  ],
  "FR-24": [
    // Changed by PRD_4 (S15.2): onboarding saves the profile once and makes no lead; the application is FR-34.
    { file: `${I}/s13-3-onboarding.test.ts`, title: "answers the same request again with 200 and writes nothing more" },
    { file: `${I}/s13-3-onboarding.test.ts`, title: "lets a second device carry on" },
    { file: `${I}/s13-3-onboarding.test.ts`, title: "shows two leads from one number to admins as a duplicate, never merged" },
    { file: `${E}/s13-3-onboarding.spec.ts`, title: "offline: saves on the phone, then sends exactly once" },
  ],
  "FR-25": [
    { file: `${I}/s13-3-onboarding.test.ts`, title: "with the parent's own name and number, and the relationship" },
    { file: `${I}/s13-3-onboarding.test.ts`, title: "refuses a staff account: only a student-role account has an onboarding" },
  ],
  "FR-26": [
    { file: `${U}/s13-4-student-app.test.ts`, title: "treats several chosen courses" },
    { file: `${U}/s13-4-student-app.test.ts`, title: "never keeps anything else signed-in" },
    { file: `${I}/s13-4-student-app.test.ts`, title: "returns the student's own answers and first name only" },
    { file: `${E}/s13-4-student-app.spec.ts`, title: "starts with the student's own courses ticked" },
  ],
  "FR-27": [
    { file: `${U}/s13-5-notifications.test.ts`, title: "is unread again the next day" },
    { file: `${I}/s13-5-notifications.test.ts`, title: "marks all read without losing the list" },
    { file: `${E}/s13-5-notifications.spec.ts`, title: "Mark all read clears" },
  ],
  "FR-28": [
    { file: `${U}/s13-6-admin-hubs.test.ts`, title: "gives an admin their working numbers" },
    { file: `${I}/s13-6-admin-hubs.test.ts`, title: "gives an admin no payment and no onboarding number" },
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "gives the owner the owner's four tiles" },
  ],
  "FR-29": [
    { file: `${E}/s13-6-admin-hubs.spec.ts`, title: "keeps the numbers and the chart, never a lead reference" },
    { file: `${E}/s13-4-student-app.spec.ts`, title: "keeps the first name, the courses and the stage" },
    { file: `${E}/s13-4-student-app.spec.ts`, title: "sign-out forgets the copy on the phone" },
    { file: `${E}/s13-4-student-app.spec.ts`, title: "a different student signing in on the same phone sees nothing of the first" },
  ],
  "FR-30": [
    { file: `${U}/s13-7-brand.test.ts`, title: "is one path in black for the website and the same path in white for dark backgrounds" },
    { file: `${U}/s13-7-brand.test.ts`, title: "keeps the whole mark inside the maskable icon's safe zone" },
    { file: `${U}/s13-7-brand.test.ts`, title: "launches on the brand blue" },
    { file: `${U}/s13-7-brand.test.ts`, title: "shows the black logo in the site header" },
  ],
  "FR-31": [
    { file: `${E}/s13-7-landing.spec.ts`, title: "a course no university lists says so and points to Create an account" },
    { file: `${U}/s13-foundations.test.ts`, title: "files every programme in the real seed under a field and a level" },
  ],
  "FR-32": [
    { file: `${U}/s13-foundations.test.ts`, title: "has the same keys in English and French" },
    { file: `${U}/s13-3-onboarding.test.ts`, title: "has a title for every screen" },
    { file: `${U}/s13-7-landing.test.ts`, title: "English and French have the same finder keys" },
  ],
};

/** Requirements with no test yet, and why. Each must be on the owner's or Claude Code's list in the tracker, never silently skipped. None today. */
const PENDING: Record<string, string> = {};

const REQUIRED = Array.from({ length: 14 }, (_, i) => `FR-${19 + i}`);

describe("every functional requirement of version 2 is traced to tests (S13.9)", () => {
  it("covers FR-19 to FR-32 exactly once, as mapped or as pending with a reason", () => {
    const mapped = Object.keys(MAP);
    const pending = Object.keys(PENDING);
    expect([...mapped, ...pending].sort()).toEqual([...REQUIRED].sort());
    for (const reason of Object.values(PENDING)) expect(reason.length).toBeGreaterThan(20);
  });

  it("names at least one test for each mapped requirement", () => {
    for (const [fr, tests] of Object.entries(MAP)) expect(tests.length, fr).toBeGreaterThan(0);
  });

  for (const [fr, tests] of Object.entries(MAP)) {
    for (const { file, title } of tests) {
      it(`${fr}: "${title}" still exists in ${file}`, () => {
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(readFileSync(file, "utf8").includes(title), `no test title containing "${title}" in ${file}`).toBe(true);
      });
    }
  }
});
