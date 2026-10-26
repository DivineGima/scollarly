import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTION_PERMISSION, type ActionId, can, PERMISSIONS, type PermissionRole } from "@/server/auth/permissions";
import { type Actor, AuthError, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import { createAuthFacade, type AuthFacade } from "@/server/auth/facade";
import { resolveSession, setRoleQuery } from "@/server/repositories/identity";
import { listLeads } from "@/server/repositories/leads";
import { decideClaim } from "@/server/repositories/claims";
import { completeDataRequest, logDataRequest } from "@/server/repositories/data-requests";
import { addNote, assignLead, changeStage, eraseLead, logAdminWhatsAppOpen, logReply, resolveDuplicate } from "@/server/repositories/lead-admin";
import { runAs } from "@/server/repositories/as-actor";
import { TYPE_DEFS } from "@/modules/content-admin/definitions";
import { changeStatus, createContent } from "@/server/repositories/content-admin";
import { archiveMedia, insertMediaAs } from "@/server/repositories/media-admin";
import { eraseMyAccount, exportMyData, requestLink } from "@/server/repositories/student";
import { updateSetting } from "@/server/repositories/settings";
import { createInvite, removeAdmin, revokeInvite } from "@/server/repositories/team";
import { uuidv7 } from "@/lib/uuid";
import { recordPayment, voidPayment } from "@/server/repositories/payments";
import { leadRow, q, uni } from "./helpers/fixtures";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * The authorisation matrix harness (architecture 13.9, S1.5). It is generated from the 9.5 permission table: the table
 * is parsed by tests/unit/permissions.test.ts into `src/server/auth/permissions.ts`, and here every protected action is
 * called under every role through the REAL path, session cookie -> Neon Auth session query -> facade -> repository ->
 * row level security, and the result must equal the table.
 *
 * An action of architecture 8.3 that has no implementation yet is listed under PENDING and shown as a todo, so the
 * harness runs from Stage 1 and every stage that builds an operation moves it from PENDING to IMPLEMENTED.
 */

const COOKIE = "__Secure-neon-auth.session_token";

interface Subject {
  name: string;
  /** What the table is read with: anonymous, or the effective role (an owner without 2FA reads as a student). */
  role: PermissionRole;
  /** The last 2FA check is inside the 10-minute step-up window. */
  stepUpFresh: boolean;
  headers: Headers;
}

let t: TestDb;
let facade: AuthFacade;
const subjects: Subject[] = [];
const ids: Record<string, string> = {};

const cookie = (token: string | null) => new Headers(token ? { cookie: `${COOKIE}=${token}.signature` } : {});

async function addSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex").slice(0, 32);
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  await t.run(`insert into neon_auth.session ("expiresAt", token, "userId", "updatedAt") values (${q(expires)}, ${q(token)}, ${q(userId)}, now())`);
  return token;
}

async function sessionIdOf(token: string): Promise<string> {
  const [row] = (await t.run(`select id from neon_auth.session where token = ${q(token)}`)) as { id: string }[];
  return row?.id ?? "";
}

beforeAll(async () => {
  t = await createTestDb();
  // The facade runs its one session query as the Worker's runtime role, exactly as in production.
  facade = createAuthFacade(async (token) => {
    await t.asRuntime();
    try {
      return await resolveSession(t.db, token);
    } finally {
      await t.asOwner();
    }
  });

  const student = await t.signIn();
  const admin = await t.signIn();
  const owner = await t.signIn();
  const target = await t.signIn();
  ids.student = student.userId;
  ids.target = target.userId;
  await t.run(`insert into app_user (id, role) values (${q(admin.userId)}, 'admin'), (${q(owner.userId)}, 'owner'), (${q(target.userId)}, 'student'), (${q(student.userId)}, 'student')`);

  const ownerFresh = await addSession(owner.userId);
  const ownerStale = await addSession(owner.userId);
  const ownerNo2fa = await addSession(owner.userId);
  for (const [token, ageMs] of [[ownerFresh, 0], [ownerStale, STEP_UP_WINDOW_MS + 60_000]] as const) {
    const sessionId = await sessionIdOf(token);
    await t.run(`insert into step_up (session_id, user_id, verified_at) values (${q(sessionId)}, ${q(owner.userId)}, ${q(new Date(Date.now() - ageMs).toISOString())})`);
  }

  subjects.push(
    { name: "anonymous", role: "anonymous", stepUpFresh: false, headers: cookie(null) },
    { name: "student", role: "student", stepUpFresh: false, headers: cookie(student.token) },
    { name: "admin", role: "admin", stepUpFresh: false, headers: cookie(admin.token) },
    { name: "owner (2FA just verified)", role: "owner", stepUpFresh: true, headers: cookie(ownerFresh) },
    { name: "owner (2FA verified 11 minutes ago)", role: "owner", stepUpFresh: false, headers: cookie(ownerStale) },
    { name: "owner (no 2FA yet: treated as a student)", role: "student", stepUpFresh: false, headers: cookie(ownerNo2fa) },
  );

  // Two leads, neither linked to the student, so "views all leads" is visible as a count.
  ids.lead = await leadRow(t);
  ids.lead2 = await leadRow(t);
  const [leadRef] = (await t.run(`select ref from lead where id = ${q(ids.lead)}`)) as { ref: string }[];
  ids.leadRef = leadRef?.ref ?? "";
  ids.university = await uni(t, { status: "published" });
});

