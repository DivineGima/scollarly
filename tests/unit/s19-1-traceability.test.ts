import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S19.1 traceability: every requirement of version 5 (PRD_5 FR-39 to FR-52) is mapped to the tests that prove it. Each entry names a test file and
 * a piece of a test title that must still exist in it, so deleting or renaming a test fails here instead of leaving a quiet gap (the same idea as
 * `s15-7-traceability.test.ts`). The table in `tracker/tracker_5.md` is written from this map.
 */

const U = "tests/unit";
const I = "tests/integration";
const E = "tests/e2e";

const MAP: Record<string, { file: string; title: string }[]> = {
  "FR-39 (roles: student, manager, admin; two admins; each sees only their own)": [
    { file: `${I}/s16-roles-admin-cap.test.ts`, title: "a second admin is allowed, a third is refused" },
    { file: `${I}/rls-policies.test.ts`, title: "the admin sees every lead; a manager sees only their own" },
    { file: `${I}/rls-policies.test.ts`, title: "a manager cannot change, annotate or reassign a lead that is not theirs" },
    { file: `${I}/s17-1-documents.test.ts`, title: "a student does not see another student" },
    { file: `${I}/s17-1-documents.test.ts`, title: "a manager of another student cannot see, review or open the file" },
  ],
  "FR-40 (assignment in turn, away skip, nobody available, reassign, a leaving manager)": [
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "gives each new student the next manager in turn, skips a manager who is away" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "two sign-ups at the same moment take turns" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "with nobody available the student has no manager, and only an admin can see them" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "only an admin moves a student, and only to a manager" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "removing a manager gives their students back to the admin and ends their sessions" },
    { file: `${E}/s18-inbox.spec.ts`, title: "lets the Admin hand the student to another manager or to nobody" },
  ],
  "FR-41 (one university per application; close and open a new one)": [
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "an account has one open file: a closed one does not block a new one" },
  ],
  "FR-42 (the seven steps, the three-day clock, the Admin's step back)": [
    { file: `${U}/pipeline-steps.test.ts`, title: "refuses a manager who skips a step, and lets an admin do it" },
    { file: `${U}/pipeline-steps.test.ts`, title: "runs for three days, and is overdue after" },
    { file: `${U}/pipeline-steps.test.ts`, title: "lets only an admin go back, one step, and only with a note" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "two taps on the same move: one wins, the other is told it already moved" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "only an admin puts a file back one step, with a note" },
    { file: `${I}/s18-1-inbox.test.ts`, title: "Overdue holds a file at step 3 whose three days have passed" },
  ],
  "FR-43 (the step-2 form, prefilled; the passport only when the university asks)": [
    { file: `${U}/s17-form-and-purge.test.ts`, title: "fills in what the student already told us and leaves the rest blank" },
    { file: `${U}/s17-form-and-purge.test.ts`, title: "never overwrites what the student has typed" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "does not store a passport number when the university does not ask for one" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "makes the passport part of the document rule when the university asks" },
    { file: `${E}/s17-my-file.spec.ts`, title: "asks for the passport number only when the university" },
  ],
  "FR-44 (private documents, checked by content, reviewed by the manager, opened by a short audited link)": [
    { file: `${U}/document-signature.test.ts`, title: "refuses a file whose bytes are not the declared type" },
    { file: `${U}/document-signature.test.ts`, title: "refuses an empty object and one over 5 MB" },
    { file: `${I}/s17-1-documents.test.ts`, title: "a staff link is audited, short, and not cacheable" },
    { file: `${I}/s17-1-documents.test.ts`, title: "a file swapped for one of another size after it was checked is not served" },
    { file: `${I}/s17-1-documents.test.ts`, title: "asking for a clearer photo needs a reason" },
    { file: `${I}/s17-1-documents.test.ts`, title: "holds a manager at step 2 until the four documents are approved" },
    { file: `${E}/s17-my-file.spec.ts`, title: "an upload that fails is tried again alone" },
  ],
  "FR-45 (letters uploaded by the Admin as PDF, downloaded by the student)": [
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "lets the admin upload an offer letter, and the student sees it" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "refuses a letter that is not a PDF" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "another student does not see the letter" },
    { file: `${E}/s18-inbox.spec.ts`, title: "uploads a letter for the student the Admin has open" },
  ],
  "FR-46 (proof of payment approved only by the Admin; no Momo details in the app)": [
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "payment proof: the student uploads it, a manager cannot approve it, the admin can" },
    { file: `${I}/s18-1-inbox.test.ts`, title: "Payment proof holds a proof waiting for approval" },
    { file: `${E}/s17-my-file.spec.ts`, title: "does not show the proof of payment before the offer-letter step" },
  ],
  "FR-47 (arrival, the university's payment in the ledger, approved by the Admin)": [
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "arriving closes the open slot and records the day" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "only the admin approves: a manager is refused by the operation" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "a manager cannot enter an entry that is already approved" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "an approval is final" },
  ],
  "FR-48 (quiet at 14 days, suggest closing at 45, only the Admin closes and reopens)": [
    { file: `${U}/pipeline-steps.test.ts`, title: "only an open file can go quiet" },
    { file: `${I}/s18-1-inbox.test.ts`, title: "Quiet holds an open file with no student action for 14 days" },
    { file: `${I}/s18-2-student-activity.test.ts`, title: "does not move when staff act on the file" },
    { file: `${I}/s16-roles-assignment-steps.test.ts`, title: "only an admin closes a file, with a reason code" },
    { file: `${E}/s18-inbox.spec.ts`, title: "offers an Admin to close a file that has been quiet for 45 days" },
    { file: `${E}/s18-inbox.spec.ts`, title: "closes a file with a reason and reopens it, only for the Admin" },
  ],
  "FR-49 (deletion of files three months after Arrived or Closed; erasure removes files)": [
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "keeps the files of a student who has another open application" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "keeps a reopened file: while it is open the files stay" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "stops at 40 objects a run and takes the rest the next day" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "with no storage configured, the run fails when files are waiting" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "an erasure that is refused (identity not confirmed) deletes no file" },
    { file: `${I}/s17-2-3-form-letters-ledger-purge.test.ts`, title: "says so when storage could not delete" },
  ],
  "FR-50 (alerts: the dot, the Inbox badge, the 120-second poll; no push)": [
    { file: `${I}/s18-1-inbox.test.ts`, title: "a manager is alerted to documents waiting, a letter, proof of payment and an overdue file" },
    { file: `${I}/s18-1-inbox.test.ts`, title: "the Admin is also told about a student with no manager, and a manager never is" },
    { file: `${E}/s18-inbox.spec.ts`, title: "fetches itself again, without a reload, when the 120-second check sees the count rise" },
  ],
  "FR-51 (one Inbox per role, ordered by what needs action; one Next step button)": [
    { file: `${U}/s18-inbox-sections.test.ts`, title: "lists the six sections of FR-51 in the order of what needs action" },
    { file: `${I}/s18-1-inbox.test.ts`, title: "a manager sees only the students assigned to them, in the counts as well as the rows" },
    { file: `${I}/s18-1-inbox.test.ts`, title: "a section with more than 50 files says so and returns 50" },
    { file: `${E}/s18-inbox.spec.ts`, title: "gives a manager one Next step button, held until the four required documents are approved" },
    { file: `${E}/s18-inbox.spec.ts`, title: "shows a manager six sections and the Admin the seventh" },
  ],
  "FR-52 (the seven steps and the fees wording, in English and French)": [
    { file: `${U}/s18-seven-steps-text.test.ts`, title: "says nothing of six steps in either language" },
    { file: `${U}/s18-seven-steps-text.test.ts`, title: "builds the same step list for both languages" },
    { file: `${E}/s18-student-public.spec.ts`, title: "/process shows the seven steps in order and the fees wording" },
  ],
};

describe("S19.1: every version 5 requirement is covered by a test that still exists", () => {
  for (const [requirement, tests] of Object.entries(MAP)) {
    it(`${requirement}: ${tests.length} proving test(s) exist`, () => {
      expect(tests.length).toBeGreaterThan(0);
      for (const { file, title } of tests) {
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(readFileSync(file, "utf8"), `${file} no longer has a test titled "${title}"`).toContain(title);
      }
    });
  }

  it("maps exactly FR-39 to FR-52, the requirements PRD_5 adds", () => {
    const prd = readFileSync("prd/PRD_5.md", "utf8");
    const inPrd = [...new Set([...prd.matchAll(/^- \*\*(FR-(?:39|4\d|5[0-2]))\b/gm)].map((m) => m[1]))];
    const mapped = Object.keys(MAP).map((key) => key.split(" ")[0]);
    expect(mapped).toEqual(["FR-39", "FR-40", "FR-41", "FR-42", "FR-43", "FR-44", "FR-45", "FR-46", "FR-47", "FR-48", "FR-49", "FR-50", "FR-51", "FR-52"]);
    expect(inPrd).toEqual(mapped);
  });
});
