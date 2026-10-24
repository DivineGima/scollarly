import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTION_PERMISSION, type ActionId, can, PERMISSIONS, type PermissionRole } from "@/server/auth/permissions";
import { type Actor, AuthError, STEP_UP_WINDOW_MS } from "@/server/auth/actor";
import { createAuthFacade, type AuthFacade } from "@/server/auth/facade";
import { resolveSession, setRoleQuery } from "@/server/repositories/identity";
import { listLeads } from "@/server/repositories/leads";
import { runAs } from "@/server/repositories/as-actor";
import { updateSetting } from "@/server/repositories/settings";
import { createInvite, removeAdmin, revokeInvite } from "@/server/repositories/team";
import { uuidv7 } from "@/lib/uuid";
import { leadRow, q } from "./helpers/fixtures";
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
  await leadRow(t);
  await leadRow(t);
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