afterAll(async () => {
  await t.close();
});

/** Destructive owner actions also need a 2FA check inside the last 10 minutes (architecture 9.3 step 5, FR-8). */
const STEP_UP_ACTIONS: ReadonlySet<ActionId> = new Set(["team.invite", "team.removeAdmin", "team.changeRole", "settings.update"]);

const expected = (subject: Subject, action: ActionId): boolean => {
  const allowed = can(subject.role, ACTION_PERMISSION[action]);
  return STEP_UP_ACTIONS.has(action) ? allowed && subject.stepUpFresh : allowed;
};

/** Runs the repository part as the runtime role, so row level security applies. */
async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await t.asRuntime();
  try {
    return await work();
  } finally {
    await t.asOwner();
  }
}

/** True when the operation went through, false when the facade or the database refused it. */
type Attempt = (subject: Subject) => Promise<boolean>;

async function guarded(subject: Subject, guard: (f: AuthFacade, h: Headers) => Promise<Actor>, work: (actor: Actor) => Promise<boolean>): Promise<boolean> {
  let actor: Actor;
  try {
    actor = await guard(facade, subject.headers);
  } catch (error) {
    if (error instanceof AuthError) return false;
    throw error;
  }
  return asRuntime(() => work(actor));
}

const IMPLEMENTED: Partial<Record<ActionId, Attempt>> = {
  "settings.update": (subject) =>
    guarded(
      subject,
      (f, h) => f.requireOwner(h, { stepUp: true }),
      (actor) => updateSetting(t.db, actor, "sla_weekday_hours", 4),
    ),
  // Stage 2 (S2.5). The facade is the first lock; row level security (admin_invite policies, app_remove_admin) is the second.
  // The attempt counts as done when the repository call returns, whatever it found to change: what is under test is who gets in.
  "team.invite": (subject) =>
    guarded(
      subject,
      (f, h) => f.requireOwner(h, { stepUp: true }),
      async (actor) => {
        const email = `matrix-${randomBytes(6).toString("hex")}@example.test`;
        await createInvite(t.db, actor, { id: uuidv7(), email, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 86_400_000) });
        return true;
      },
    ),
  "team.revokeInvite": (subject) =>
    guarded(
      subject,
      (f, h) => f.requireOwner(h),
      async (actor) => {
        await revokeInvite(t.db, actor, uuidv7(), uuidv7());
        return true;
      },
    ),
  "team.removeAdmin": (subject) =>
    guarded(
      subject,
      (f, h) => f.requireOwner(h, { stepUp: true }),
      async (actor) => {
        await removeAdmin(t.db, actor, ids.target ?? "");
        return true;
      },
    ),
  "team.changeRole": (subject) =>
    guarded(
      subject,
      (f, h) => f.requireOwner(h, { stepUp: true }),
      async (actor) => {
        const [rows] = await runAs(t.db, actor, setRoleQuery(t.db, ids.target ?? "", "student"));
        return rows.length === 1;
      },
    ),

  // Stage 5 (S5.2 to S5.5). The facade is the first lock (an admin, or an owner after 2FA); the lead policies and the database
  // functions (which check for staff themselves) are the second. As above, an attempt counts as done when the call returns.
  "leads.changeStage": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await changeStage(t.db, actor, { leadId: ids.lead ?? "", stage: "choose_course", version: "2000-01-01T00:00:00.000000Z" });
      return true;
    }),
  "leads.assign": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await assignLead(t.db, actor, { leadId: ids.lead ?? "", adminId: null, version: "2000-01-01T00:00:00.000000Z" });
      return true;
    }),
  "leads.addNote": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await addNote(t.db, actor, { leadId: ids.lead2 ?? "", body: "matrix" });
      return true;
    }),
  "leads.logReply": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await logReply(t.db, actor, ids.lead2 ?? "");
      return true;
    }),
  "leads.logAdminWhatsAppOpen": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await logAdminWhatsAppOpen(t.db, actor, ids.lead2 ?? "");
      return true;
    }),
  "leads.resolveDuplicate": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await resolveDuplicate(t.db, actor, ids.lead ?? "", uuidv7(), "not_duplicate");
      return true;
    }),
  "leads.decideClaim": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await decideClaim(t.db, actor, uuidv7(), { decision: "reject", reason: "matrix" });
      return true;
    }),
  "leads.eraseLead": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      // Identity not confirmed: the function runs its staff check and then refuses, so no lead is erased by the harness.
      await eraseLead(t.db, actor, { leadId: ids.lead ?? "", identityConfirmed: false });
      return true;
    }),
  "dataRequests.log": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await logDataRequest(t.db, actor, { kind: "export", channel: "whatsapp", leadRef: ids.leadRef ?? "" });
      return true;
    }),
  "dataRequests.complete": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await completeDataRequest(t.db, actor, uuidv7());
      return true;
    }),

  // Stage 6 (S6.1 to S6.3). The facade is the first lock (an admin, or an owner after 2FA); the content and media policies are the second
  // (tests/integration/stage6-content.test.ts shows a student refused by them). As above, an attempt counts as done when the call returns.
  "content.save": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      const outcome = await createContent(t.db, actor, TYPE_DEFS.faqs, { id: null, version: null, newId: uuidv7(), values: { category: null, question: "Matrix?", answer: "Yes.", sortOrder: 0 } });
      return outcome.kind === "ok";
    }),
  "content.publish": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await changeStatus(t.db, actor, TYPE_DEFS.faqs, { id: uuidv7(), version: "2000-01-01T00:00:00.000000Z" }, "publish");
      return true;
    }),
  "content.unpublish": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await changeStatus(t.db, actor, TYPE_DEFS.faqs, { id: uuidv7(), version: "2000-01-01T00:00:00.000000Z" }, "unpublish");
      return true;
    }),
  "content.archive": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await changeStatus(t.db, actor, TYPE_DEFS.faqs, { id: uuidv7(), version: "2000-01-01T00:00:00.000000Z" }, "archive");
      return true;
    }),
  "content.restore": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await changeStatus(t.db, actor, TYPE_DEFS.faqs, { id: uuidv7(), version: "2000-01-01T00:00:00.000000Z" }, "restore");
      return true;
    }),
  "media.upload": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      const sha256 = randomBytes(32).toString("hex");
      return (await insertMediaAs(t.db, actor, { id: uuidv7(), kind: "photo", width: 10, height: 10, bytes: 1000, sha256 }, { document: false })) !== null;
    }),
  "media.archive": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await archiveMedia(t.db, actor, uuidv7());
      return true;
    }),

  // Stage 9 (S9.1). The facade is the first lock (an admin, or an owner after 2FA); the ledger policies, the column grants and the guard
  // trigger are the second (tests/integration/stage9-payments.test.ts shows a student refused by them).
  "payments.record": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      const outcome = await recordPayment(t.db, actor, { id: uuidv7(), submissionToken: randomUUID(), universityId: ids.university ?? "", leadId: null, amountUsdCents: 12345, receivedOn: "2026-01-01", note: null });
      return outcome.kind === "created";
    }),
  "payments.void": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "admin"), async (actor) => {
      await voidPayment(t.db, actor, randomUUID(), "matrix");
      return true;
    }),

  // Stage 8 (S8.2, S8.3). Any signed-in user may use the portal (a staff member as a user), so the guard is the student level.
  // Erasure is called with a token that is not a session: the database function refuses it (a student: no recent sign-in; staff: a team
  // account), so the harness never erases one of its own subjects.
  "student.requestLink": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "student"), async (actor) => {
      await requestLink(t.db, actor, { ref: "SC-00000-00000" });
      return true;
    }),
  "student.exportData": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "student"), async (actor) => {
      await exportMyData(t.db, actor);
      return true;
    }),
  "student.requestErasure": (subject) =>
    guarded(subject, (f, h) => f.requireRole(h, "student"), async (actor) => {
      const outcome = await eraseMyAccount(t.db, actor, "not-a-session-token-0000000000000000");
      return outcome !== "erased";
    }),
};

