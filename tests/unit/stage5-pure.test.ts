import { describe, expect, it } from "vitest";
import { filtersFromSearch, searchFromFilters } from "@/components/admin/leads-panel";
import { leadIdFromPath } from "@/components/admin/lead-detail-panel";
import { failureKey } from "@/components/admin/leads/shared";
import {
  addNoteBody,
  assignBody,
  changeStageBody,
  completeDataRequestBody,
  dataRequestsQuery,
  decideClaimBody,
  eraseLeadBody,
  leadIdQuery,
  leadsQuery,
  logDataRequestBody,
  resolveDuplicateBody,
} from "@/modules/leads/admin-schema";
import { leadListItem, personLabel, slaView, timeline, watDayBounds, type StaffPerson } from "@/modules/leads/admin-view";
import { canonicalShellPath, classifyAuthed } from "@/server/edge/authed";
import { digitsOfNumberSearch, likePattern, VERSION_PATTERN } from "@/server/repositories/lead-admin";

/** Stage 5 pieces that need no database: the schemas, the shapes sent to the screens, the shell path, the URL filters. */

const UUID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const VERSION = "2026-10-21T12:00:00.123456Z";
const NOW = new Date("2026-10-21T12:00:00Z");

describe("the list query (B2)", () => {
  it("defaults to the All view and accepts every filter the screen can produce", () => {
    expect(leadsQuery.parse({})).toEqual({ view: "all" });
    const parsed = leadsQuery.parse({ view: "overdue", stage: "choose_course", country: "GH", university: UUID, assigned: "me", q: "  ama  ", before: OTHER });
    expect(parsed).toMatchObject({ view: "overdue", stage: "choose_course", country: "GH", university: UUID, assigned: "me", q: "ama", before: OTHER });
    expect(leadsQuery.parse({ assigned: "none" }).assigned).toBe("none");
    expect(leadsQuery.parse({ assigned: "user_123" }).assigned).toBe("user_123");
  });

  it("refuses a value the screen could not have produced, and any unknown parameter", () => {
    for (const bad of [{ view: "everything" }, { stage: "Choose Course" }, { country: "gh" }, { country: "GHA" }, { university: "nope" }, { before: "1" }, { assigned: "a b" }, { q: "x".repeat(81) }, { sneaky: "1" }]) {
      expect(leadsQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the single-lead and data-request queries are strict too", () => {
    expect(leadIdQuery.safeParse({ id: UUID }).success).toBe(true);
    expect(leadIdQuery.safeParse({ id: "x" }).success).toBe(false);
    expect(dataRequestsQuery.parse({})).toEqual({ status: "open" });
    expect(dataRequestsQuery.safeParse({ status: "closed" }).success).toBe(false);
  });
});

describe("the operation bodies (architecture 8.3)", () => {
  it("changeStage and assign carry the version they read, in the exact text the server produced", () => {
    expect(VERSION_PATTERN.test(VERSION)).toBe(true);
    expect(changeStageBody.safeParse({ leadId: UUID, stage: "visa", version: VERSION }).success).toBe(true);
    for (const version of ["", "2026-10-21", "2026-10-21T12:00:00Z", "2026-10-21T12:00:00.123Z", "now()", "2026-10-21T12:00:00.123456Z; drop table lead"]) {
      expect(changeStageBody.safeParse({ leadId: UUID, stage: "visa", version }).success, version).toBe(false);
    }
    expect(changeStageBody.safeParse({ leadId: UUID, stage: "visa" }).success).toBe(false);
    expect(assignBody.safeParse({ leadId: UUID, adminId: null, version: VERSION }).success).toBe(true);
    expect(assignBody.safeParse({ leadId: UUID, adminId: "user-1", version: VERSION }).success).toBe(true);
    expect(assignBody.safeParse({ leadId: UUID, adminId: "a b", version: VERSION }).success).toBe(false);
  });

  it("a note is trimmed, required and at most 2000 characters", () => {
    expect(addNoteBody.parse({ leadId: UUID, body: "  hello  " }).body).toBe("hello");
    expect(addNoteBody.safeParse({ leadId: UUID, body: "   " }).success).toBe(false);
    expect(addNoteBody.safeParse({ leadId: UUID, body: "x".repeat(2001) }).success).toBe(false);
    expect(addNoteBody.safeParse({ leadId: UUID, body: "x".repeat(2000) }).success).toBe(true);
  });

  it("approving a link request without a verification method is refused before it reaches the database", () => {
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "approve" }).success).toBe(false);
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "approve", verificationMethod: "trust_me" }).success).toBe(false);
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "approve", verificationMethod: "email_match" }).success).toBe(true);
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "approve", verificationMethod: "whatsapp_confirmed" }).success).toBe(true);
    // A rejection needs a reason and does not take a method.
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "reject" }).success).toBe(false);
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "reject", reason: "  " }).success).toBe(false);
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "reject", reason: "No match" }).success).toBe(true);
    expect(decideClaimBody.safeParse({ claimId: UUID, decision: "reject", reason: "No match", verificationMethod: "email_match" }).success).toBe(false);
  });

  it("erasure needs the identity box ticked: only an explicit true is accepted", () => {
    expect(eraseLeadBody.safeParse({ leadId: UUID, identityConfirmed: true }).success).toBe(true);
    expect(eraseLeadBody.safeParse({ leadId: UUID, identityConfirmed: true, dataRequestId: OTHER }).success).toBe(true);
    for (const bad of [{ leadId: UUID }, { leadId: UUID, identityConfirmed: false }, { leadId: UUID, identityConfirmed: "true" }, { leadId: UUID, identityConfirmed: 1 }]) {
      expect(eraseLeadBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("duplicates and data requests", () => {
    expect(resolveDuplicateBody.safeParse({ keepId: UUID, otherId: OTHER, decision: "merged" }).success).toBe(true);
    expect(resolveDuplicateBody.safeParse({ keepId: UUID, otherId: OTHER, decision: "not_duplicate" }).success).toBe(true);
    expect(resolveDuplicateBody.safeParse({ keepId: UUID, otherId: OTHER, decision: "delete" }).success).toBe(false);
    expect(logDataRequestBody.parse({ kind: "erasure", channel: "whatsapp", leadRef: " sc-abcde-fghjk " }).leadRef).toBe("SC-ABCDE-FGHJK");
    for (const bad of [{ kind: "erasure", channel: "portal", leadRef: "SC-ABCDE-FGHJK" }, { kind: "delete", channel: "other", leadRef: "SC-ABCDE-FGHJK" }, { kind: "export", channel: "other", leadRef: "SC-ABCDE-FGHIK" }, { kind: "export", channel: "other", leadRef: "x" }]) {
      expect(logDataRequestBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(completeDataRequestBody.safeParse({ id: UUID }).success).toBe(true);
    expect(completeDataRequestBody.safeParse({ id: UUID, extra: 1 }).success).toBe(false);
  });
});

describe("search terms", () => {
  it("LIKE characters in a search are matched as themselves", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(likePattern("plain")).toBe("%plain%");
  });

  it("a number-like search becomes its digits, and a name does not", () => {
    expect(digitsOfNumberSearch("+237 6 12-34")).toBe("23761234");
    expect(digitsOfNumberSearch("(233) 20.111")).toBe("23320111");
    expect(digitsOfNumberSearch("612")).toBeNull();
    expect(digitsOfNumberSearch("ama 1234")).toBeNull();
    expect(digitsOfNumberSearch("SC-ABCDE-FGHJK")).toBeNull();
  });
});

describe("what the screens are sent", () => {
  const people = new Map<string, StaffPerson>([["u1", { userId: "u1", email: "ama@example.test", name: "Ama Admin" }], ["u2", { userId: "u2", email: "kofi@example.test", name: "  " }]]);

  it("the SLA badge reads the stored target and never recalculates", () => {
    const due = new Date("2026-10-21T14:00:00Z");
    expect(slaView({ slaDueAt: due, firstResponseAt: null }, NOW)).toEqual({ status: "open", dueAt: due.toISOString() });
    expect(slaView({ slaDueAt: due, firstResponseAt: null }, new Date("2026-10-21T14:00:01Z")).status).toBe("overdue");
    // Replying late still ends as Met: the first reply stops the clock.
    expect(slaView({ slaDueAt: due, firstResponseAt: new Date("2026-10-22T09:00:00Z") }, new Date("2026-10-23T00:00:00Z")).status).toBe("met");
  });

  it("a person is shown by name, then email, and a former admin has an empty label for the screen to translate", () => {
    expect(personLabel("u1", people)).toEqual({ id: "u1", label: "Ama Admin" });
    expect(personLabel("u2", people)).toEqual({ id: "u2", label: "kofi@example.test" });
    expect(personLabel("gone", people)).toEqual({ id: "gone", label: "" });
    expect(personLabel(null, people)).toBeNull();
  });

  it("a list row carries no number or email, and an erased lead is marked", () => {
    const item = leadListItem(
      { id: UUID, ref: "SC-ABCDE-FGHJK", name: null, countryCode: "GH", stageCode: "visa", assignedAdminId: "u1", receivedAt: NOW, slaDueAt: NOW, firstResponseAt: null, anonymisedAt: NOW, intakeKind: "quick" },
      people,
      NOW,
    );
    expect(item).toMatchObject({ name: null, erased: true, quick: true, assigned: { id: "u1", label: "Ama Admin" } });
    expect(Object.keys(item)).not.toContain("whatsapp");
    expect(Object.keys(item)).not.toContain("email");
  });

  it("the timeline joins a note's text to its activity, hides erased notes, and passes only ids and codes", () => {
    const items = timeline(
      [
        { id: "a1", type: "note", actorId: "u1", data: { note_id: "n1", body: "leaked text" }, createdAt: NOW },
        { id: "a2", type: "note", actorId: "u1", data: { note_id: "n2" }, createdAt: NOW },
        { id: "a3", type: "note", actorId: "u1", data: { note_id: "missing" }, createdAt: NOW },
        { id: "a4", type: "stage_changed", actorId: null, data: { from: "share_results", to: "visa", comment: "free text" }, createdAt: NOW },
        { id: "a5", type: "something_new", actorId: "gone", data: { anything: 1 }, createdAt: NOW },
      ],
      [
        { id: "n1", authorId: "u1", body: "Called her", createdAt: NOW, erased: false },
        { id: "n2", authorId: "u1", body: "[erased]", createdAt: NOW, erased: true },
      ],
      people,
    );
    expect(items[0]?.note).toEqual({ body: "Called her", erased: false });
    expect(items[0]?.data).toEqual({ note_id: "n1" });
    expect(items[1]?.note).toEqual({ body: null, erased: true });
    expect(items[2]?.note).toEqual({ body: null, erased: true });
    expect(items[3]?.data).toEqual({ from: "share_results", to: "visa" });
    expect(items[3]?.by).toBeNull();
    expect(items[4]?.data).toEqual({});
  });

  it("Today's leads is the WAT calendar day as two UTC instants", () => {
    // 23:30 UTC on the 20th is 00:30 WAT on the 21st.
    const { start, end } = watDayBounds(new Date("2026-10-20T23:30:00Z"));
    expect(start.toISOString()).toBe("2026-10-20T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-21T23:00:00.000Z");
  });
});

describe("one cached shell for every lead (ADR-040)", () => {
  it("every /admin/leads/<id> is served from the same placeholder shell, and other paths are untouched", () => {
    expect(canonicalShellPath(`/admin/leads/${UUID}`)).toBe("/admin/leads/_");
    expect(canonicalShellPath(`/en/admin/leads/${OTHER}/`)).toBe("/en/admin/leads/_");
    expect(canonicalShellPath(`/admin/leads/${UUID.toUpperCase()}`)).toBe("/admin/leads/_");
    for (const path of ["/admin/leads", "/admin/leads/link-requests", "/admin/data-requests", "/admin", "/admin/leads/not-a-uuid", `/admin/team/${UUID}`, `/admin/leads/${UUID}/extra`]) {
      expect(canonicalShellPath(path), path).toBe(path);
    }
  });

  it("the new screens and data calls are classified as signed-in routes", () => {
    const url = (path: string) => new URL(`https://example.test${path}`);
    expect(classifyAuthed("GET", url(`/admin/leads/${UUID}`), new Headers())).toEqual({ kind: "shell", area: "admin" });
    expect(classifyAuthed("GET", url("/admin/data-requests"), new Headers())).toEqual({ kind: "shell", area: "admin" });
    for (const name of ["overview", "leads", "lead", "duplicates", "link-requests", "data-requests"]) {
      expect(classifyAuthed("GET", url(`/api/v1/admin/${name}`), new Headers()), name).toEqual({ kind: "api", area: "admin", name });
    }
  });
});

describe("the browser's side", () => {
  it("the lead id is read from the address, with or without the language prefix and a trailing slash", () => {
    expect(leadIdFromPath(`/admin/leads/${UUID}`)).toBe(UUID);
    expect(leadIdFromPath(`/en/admin/leads/${UUID}/`)).toBe(UUID);
    expect(leadIdFromPath("/admin/leads/_")).toBeNull();
    expect(leadIdFromPath("/admin/leads")).toBeNull();
    expect(leadIdFromPath(`/admin/leads/${UUID}x`)).toBeNull();
  });

  it("the filters round-trip through the address, so a list can be bookmarked", () => {
    const filters = { view: "overdue" as const, stage: "visa", country: "NG", university: UUID, assigned: "me", q: "ama mensah" };
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters);
    expect(searchFromFilters({ view: "all", stage: "", country: "", university: "", assigned: "", q: "" })).toBe("");
    // Something the screen does not know falls back to the full list instead of failing.
    expect(filtersFromSearch("?view=bogus").view).toBe("all");
    expect(filtersFromSearch("?view=unanswered").view).toBe("unanswered");
  });

  it("a failed change maps to one of the screen's messages", () => {
    expect(failureKey({ status: 0, code: "NETWORK", fields: {} })).toBe("network");
    expect(failureKey({ status: 409, code: "CONFLICT", fields: { version: "STALE" } })).toBe("stale");
    expect(failureKey({ status: 409, code: "CONFLICT", fields: { lead: "UNAVAILABLE" } })).toBe("unavailable");
    expect(failureKey({ status: 404, code: "NOT_FOUND", fields: {} })).toBe("notFound");
    expect(failureKey({ status: 403, code: "FORBIDDEN", fields: {} })).toBe("forbidden");
    expect(failureKey({ status: 500, code: "INTERNAL", fields: {} })).toBe("generic");
  });
});
