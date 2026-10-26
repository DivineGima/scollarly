import { errorResponseFor, jsonResponse, newRequestId, validationErrorResponse } from "@/lib/http";
import { uuidv7 } from "@/lib/uuid";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { IngestError, ingestImage } from "@/server/media/ingest";
import { MediaStoreError } from "@/server/media/store";
import {
  changeStatus,
  changedFields,
  createConsent,
  createContent,
  getContent,
  getFormOptions,
  hubCounts,
  listContent,
  markChecked,
  revokeConsent,
  staleItems,
  updateContent,
  type StatusAction,
  type WriteOutcome,
} from "@/server/repositories/content-admin";
import { archiveMedia, findMediaIdAs, insertMediaAs, mediaBudget, mediaOverview, mediaUses, setMediaAlt } from "@/server/repositories/media-admin";
import type { ContentArea } from "@/modules/content/tags";
import { type ContentTypeKey, TYPE_DEFS, type TypeDef } from "./definitions";
import {
  consentCreateBody,
  consentRevokeBody,
  type GateIssues,
  itemQuery,
  listQuery,
  markCheckedBody,
  mediaAltBody,
  mediaArchiveBody,
  mediaItemQuery,
  publishIssues,
  saveBodyFor,
  saveIssues,
  statusBody,
  typeOnlyBody,
  typeQuery,
  uploadQuery,
} from "./schema";

/**
 * The content screens (S6.1 to S6.5; architecture 8.3, 10.4, 10.5, 16 B6 to B8): plain data calls and mutations in the Worker
 * entry (ADR-040). Staff only: the facade has checked that before any of this runs and row level security checks it again. A
 * mutation validates its body with the same Zod definitions the form uses, runs the publish gates, calls one repository
 * function (one statement) and answers with what the screen must refresh on the public site (`revalidate`, S6.4).
 *
 * Operation names follow architecture 8.3. Four operations are variants of a listed one and use its permission:
 * `content.markChecked` and `consent.create` are `content.save`, `consent.revoke` is `content.unpublish`, `media.setAlt` is `media.upload`.
 */

/** A photo is at most 300 KB (FR-18); the upload is read up to a little more so the cap message can be exact. */
const MAX_UPLOAD_BYTES = 400 * 1024;

export interface Revalidate {
  areas: ContentArea[];
  paths: string[];
}

/** What the public site must refresh after a change to `def`: its areas, its list pages and the page of the item itself. */
export function revalidationFor(def: TypeDef, slug: string | null): Revalidate {
  const paths = new Set<string>(def.pages);
  if (slug) {
    if (def.publicPath) paths.add(`${def.publicPath.prefix}/${slug}`);
    else if (def.fields.some((f) => f.key === "universityId")) paths.add(`/universities/${slug}`);
  }
  return { areas: [...def.areas], paths: [...paths] };
}

/** Alt text is shown wherever its image is, so a change to it refreshes every area and list page of a type that has a picture. */
function mediaRevalidation(): Revalidate {
  const withPictures = Object.values(TYPE_DEFS).filter((def) => def.fields.some((f) => f.kind === "media"));
  return { areas: [...new Set(withPictures.flatMap((def) => def.areas))], paths: [...new Set(withPictures.flatMap((def) => def.pages))] };
}

const invalid = () => errorResponseFor("VALIDATION", "Check the filters.", newRequestId());

function writeFailure(outcome: Exclude<WriteOutcome, { kind: "ok" }>, requestId: string): Response {
  switch (outcome.kind) {
    case "conflict":
      return errorResponseFor("CONFLICT", "This item changed. Reload.", requestId, { fields: { version: "STALE" } });
    case "archived":
      return errorResponseFor("CONFLICT", "This item is archived. Restore it first.", requestId, { fields: { status: "ARCHIVED" } });
    case "not_found":
      return errorResponseFor("NOT_FOUND", "That item does not exist.", requestId);
    case "duplicate":
      return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields: { [`values.${outcome.field}`]: "DUPLICATE" } });
    case "gate":
      return gateResponse(outcome.issues, requestId);
  }
}