/** Operations of architecture 8.3 whose endpoint is built by a later stage. */
const PENDING = (Object.keys(ACTION_PERMISSION) as ActionId[]).filter((action) => !(action in IMPLEMENTED));

// Every implemented action under every role. The subject names are fixed here (the subjects themselves are built in beforeAll).
describe.each(Object.keys(IMPLEMENTED) as ActionId[])("matrix for %s", (action) => {
  const attempt = IMPLEMENTED[action];
  it.each([
    "anonymous",
    "student",
    "admin",
    "owner (2FA just verified)",
    "owner (2FA verified 11 minutes ago)",
    "owner (no 2FA yet: treated as a student)",
  ])("as %s", async (name) => {
    const subject = subjects.find((s) => s.name === name);
    if (!subject || !attempt) throw new Error("setup incomplete");
    expect(await attempt(subject), `${action} as ${name}`).toBe(expected(subject, action));
  });
});

describe("authorisation matrix: reads", () => {
  it("'View and work all leads': staff see leads they do not own; a student, a visitor and an owner without 2FA see none", async () => {
    for (const subject of subjects) {
      const saw = await guarded(
        subject,
        async (f, h) => {
          const actor = await f.checkSession(h);
          if (!actor) throw new AuthError("UNAUTHENTICATED", "no session");
          return actor;
        },
        async (actor) => (await listLeads(t.db, actor)).length >= 2,
      );
      expect(saw, subject.name).toBe(can(subject.role, "leads.work"));
    }
  });
});

