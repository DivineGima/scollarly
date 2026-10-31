import { errorResponseFor, jsonResponse, newRequestId } from "@/lib/http";
import { type Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { decideClaim, listPendingClaims } from "@/server/repositories/claims";
import { completeDataRequest, listDataRequests, logDataRequest } from "@/server/repositories/data-requests";
import {
  addNote,
  assignLead,
  changeStage,
  eraseLead,
  getLeadScreen,
  getOverviewCounts,
  listDuplicatePairs,
  listLeadsAdmin,
  listStageNames,
  listUniversityOptions,
  logAdminWhatsAppOpen,
  logReply,
  resolveDuplicate,
  type MissOutcome,
} from "@/server/repositories/lead-admin";
import { listTeam } from "@/server/repositories/team";
import {
  addNoteBody,
  assignBody,
  changeStageBody,
  completeDataRequestBody,
  dataRequestsQuery,
  decideClaimBody,
  eraseLeadBody,
  leadIdBody,
  leadIdQuery,
  leadsQuery,
  logDataRequestBody,
  resolveDuplicateBody,
} from "./admin-schema";
import { leadListItem, slaView, timeline, watDayBounds, type StaffPerson } from "./admin-view";

/**
 * The admin lead screens (S5.1 to S5.5; architecture 8.3, 16 B1 to B5): plain data calls and mutations in the Worker entry
 * (ADR-040). Both kinds are for staff (`admin`, or the owner after 2FA); the facade has already checked that before any of
 * this runs, and row level security checks it again in the database. A mutation validates its body with Zod, calls one
 * repository function (one transaction) and turns its outcome into the error envelope the screen shows.
 */

export const LEADS_PAGE_SIZE = 50;

function peopleOf(team: { userId: string; email: string; name: string }[]): { list: StaffPerson[]; byId: Map<string, StaffPerson> } {
  const list = team.map((m) => ({ userId: m.userId, email: m.email, name: m.name }));
  return { list, byId: new Map(list.map((p) => [p.userId, p])) };
}

async function staffPeople(env: EndpointEnv, actor: Actor): Promise<{ list: StaffPerson[]; byId: Map<string, StaffPerson> }> {
  return peopleOf(await listTeam(env.db, actor));
}

const invalid = (requestId: string) => errorResponseFor("VALIDATION", "Check the filters.", requestId);

/** A change that matched nothing, as the screen should see it. */
function missResponse(miss: MissOutcome, requestId: string): Response {
  switch (miss.kind) {
    case "unchanged":
      return jsonResponse({ changed: false, version: miss.version });
    case "conflict":
      // The one message of architecture 13.6 and B3 step 13; the screen reloads the lead.
      return errorResponseFor("CONFLICT", "This lead changed. Reload.", requestId, { fields: { version: "STALE" } });
    case "unavailable":
      return errorResponseFor("CONFLICT", "This lead can no longer be changed.", requestId, { fields: { lead: "UNAVAILABLE" } });
    case "not_found":
      return errorResponseFor("NOT_FOUND", "That lead does not exist.", requestId);
    case "unknown_stage":
      return errorResponseFor("VALIDATION", "Unknown stage.", requestId, { fields: { stage: "UNKNOWN_VALUE" } });
  }
}

export function leadDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** B1: the tiles and the funnel. The counts are one SQL statement (S5.3). */
    "admin/overview": async (actor) => {
      const now = env.now();
      const { start, end } = watDayBounds(now);
      const [counts, stages] = await Promise.all([getOverviewCounts(env.db, actor, now, start, end), listStageNames(env.db, actor)]);
      return {
        unanswered: counts.unanswered,
        overdue: counts.overdue,
        mine: counts.mine,
        unassigned: counts.unassigned,
        today: counts.today,
        pendingClaims: counts.pendingClaims,
        openDataRequests: counts.openDataRequests,
        funnel: stages.map((s) => ({ code: s.code, name: s.name, count: counts.funnel.find((f) => f.stageCode === s.code)?.count ?? 0 })),
      };
    },

    /** B2: the list, its filters and the options the filter controls need. The filters are in the URL (B2 step 2). */
    "admin/leads": async (actor, call) => {
      const parsed = leadsQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(newRequestId());
      const q = parsed.data;
      const now = env.now();
      const [rows, people, stages, universities] = await Promise.all([
        listLeadsAdmin(env.db, actor, {
          view: q.view,
          ...(q.stage ? { stage: q.stage } : {}),
          ...(q.country ? { country: q.country } : {}),
          ...(q.university ? { universityId: q.university } : {}),
          ...(q.assigned ? { assigned: q.assigned } : {}),
          ...(q.q ? { q: q.q } : {}),
          ...(q.before ? { before: q.before } : {}),
          limit: LEADS_PAGE_SIZE + 1,
          now,
        }),
        staffPeople(env, actor),
        listStageNames(env.db, actor),
        listUniversityOptions(env.db, actor),
      ]);
      const page = rows.slice(0, LEADS_PAGE_SIZE);
      const last = page[page.length - 1];
      return {
        leads: page.map((row) => leadListItem(row, people.byId, now)),
        nextBefore: rows.length > LEADS_PAGE_SIZE && last ? last.id : null,
        stages: stages.map((s) => ({ code: s.code, name: s.name })),
        universities,
        admins: people.list.map((p) => ({ id: p.userId, label: p.name.trim() || p.email })),
      };
    },

    /** B3: one lead with everything the detail screen shows. */
    "admin/lead": async (actor, call) => {
      const parsed = leadIdQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(newRequestId());
      // One round trip for everything the screen shows (getLeadScreen): each separate read costs the Worker CPU time.
      const detail = await getLeadScreen(env.db, actor, parsed.data.id);
      if (!detail) return errorResponseFor("NOT_FOUND", "That lead does not exist.", newRequestId());
      const now = env.now();
      const { stages, template, duplicates } = detail;
      const people = peopleOf(detail.team);
      const l = detail.lead;
      return {
        lead: {
          id: l.id,
          ref: l.ref,
          name: l.name,
          whatsapp: l.whatsappE164,
          email: l.email,
          country: l.countryCode,
          intakeKind: l.intakeKind,
          qualificationType: l.qualificationType,
          results: l.results,
          locale: l.locale,
          stage: l.stageCode,
          assigned: l.assignedAdminId ? { id: l.assignedAdminId, label: people.byId.get(l.assignedAdminId)?.name.trim() || people.byId.get(l.assignedAdminId)?.email || "" } : null,
          linkedAccount: l.userId !== null,
          receivedAt: l.receivedAt.toISOString(),
          sla: slaView(l, now),
          slaHours: l.slaHoursApplied,
          firstResponseAt: l.firstResponseAt ? l.firstResponseAt.toISOString() : null,
          erased: l.anonymisedAt !== null,
          mergedInto: l.mergedIntoId ? { id: l.mergedIntoId, ref: detail.mergedIntoRef ?? "" } : null,
          source: { page: typeof l.source.page === "string" ? l.source.page : null, university: detail.sourceUniversityName, contactName: typeof l.source.contact_name === "string" ? l.source.contact_name : null },
          version: l.version,
        },
        prefs: detail.prefs,
        timeline: timeline(detail.activities, detail.notes, people.byId),
        pendingClaims: detail.pendingClaims,
        duplicates: duplicates.map((d) => ({ a: { ...d.a, receivedAt: d.a.receivedAt.toISOString() }, b: { ...d.b, receivedAt: d.b.receivedAt.toISOString() } })),
        stages: stages.map((s) => ({ code: s.code, name: s.name })),
        admins: people.list.map((p) => ({ id: p.userId, label: p.name.trim() || p.email })),
        /** The staff-written template for this stage and language, or null (the screen then uses its built-in text). */
        template,
        you: actor.userId,
      };
    },

    /** B2 tab "Duplicates". */
    "admin/duplicates": async (actor) => {
      const [pairs, stages] = await Promise.all([listDuplicatePairs(env.db, actor, { limit: 50 }), listStageNames(env.db, actor)]);
      return {
        pairs: pairs.map((d) => ({ a: { ...d.a, receivedAt: d.a.receivedAt.toISOString() }, b: { ...d.b, receivedAt: d.b.receivedAt.toISOString() } })),
        stages: stages.map((s) => ({ code: s.code, name: s.name })),
      };
    },

    /** B4 step 1. */
    "admin/link-requests": async (actor) => {
      const claims = await listPendingClaims(env.db, actor);
      return { claims: claims.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) };
    },

    /** B5 step 1. */
    "admin/data-requests": async (actor, call) => {
      const parsed = dataRequestsQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid(newRequestId());
      const [rows, people] = await Promise.all([listDataRequests(env.db, actor, parsed.data.status), staffPeople(env, actor)]);
      return {
        requests: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          channel: r.channel,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          handledBy: r.handledBy ? (people.byId.get(r.handledBy)?.name.trim() || people.byId.get(r.handledBy)?.email || "") : null,
          lead: r.leadId ? { id: r.leadId, ref: r.leadRef ?? "", erased: r.leadErased } : null,
          accountLeads: r.accountLeads,
        })),
      };
    },
  };
}

