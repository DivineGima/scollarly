import { errorResponseFor, jsonResponse } from "@/lib/http";
import { uuidv7 } from "@/lib/uuid";
import { type Actor, AuthError } from "@/server/auth/actor";
import { sha256Hex } from "@/lib/hash";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { createInvite, listOpenInvites, listTeam, reassignManager, removeManager, revokeInvite, setStaffSettings } from "@/server/repositories/team";
import { inviteBody, reassignBody, removeManagerBody, revokeInviteBody, staffSettingsBody } from "./schema";
import { inviteExpiry, inviteLink, inviteState, isUniqueViolation, newInviteToken } from "./service";

/**
 * Team and invites (S2.5; architecture 9.4, 16 C2). Owner only, and an owner session that has not passed 2FA is a student,
 * so it is refused before any of this runs. Inviting and removing also need a 2FA check inside the last 10 minutes.
 */

export const teamMutations: Record<string, Mutation> = {
  /** C2 steps 2 to 3, and "Resend": any open invite for the email is replaced. The link appears in this response only. */
  "admin/team.invite": {
    access: { kind: "role", role: "admin", stepUp: true },
    async handle({ actor, env, body, request, requestId }) {
      const owner = actor as Actor;
      const parsed = parseBody(inviteBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const { email, role } = parsed.value;

      const team = await listTeam(env.db, owner);
      if (team.some((member) => member.email.toLowerCase() === email)) {
        return errorResponseFor("CONFLICT", "That person is already on the team.", requestId, { fields: { email: "ALREADY_STAFF" } });
      }

      const token = newInviteToken();
      const id = uuidv7(env.now().getTime());
      const expiresAt = inviteExpiry(env.now());
      try {
        await createInvite(env.db, owner, { id, email, tokenHash: await sha256Hex(token), expiresAt, role });
      } catch (error) {
        // Two simultaneous invites for one email: the unique index lets one win.
        if (isUniqueViolation(error)) return errorResponseFor("CONFLICT", "An invite was just created for that email. Reload the page.", requestId);
        throw error;
      }
      return jsonResponse({ id, email, expiresAt: expiresAt.toISOString(), link: inviteLink(new URL(request.url).origin, token) }, 201);
    },
  },

  /** C2 step 4. Revoking something already used or revoked is not an error, it just reports that nothing changed. */
  "admin/team.revokeInvite": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(revokeInviteBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const revoked = await revokeInvite(env.db, actor as Actor, parsed.value.id, uuidv7(env.now().getTime()));
      return jsonResponse({ revoked });
    },
  },

  /** Version 5 (architecture 24.3): an admin moves a student, and the open application with them, to another manager or to nobody. */
  "admin/team.reassign": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(reassignBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await reassignManager(env.db, actor as Actor, parsed.value.studentId, parsed.value.managerId);
      if (outcome === "no_student") return errorResponseFor("NOT_FOUND", "That student has no profile.", requestId);
      if (outcome === "not_a_manager") return errorResponseFor("VALIDATION", "That person is not a manager.", requestId, { fields: { managerId: "UNKNOWN_VALUE" } });
      return jsonResponse({ changed: outcome === "moved" });
    },
  },

  /** Version 5 (architecture 24.3): a manager or admin sets their own away switch and WhatsApp number. Nobody sets another person's. */
  "admin/staff.settings": {
    access: { kind: "role", role: "manager" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(staffSettingsBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const saved = await setStaffSettings(env.db, actor as Actor, parsed.value);
      return saved ? jsonResponse({ saved: true }) : errorResponseFor("VALIDATION", "That number is not valid.", requestId, { fields: { whatsapp: "INVALID" } });
    },
  },

  /** C2 steps 5 to 6: one transaction in the database function. The owner and non-admins cannot be removed. */
  "admin/team.removeAdmin": {
    access: { kind: "role", role: "admin", stepUp: true },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(removeManagerBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const released = await removeManager(env.db, actor as Actor, parsed.value.userId);
      if (released === null) return errorResponseFor("NOT_FOUND", "That person is not an admin.", requestId);
      return jsonResponse({ removed: true, leadsReleased: released });
    },
  },
};

export function teamDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** C2 step 1: admins with the leads they hold, and the invites still waiting. */
    "admin/team": async (actor) => {
      if (actor.role !== "admin") throw new AuthError("FORBIDDEN", "Not allowed.");
      const now = env.now();
      const [members, invites] = await Promise.all([listTeam(env.db, actor), listOpenInvites(env.db, actor)]);
      return {
        members: members.map((m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role, leadsHeld: m.leadsHeld, since: m.since.toISOString(), isYou: m.userId === actor.userId })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(), state: inviteState(i, now) })),
      };
    },
  };
}