/** A failed gate or rule: the `fields` name each field and the reason, as the form shows them. `values.` is the path in the save body. */
function gateResponse(issues: GateIssues, requestId: string): Response {
  const fields = Object.fromEntries(Object.entries(issues).map(([key, token]) => [key === "steps" || key === "form" ? key : `values.${key}`, token]));
  return errorResponseFor("VALIDATION", "Check the highlighted fields.", requestId, { fields });
}

const defOf = (type: ContentTypeKey) => TYPE_DEFS[type];

export function contentDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** B6: one card per type, with its counts and warnings, and the image meter. */
    "admin/content-hub": async (actor) => {
      const [cards, budget] = await Promise.all([hubCounts(env.db, actor), mediaBudget(env.db, actor)]);
      return { cards, media: budget };
    },

    /** B6 step 1: a list with search and status chips. */
    "admin/content-list": async (actor, call) => {
      const parsed = listQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid();
      const q = parsed.data;
      const list = await listContent(env.db, actor, defOf(q.type), { ...(q.status ? { status: q.status } : {}), ...(q.q ? { q: q.q } : {}) });
      return { type: q.type, ...list };
    },

    /** B6 steps 2 to 7: one item (or an empty form when no id is given) and the choices its reference fields offer. */
    "admin/content-item": async (actor, call) => {
      const raw = Object.fromEntries(call.url.searchParams);
      const parsed = raw.id === undefined ? typeQuery.safeParse(raw) : itemQuery.safeParse(raw);
      if (!parsed.success) return invalid();
      const def = defOf(parsed.data.type);
      const id = raw.id === undefined ? null : (parsed.data as unknown as { id: string }).id;
      const [item, options] = await Promise.all([id ? getContent(env.db, actor, def, id) : Promise.resolve(null), getFormOptions(env.db, actor, def)]);
      if (id && !item) return errorResponseFor("NOT_FOUND", "That item does not exist.", newRequestId());
      return { type: parsed.data.type, item, options };
    },

    /** B7: the image grid, its sizes and the meter against the budget. */
    "admin/media": async (actor) => mediaOverview(env.db, actor),

    /** B7 step 3: where one image is used. */
    "admin/media-item": async (actor, call) => {
      const parsed = mediaItemQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid();
      return { uses: await mediaUses(env.db, actor, parsed.data.id) };
    },

    /** B8: fees and links that are overdue for a check. */
    "admin/stale": async (actor) => ({ items: await staleItems(env.db, actor) }),
  };
}

function ok(outcome: Extract<WriteOutcome, { kind: "ok" }>, def: TypeDef, status = 200): Response {
  const revalidate = outcome.status === "published" ? revalidationFor(def, outcome.slug) : null;
  return jsonResponse({ id: outcome.id, version: outcome.version, status: outcome.status, revalidate }, status);
}

/** Runs one of the four status changes, with the publish gates on `publish`. The gates read the stored row, never the screen's copy. */
async function transition(env: EndpointEnv, actor: Actor, body: unknown, requestId: string, action: StatusAction): Promise<Response> {
  const parsed = parseBody(statusBody, body, requestId);
  if (!parsed.ok) return parsed.response;
  const def = defOf(parsed.value.type);
  if (action === "publish") {
    const current = await getContent(env.db, actor, def, parsed.value.id);
    if (!current) return errorResponseFor("NOT_FOUND", "That item does not exist.", requestId);
    const issues = publishIssues(def, current.values, { consentRevoked: current.consentRevoked });
    if (Object.keys(issues).length > 0) return gateResponse(issues, requestId);
  }
  const outcome = await changeStatus(env.db, actor, def, { id: parsed.value.id, version: parsed.value.version }, action);
  if (outcome.kind !== "ok") return writeFailure(outcome, requestId);
  // Leaving the public site (unpublish, archive) changes it too, so the revalidation is asked for whenever the item WAS public.
  const leftPublic = action === "unpublish" || action === "archive";
  return leftPublic ? jsonResponse({ id: outcome.id, version: outcome.version, status: outcome.status, revalidate: revalidationFor(def, outcome.slug) }) : ok(outcome, def);
}

const staff = { kind: "role", role: "admin" } as const;

