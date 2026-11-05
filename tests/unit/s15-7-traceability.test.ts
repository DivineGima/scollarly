import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S15.7 traceability: every requirement of version 4 (PRD_4 FR-33 to FR-38) is mapped to the tests that prove it. Each entry names a test file and
 * a piece of a test title that must still exist in it, so deleting or renaming a test fails here instead of leaving a quiet gap (the same idea as
 * `s14-8-traceability.test.ts`). The table in `tracker/tracker_4.md` is written from this map.
 */

const U = "tests/unit";
const I = "tests/integration";
const E = "tests/e2e";

const MAP: Record<string, { file: string; title: string }[]> = {
  "FR-33 (onboarding makes a profile and no lead)": [
    { file: `${I}/s13-3-onboarding.test.ts`, title: "stores one profile and no lead" },
    { file: `${I}/s13-3-onboarding.test.ts`, title: "lets a second device carry on" },
  ],
  "FR-34 (one application per account, from the profile)": [
    { file: `${U}/s15-3-apply.test.ts`, title: "creates the application once" },
    { file: `${U}/s15-3-apply.test.ts`, title: "tells an account that already applied" },
    { file: `${I}/s15-3-apply.test.ts`, title: "makes one lead from the profile" },
    { file: `${I}/s15-3-apply.test.ts`, title: "answers the same request again with the same lead" },
    { file: `${I}/s15-3-apply.test.ts`, title: "refuses a second application with ALREADY_APPLIED" },
    { file: `${E}/s15-3-apply.spec.ts`, title: "offline: saves on the phone, then sends exactly once when the connection returns" },
  ],
  "FR-35 (no Apply form, quick WhatsApp form or chat link on a public page)": [
    { file: `${E}/s14-3-gate.spec.ts`, title: "every public page stays readable and offers Create an account" },
    { file: `${U}/s14-3-gate.test.ts`, title: "has no gate kinds left, and no public component imports a gate" },
  ],
  "FR-36 (My account, and the account address)": [
    { file: `${U}/s15-5-account.test.ts`, title: "sends a valid session to its home after one session read" },
    { file: `${U}/s15-5-account.test.ts`, title: "sends a request with no session cookie to /sign-in without any lookup" },
    { file: `${U}/s15-5-account.test.ts`, title: "forwards a valid session to its home" },
    { file: `${E}/s15-5-account.spec.ts`, title: "a browser with the signed-in hint sees My account in the header, the page and the footer" },
    { file: `${E}/s15-5-account.spec.ts`, title: "a visitor with no hint sees Sign in and Create an account" },
  ],
  "FR-37 (signed-in WhatsApp, no lead made by a chat)": [
    { file: `${E}/s13-4-student-app.spec.ts`, title: "links the public guides and the WhatsApp button, with no data call" },
    { file: `${U}/lib-ref-whatsapp.test.ts`, title: "builds the link from the configured number" },
  ],
  "FR-38 (the Not applied yet list, apart from Leads)": [
    { file: `${I}/s15-6-not-applied.test.ts`, title: "lists the profiles with no lead, newest first" },
    { file: `${I}/s15-6-not-applied.test.ts`, title: "does not change a lead count or the response clock" },
    { file: `${I}/s15-6-not-applied.test.ts`, title: "adds onboarded, applied of onboarded and the first funnel step" },
    { file: `${U}/s15-6-not-applied.test.ts`, title: "keeps a first name and the first letter of the last word" },
    { file: `${E}/s15-6-not-applied.spec.ts`, title: "lists the students with a WhatsApp link" },
  ],
};

describe("S15.7: every version 4 requirement is covered by a test that still exists", () => {
  for (const [requirement, tests] of Object.entries(MAP)) {
    it(`${requirement}: ${tests.length} proving test(s) exist`, () => {
      expect(tests.length).toBeGreaterThan(0);
      for (const { file, title } of tests) {
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(readFileSync(file, "utf8"), `${file} no longer has a test titled "${title}"`).toContain(title);
      }
    });
  }

  it("maps exactly FR-33 to FR-38, the requirements PRD_4 adds", () => {
    const prd = readFileSync("prd/PRD_4.md", "utf8");
    const inPrd = [...new Set([...prd.matchAll(/^\| (FR-3[3-9]|FR-[4-9]\d) \|/gm)].map((m) => m[1]))];
    const mapped = Object.keys(MAP).map((key) => key.split(" ")[0]);
    expect(mapped).toEqual(["FR-33", "FR-34", "FR-35", "FR-36", "FR-37", "FR-38"]);
    expect(inPrd).toEqual(mapped);
  });
});
