import { errorResponseFor, jsonResponse } from "@/lib/http";
import { uuidv7 } from "@/lib/uuid";
import { type Actor, AuthError } from "@/server/auth/actor";
import { sha256Hex } from "@/lib/hash";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { createInvite, listOpenInvites, listTeam, removeAdmin, revokeInvite } from "@/server/repositories/team";
import { inviteBody, removeAdminBody, revokeInviteBody } from "./schema";
import { inviteExpiry, inviteLink, inviteState, isUniqueViolation, newInviteToken } from "./service";

/**
 * Team and invites (S2.5; architecture 9.4, 16 C2). Owner only, and an owner session that has not passed 2FA is a student,
 * so it is refused before any of this runs. Inviting and removing also need a 2FA check inside the last 10 minutes.
 */

export const teamMutations: Record<string, Mutation> = {
  /** C2 steps 2 to 3, and "Resend": any open invite for the email is replaced. The link appears in this response only. */
  "admin/team.invite": {
    access: { kind: "role", role: "owner", stepUp: true },
    async handle({ actor, env, body, request, requestId }) {
      const owner = actor as Actor;
      const parsed = parseBody(inviteBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const { email } = parsed.value;

      const team = await listTeam(env.db, owner);
      if (team.some((member) => member.email.toLowerCase() === email)) {
        return errorResponseFor("CONFLICT", "That person is already on the team.", requestId, { fields: { email: "ALREADY_STAFF" } });
      }

      const token = newInviteToken();
      const id = uuidv7(env.now().getTime());
      const expiresAt = inviteExpiry(env.now());
      try {
        await createInvite(env.db, owner, { id, email, tokenHash: await sha256Hex(token), expiresAt });
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
    access: { kind: "role", role: "owner" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(revokeInviteBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const revoked = await revokeInvite(env.db, actor as Actor, parsed.value.id, uuidv7(env.now().getTime()));
      return jsonResponse({ revoked });
    },
  },

  /** C2 steps 5 to 6: one transaction in the database function. The owner and non-admins cannot be removed. */
  "admin/team.removeAdmin": {
    access: { kind: "role", role: "owner", stepUp: true },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(removeAdminBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const released = await removeAdmin(env.db, actor as Actor, parsed.value.userId);
      if (released === null) return errorResponseFor("NOT_FOUND", "That person is not an admin.", requestId);
      return jsonResponse({ removed: true, leadsReleased: released });
    },
  },
};

export function teamDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** C2 step 1: admins with the leads they hold, and the invites still waiting. */
    "admin/team": async (actor) => {
      if (actor.role !== "owner") throw new AuthError("FORBIDDEN", "Not allowed.");
      const now = env.now();
      const [members, invites] = await Promise.all([listTeam(env.db, actor), listOpenInvites(env.db, actor)]);
      return {
        members: members.map((m) => ({ userId: m.userId, email: m.email, name: m.name, role: m.role, leadsHeld: m.leadsHeld, since: m.since.toISOString(), isYou: m.userId === actor.userId })),
        invites: invites.map((i) => ({ id: i.id, email: i.email, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString(), state: inviteState(i, now) })),
      };
    },
  };
}