export const leadMutations: Record<string, Mutation> = {
  /** B3 step 6. */
  "admin/leads.changeStage": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(changeStageBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const result = await changeStage(env.db, actor as Actor, parsed.value);
      return result.kind === "ok" ? jsonResponse({ changed: true, version: result.version, from: result.from }) : missResponse(result, requestId);
    },
  },

  /** B3 step 7. Only a staff member can be assigned. */
  "admin/leads.assign": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(assignBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const caller = actor as Actor;
      if (parsed.value.adminId !== null) {
        const { byId } = await staffPeople(env, caller);
        if (!byId.has(parsed.value.adminId)) return errorResponseFor("VALIDATION", "That person is not on the team.", requestId, { fields: { adminId: "UNKNOWN_VALUE" } });
      }
      const result = await assignLead(env.db, caller, parsed.value);
      return result.kind === "ok" ? jsonResponse({ changed: true, version: result.version }) : missResponse(result, requestId);
    },
  },

  /** B3 step 8. */
  "admin/leads.addNote": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(addNoteBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const result = await addNote(env.db, actor as Actor, parsed.value);
      if (result.kind === "ok") return jsonResponse({ id: result.noteId }, 201);
      return missResponse(result, requestId);
    },
  },

  /** B3 step 5: one tap, no form. */
  "admin/leads.logReply": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(leadIdBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const result = await logReply(env.db, actor as Actor, parsed.value.leadId);
      if (result.kind === "ok") return jsonResponse({ first: result.first, version: result.version });
      return missResponse(result, requestId);
    },
  },

  /** B3 step 3. */
  "admin/leads.logAdminWhatsAppOpen": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(leadIdBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const result = await logAdminWhatsAppOpen(env.db, actor as Actor, parsed.value.leadId);
      return result.kind === "ok" ? jsonResponse({ logged: true }) : missResponse(result, requestId);
    },
  },

  /** B3 step 10: merge or "not a duplicate". Never automatic. */
  "admin/leads.resolveDuplicate": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(resolveDuplicateBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await resolveDuplicate(env.db, actor as Actor, parsed.value.keepId, parsed.value.otherId, parsed.value.decision);
      switch (outcome) {
        case "merged":
        case "dismissed":
          return jsonResponse({ outcome });
        case "not_found":
          return errorResponseFor("NOT_FOUND", "That lead does not exist.", requestId);
        case "already_decided":
          return errorResponseFor("CONFLICT", "Someone already decided on these two leads. Reload.", requestId, { fields: { pair: "ALREADY_DECIDED" } });
        case "not_a_pair":
          return errorResponseFor("CONFLICT", "These are no longer a possible duplicate. Reload.", requestId, { fields: { pair: "NOT_A_PAIR" } });
      }
    },
  },

  /** B4 steps 2 and 3. Approval is refused without a verification method, by the schema and again by the database. */
  "admin/leads.decideClaim": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(decideClaimBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const input = parsed.value;
      const { outcome, leadId } = await decideClaim(
        env.db,
        actor as Actor,
        input.claimId,
        input.decision === "approve" ? { decision: "approve", verificationMethod: input.verificationMethod } : { decision: "reject", reason: input.reason },
      );
      switch (outcome) {
        case "approved":
        case "rejected":
          return jsonResponse({ outcome, leadId });
        case "not_found":
          return errorResponseFor("NOT_FOUND", "That request does not exist.", requestId);
        case "not_pending":
          return errorResponseFor("CONFLICT", "Someone already decided on this request. Reload.", requestId, { fields: { claim: "NOT_PENDING" } });
        case "method_required":
          return errorResponseFor("VALIDATION", "Say how you verified the student.", requestId, { fields: { verificationMethod: "REQUIRED" } });
        case "email_mismatch":
          return errorResponseFor("CONFLICT", "The student's verified email does not match the lead's email.", requestId, { fields: { verificationMethod: "EMAIL_MISMATCH" } });
        case "lead_unavailable":
          return errorResponseFor("CONFLICT", "That lead was erased or merged and cannot be linked.", requestId, { fields: { lead: "UNAVAILABLE" } });
        case "already_linked":
          return errorResponseFor("CONFLICT", "That lead already belongs to another account.", requestId, { fields: { lead: "ALREADY_LINKED" } });
      }
    },
  },

  /** B3 step 11 and B5 step 3: erase a person's data after the identity checklist. One transaction. */
  "admin/leads.eraseLead": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(eraseLeadBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await eraseLead(env.db, actor as Actor, {
        leadId: parsed.value.leadId,
        identityConfirmed: parsed.value.identityConfirmed,
        dataRequestId: parsed.value.dataRequestId ?? null,
      });
      switch (outcome) {
        case "erased":
          return jsonResponse({ erased: true });
        case "not_found":
          return errorResponseFor("NOT_FOUND", "That lead does not exist.", requestId);
        case "already_erased":
          return errorResponseFor("CONFLICT", "This lead was already erased.", requestId, { fields: { lead: "ALREADY_ERASED" } });
        case "identity_not_confirmed":
          return errorResponseFor("VALIDATION", "Confirm the student's identity first.", requestId, { fields: { identityConfirmed: "REQUIRED" } });
        case "request_mismatch":
          return errorResponseFor("CONFLICT", "That data request is not an open erasure request for this lead. Reload.", requestId, { fields: { dataRequestId: "MISMATCH" } });
      }
    },
  },

  /** B5 step 2. */
  "admin/dataRequests.log": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(logDataRequestBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const result = await logDataRequest(env.db, actor as Actor, parsed.value);
      if (result.kind === "ok") return jsonResponse({ id: result.id }, 201);
      if (result.kind === "lead_not_found") return errorResponseFor("NOT_FOUND", "No lead has that reference.", requestId, { fields: { leadRef: "NOT_FOUND" } });
      return errorResponseFor("CONFLICT", "That lead was already erased.", requestId, { fields: { leadRef: "ALREADY_ERASED" } });
    },
  },

  /** B5 step 4. */
  "admin/dataRequests.complete": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(completeDataRequestBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await completeDataRequest(env.db, actor as Actor, parsed.value.id);
      switch (outcome) {
        case "done":
          return jsonResponse({ done: true });
        case "not_found":
          return errorResponseFor("NOT_FOUND", "That request does not exist.", requestId);
        case "not_open":
          return errorResponseFor("CONFLICT", "That request is already closed. Reload.", requestId);
        case "erase_first":
          return errorResponseFor("CONFLICT", "Run the erasure first: it completes the request.", requestId, { fields: { id: "ERASE_FIRST" } });
      }
    },
  },
};