describe("authorisation matrix: the facade guard of every capability", () => {
  const GUARD: Record<string, ((f: AuthFacade, h: Headers) => Promise<unknown>) | null> = {
    "public.use": null,
    "student.own": (f, h) => f.requireRole(h, "student"),
    "leads.work": (f, h) => f.requireRole(h, "admin"),
    "content.manage": (f, h) => f.requireRole(h, "admin"),
    "payments.manage": (f, h) => f.requireRole(h, "admin"),
    "analytics.view": (f, h) => f.requireRole(h, "admin"),
    "performance.own": (f, h) => f.requireRole(h, "admin"),
    "performance.all": (f, h) => f.requireOwner(h),
    "team.manage": (f, h) => f.requireOwner(h),
    "owner.pages": (f, h) => f.requireOwner(h),
  };

  it("has a guard for every capability in the table", () => {
    expect(Object.keys(GUARD).sort()).toEqual(PERMISSIONS.map((p) => p.id).sort());
  });

  for (const permission of PERMISSIONS) {
    it(`${permission.id}: ${permission.label}`, async () => {
      const guard = GUARD[permission.id];
      for (const subject of subjects) {
        let allowed = true;
        if (guard) {
          try {
            await asRuntime(() => guard(facade, subject.headers));
          } catch (error) {
            if (!(error instanceof AuthError)) throw error;
            allowed = false;
          }
        }
        // `student.own` is also true for staff and a signed-in owner (they use the portal as a user), but never for a visitor.
        expect(allowed, `${permission.id} as ${subject.name}`).toBe(can(subject.role, permission.id));
      }
    });
  }
});

describe("authorisation matrix: operations still to be built", () => {
  it("every operation is either implemented in this harness or listed as pending, never missing", () => {
    expect([...Object.keys(IMPLEMENTED), ...PENDING].sort()).toEqual(Object.keys(ACTION_PERMISSION).sort());
  });

  for (const action of PENDING) it.todo(`${action} (${ACTION_PERMISSION[action]}) under every role, when its stage builds it`);
});