export const contentMutations: Record<string, Mutation> = {
  /** B6 steps 3 to 5: create a draft, or save changes to an item. Saving a live item changes the live page, so it is gated like a publish. */
  "admin/content.save": {
    access: staff,
    async handle({ actor, env, body, requestId }) {
      const typed = typeOnlyBody.safeParse(body);
      if (!typed.success) return validationErrorResponse(typed.error.issues, requestId);
      const def = defOf(typed.data.type);
      const parsed = parseBody(saveBodyFor(def), body, requestId);
      if (!parsed.ok) return parsed.response;
      const input = parsed.value;
      const caller = actor as Actor;
      const steps = input.steps;

      if (input.id === undefined) {
        const issues = saveIssues(def, input.values);
        if (Object.keys(issues).length > 0) return gateResponse(issues, requestId);
        const outcome = await createContent(env.db, caller, def, { id: null, version: null, newId: uuidv7(), values: input.values, ...(steps ? { steps } : {}) });
        return outcome.kind === "ok" ? ok(outcome, def, 201) : writeFailure(outcome, requestId);
      }

      const id = input.id;
      const version = input.version as string;
      const current = await getContent(env.db, caller, def, id);
      if (!current) return errorResponseFor("NOT_FOUND", "That item does not exist.", requestId);
      if (current.status === "archived") return writeFailure({ kind: "archived", version: current.version }, requestId);
      // A slug or a key is part of an address, so it never changes after the item exists.
      const moved = def.fields.find((f) => f.immutable && (input.values[f.key] ?? null) !== (current.values[f.key] ?? null));
      if (moved) return gateResponse({ [moved.key]: "IMMUTABLE" }, requestId);
      if (def.steps && steps && steps.length < current.steps.length) return gateResponse({ steps: "STEPS_CANNOT_SHRINK" }, requestId);
      // A live item is checked against the publish gates again, so an edit cannot quietly break what the visitor sees.
      const issues = current.status === "published" ? publishIssues(def, input.values, { consentRevoked: current.consentRevoked }) : saveIssues(def, input.values);
      if (Object.keys(issues).length > 0) return gateResponse(issues, requestId);

      const outcome = await updateContent(env.db, caller, def, { id, version, newId: id, values: input.values, ...(steps ? { steps } : {}) }, changedFields(def, current.values, input.values));
      return outcome.kind === "ok" ? ok(outcome, def) : writeFailure(outcome, requestId);
    },
  },

  /** B6 steps 6 and 7: "Publish". The gates are listed back to the form when one fails. */
  "admin/content.publish": { access: staff, handle: ({ actor, env, body, requestId }) => transition(env, actor as Actor, body, requestId, "publish") },
  /** B6 step 8. */
  "admin/content.unpublish": { access: staff, handle: ({ actor, env, body, requestId }) => transition(env, actor as Actor, body, requestId, "unpublish") },
  "admin/content.archive": { access: staff, handle: ({ actor, env, body, requestId }) => transition(env, actor as Actor, body, requestId, "archive") },
  "admin/content.restore": { access: staff, handle: ({ actor, env, body, requestId }) => transition(env, actor as Actor, body, requestId, "restore") },

  /** B8 step 3: "Mark checked". */
  "admin/content.markChecked": {
    access: staff,
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(markCheckedBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const def = defOf(parsed.value.type);
      if (!def.stale) return errorResponseFor("VALIDATION", "This type has nothing to check.", requestId, { fields: { type: "UNKNOWN_VALUE" } });
      const outcome = await markChecked(env.db, actor as Actor, def, { id: parsed.value.id, version: parsed.value.version });
      return outcome.kind === "ok" ? ok(outcome, def) : writeFailure(outcome, requestId);
    },
  },

  /** B6 per-content: "Add consent record". */
  "admin/consent.create": {
    access: staff,
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(consentCreateBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const id = uuidv7();
      await createConsent(env.db, actor as Actor, { id, ...parsed.value });
      return jsonResponse({ id }, 201);
    },
  },

  /** FR-13: revoking a consent takes what depended on it off the site. */
  "admin/consent.revoke": {
    access: staff,
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(consentRevokeBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await revokeConsent(env.db, actor as Actor, parsed.value.id);
      if (outcome.kind === "not_found") return errorResponseFor("NOT_FOUND", "That consent record does not exist.", requestId);
      if (outcome.kind === "already_revoked") return errorResponseFor("CONFLICT", "This consent was already revoked. Reload.", requestId, { fields: { consent: "ALREADY_REVOKED" } });
      return jsonResponse({ unpublished: outcome.unpublished, revalidate: { areas: ["trust"], paths: [...TYPE_DEFS.testimonials.pages] } satisfies Revalidate });
    },
  },

  /** B7 steps 2 and S6.3: the browser sends a WebP it made; the server re-checks size, signature and kind, and stores it under its hash. */
  "admin/media.upload": {
    access: staff,
    binary: { maxBytes: MAX_UPLOAD_BYTES },
    async handle({ actor, env, request, bytes, requestId }) {
      const parsed = uploadQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return validationErrorResponse(parsed.error.issues, requestId);
      const query = parsed.data;
      // A photo of a document (an offer letter) is uploaded only after the person confirmed they blurred the personal details.
      if (query.document === "1" && query.confirmed !== "1") return errorResponseFor("VALIDATION", "Confirm the blur first.", requestId, { fields: { confirmed: "REQUIRED" } });
      if (!bytes || bytes.byteLength === 0) return errorResponseFor("VALIDATION", "Choose an image.", requestId, { fields: { file: "EMPTY" } });
      const store = env.media?.();
      if (!store) throw new Error("The image store is not configured");

      const caller = actor as Actor;
      try {
        const result = await ingestImage(
          {
            store,
            findIdBySha256: (sha256) => findMediaIdAs(env.db, caller, sha256),
            insert: (row) => insertMediaAs(env.db, caller, row, { document: query.document === "1" }),
            newId: uuidv7,
            guard: async ({ bytes: size }) => {
              const budget = await mediaBudget(env.db, caller);
              if (budget.usedBytes + size > budget.budgetBytes) throw new BudgetFull();
            },
          },
          { bytes, kind: query.kind, ...(query.alt ? { alt: query.alt } : {}) },
        );
        return jsonResponse({ id: result.id, sha256: result.sha256, width: result.width, height: result.height, bytes: result.bytes, status: result.status }, result.status === "created" ? 201 : 200);
      } catch (error) {
        if (error instanceof IngestError) {
          const tooLarge = error.code === "TOO_LARGE";
          return errorResponseFor(tooLarge ? "PAYLOAD_TOO_LARGE" : "VALIDATION", error.message, requestId, { fields: { file: error.code } });
        }
        if (error instanceof BudgetFull) return errorResponseFor("CONFLICT", "The image storage is full.", requestId, { fields: { file: "BUDGET_FULL" } });
        if (error instanceof MediaStoreError) return errorResponseFor("TEMPORARILY_UNAVAILABLE", "Image storage is not reachable.", requestId, { headers: { "Retry-After": "10" } });
        throw error;
      }
    },
  },

  /** B7 step 3. */
  "admin/media.setAlt": {
    access: staff,
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(mediaAltBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const done = await setMediaAlt(env.db, actor as Actor, parsed.value.id, parsed.value.alt);
      return done ? jsonResponse({ saved: true, revalidate: mediaRevalidation() }) : errorResponseFor("NOT_FOUND", "That image does not exist.", requestId);
    },
  },

  /** B7 step 4: blocked while a live item uses the image, with the list. */
  "admin/media.archive": {
    access: staff,
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(mediaArchiveBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await archiveMedia(env.db, actor as Actor, parsed.value.id);
      switch (outcome.kind) {
        case "ok":
          return jsonResponse({ archived: true });
        case "in_use":
          return jsonResponse({ error: { code: "CONFLICT", message: "This image is in use.", fields: { media: "IN_USE" } }, request_id: requestId, uses: outcome.uses }, 409);
        case "not_found":
          return errorResponseFor("NOT_FOUND", "That image does not exist.", requestId);
        case "already_archived":
          return errorResponseFor("CONFLICT", "This image is already archived. Reload.", requestId, { fields: { media: "ALREADY_ARCHIVED" } });
      }
    },
  },
};

class BudgetFull extends Error {
  constructor() {
    super("The image storage budget is full.");
    this.name = "BudgetFull";
  }
}
