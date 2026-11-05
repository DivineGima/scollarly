import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S14.8 traceability: every requirement of version 3 (PRD_3: F15 amended, F18 amended, F20 to F23, and the removal of fees) is mapped to the
 * tests that prove it. Each entry names a test file and a piece of a test title that must still exist in it, so deleting or renaming a test
 * fails here instead of leaving a quiet gap (the same idea as `s13-9-traceability.test.ts`). The table in `tracker/tracker_3.md` is written
 * from this map. F30 (the staff password lock) is mapped too, because it is a decision about the same sign-in surface.
 */

const U = "tests/unit";
const I = "tests/integration";
const E = "tests/e2e";

const MAP: Record<string, { file: string; title: string }[]> = {
  "F15 amended (onboarding first)": [
    { file: `${U}/s14-5-onboarding-first.test.ts`, title: "refuses every data call except the questionnaire's own with 403 ONBOARDING_REQUIRED" },
    { file: `${U}/s14-5-onboarding-first.test.ts`, title: "sends any other screen to the questionnaire and serves only the questionnaire's own shell" },
    { file: `${U}/s14-5-onboarding-first.test.ts`, title: "changes nothing for a student who has finished, for staff, or for the admin area" },
  ],
  "F18 amended (CRM charts, metrics, pipeline, filters, export)": [
    { file: `${U}/s14-7-crm.test.ts`, title: "builds the funnel from current stages" },
    { file: `${U}/s14-7-crm.test.ts`, title: "quotes commas, quotes and line breaks, and defuses a formula" },
    { file: `${I}/s14-7-crm.test.ts`, title: "answers the overview with percentages, a funnel and the filters echoed" },
    { file: `${I}/s14-7-crm.test.ts`, title: "has a column per stage with the total and the newest cards" },
    { file: `${I}/s14-7-crm.test.ts`, title: "holds references and timing only, newest first, and no name, number or email" },
    { file: `${E}/s14-7-crm.spec.ts`, title: "moves a lead with the Move to list" },
  ],
  "F20 (account-first actions)": [
    { file: `${U}/s14-3-lead-lock.test.ts`, title: "refuses a request with no session cookie, before any database call" },
    { file: `${U}/s14-3-lead-lock.test.ts`, title: "refuses an account that has not been confirmed" },
    { file: `${E}/s14-3-gate.spec.ts`, title: "every public page stays readable and offers Create an account" },
    { file: `${E}/s14-3-gate.spec.ts`, title: "the Contact page still shows the WhatsApp number as text to copy, but no chat link" },
    { file: `${U}/s14-3-gate.test.ts`, title: "the old Apply address" },
  ],
  "F21 (email and password)": [
    { file: `${U}/s14-4-password.test.ts`, title: "checks the password length, repeats and the email's own name" },
    { file: `${U}/s14-4-password.test.ts`, title: "limits one email address however many callers try it" },
    { file: `${U}/s14-4-password.test.ts`, title: "answers the same way for a wrong password and an unknown email" },
    { file: `${U}/s14-review-fixes.test.ts`, title: "trusts a verified email for any role and an unverified email for a student only" },
    { file: `${I}/f30-staff-no-password.test.ts`, title: "refuses a %s whose account also has a password login" },
    { file: `${E}/s14-4-email-sign-in.spec.ts`, title: "sign-up asks for a name, an email and a password of at least 8 characters" },
  ],
  "F22 (real campus tours)": [
    { file: `${U}/s14-6-tours.test.ts`, title: "has one valid, unique video id per university" },
    { file: `${U}/s14-6-tours.test.ts`, title: "allows a 360 tour only on a listed host" },
    { file: `${U}/s14-6-tours.test.ts`, title: "has no 'available on request' text and no WhatsApp fallback" },
  ],
  "F23 (Privacy and Terms)": [
    { file: `${U}/s14-2-legal.test.ts`, title: "covers what Google asks of a published app" },
    { file: `${U}/s14-2-legal.test.ts`, title: "does not claim a legal review or an unconfirmed number" },
  ],
  "Fees removed everywhere": [
    { file: `${U}/s14-1-quick-fixes.test.ts`, title: "moves /fees to /universities" },
    { file: `${U}/s14-1-quick-fixes.test.ts`, title: "has no fee wording left in the public messages" },
    { file: `${U}/s14-1-quick-fixes.test.ts`, title: "drops 'Free for students' from the footer tagline only" },
  ],
};

describe("S14.8: every version 3 requirement is covered by a test that still exists", () => {
  for (const [requirement, tests] of Object.entries(MAP)) {
    it(`${requirement}: ${tests.length} proving test(s) exist`, () => {
      expect(tests.length).toBeGreaterThan(0);
      for (const { file, title } of tests) {
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(readFileSync(file, "utf8"), `${file} no longer has a test titled "${title}"`).toContain(title);
      }
    });
  }
});
