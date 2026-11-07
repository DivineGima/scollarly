import { errorResponseFor, jsonResponse, newRequestId } from "@/lib/http";
import { uuidv7 } from "@/lib/uuid";
import type { Actor } from "@/server/auth/actor";
import type { DataCall } from "@/server/edge/authed";
import type { EndpointEnv } from "@/server/edge/endpoint-env";
import type { Mutation } from "@/server/edge/mutations";
import { parseBody } from "@/server/edge/validate";
import { logError } from "@/server/log";
import { documentKey, type DocumentStore } from "@/server/media/documents";
import {
  createPendingDocument,
  createPendingLetter,
  discardPending,
  discardPendingLetter,
  findOwnPending,
  findPendingLetter,
  keyToOpen,
  listDocuments,
  markLetterUploaded,
  markUploaded,
  reviewDocument,
} from "@/server/repositories/documents";
import { checkContent, SIGNATURE_BYTES } from "./signature";
import { approveProofBody, confirmBody, idQuery, reviewBody, signBody, signLetterBody, studentQuery } from "./schema";

/**
 * Student documents (S17.1; architecture 24.5, ADR-066, ADR-067). The route is the one the Stage 17 probe chose (tracker_5 F42): the phone
 * sends the file straight to private storage with a link this file signs, then asks the Worker to check it. So a 5 MB upload costs the Worker
 * two small calls and no file bytes. Nothing about a document (its link, its name, its content) is logged.
 */

const unavailable = () => errorResponseFor("TEMPORARILY_UNAVAILABLE", "Please try again shortly.", newRequestId(), { headers: { "Retry-After": "30" } });
const invalid = (fields: Record<string, string>) => errorResponseFor("VALIDATION", "Check the request.", newRequestId(), { fields });

/** The store, or null when storage is not configured here (a test, a preview). */
function storeOf(env: EndpointEnv): DocumentStore | null {
  try {
    return env.documents ? env.documents() : null;
  } catch {
    return null;
  }
}

/** The no-store answer a link goes out in: a link must never be kept by a cache. */
function linkResponse(link: { url: string; expiresInSeconds: number }): Response {
  const response = jsonResponse(link);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function openLink(env: EndpointEnv, actor: Actor, id: string, audit: boolean): Promise<Response> {
  const store = storeOf(env);
  if (!store) return unavailable();
  const key = await keyToOpen(env.db, actor, id, audit);
  if (!key) return errorResponseFor("NOT_FOUND", "That document does not exist.", newRequestId());
  return linkResponse(await store.signDownload(key));
}

export const documentMutations: Record<string, Mutation> = {
  /** The student asks to upload one document: a row is made (pending) and a short link to send the file to is returned. */
  "me/documents.sign": {
    access: { kind: "signed-in" },
    async handle({ actor, env, body, requestId }) {
      const me = actor as Actor;
      if (me.role !== "student") return errorResponseFor("FORBIDDEN", "Not allowed.", requestId);
      const parsed = parseBody(signBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const store = storeOf(env);
      if (!store) return unavailable();

      const id = uuidv7(env.now().getTime());
      const key = documentKey(me.userId, id);
      const outcome = await createPendingDocument(env.db, me, { id, kind: parsed.value.kind, contentType: parsed.value.contentType, byteSize: parsed.value.byteSize, key, applicationId: null });
      if (outcome.kind === "already_approved") return errorResponseFor("CONFLICT", "This document was already approved.", requestId, { fields: { kind: "ALREADY_APPROVED" } });

      // A copy the student replaced is deleted from storage. If that fails the row is already put aside, so the file is only an orphan the
      // purge cannot see; it is logged as a count, never with a key.
      for (const old of outcome.replacedKeys) {
        await store.deleteObject(old).catch((error: unknown) => logError(requestId, "me/documents.sign", error));
      }
      const signed = await store.signUpload(key, parsed.value.contentType);
      const response = jsonResponse({ id, url: signed.url, headers: signed.headers, expiresInSeconds: signed.expiresInSeconds }, 201);
      response.headers.set("Cache-Control", "no-store");
      return response;
    },
  },

  /**
   * The phone says the file is sent. The Worker looks at the object (size, first bytes), and only then does the document count. A file that
   * fails is deleted and the student is told which check it failed, so the one file can be tried again on its own. Safe to repeat.
   */
  "me/documents.confirm": {
    access: { kind: "signed-in" },
    async handle({ actor, env, body, requestId }) {
      const me = actor as Actor;
      const parsed = parseBody(confirmBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const store = storeOf(env);
      if (!store) return unavailable();

      const pending = await findOwnPending(env.db, me, parsed.value.id);
      if (!pending) {
        // Already confirmed (a second tap or a retry): say so instead of an error.
        const mine = await listDocuments(env.db, me, me.userId);
        const doc = mine.find((d) => d.id === parsed.value.id);
        return doc && doc.state !== "pending" ? jsonResponse({ id: doc.id, state: doc.state }) : errorResponseFor("NOT_FOUND", "That upload does not exist.", requestId);
      }

      const stored = await store.head(pending.key);
      if (!stored) return errorResponseFor("CONFLICT", "The file has not arrived yet.", requestId, { fields: { file: "MISSING" } });
      const head = await store.readHead(pending.key, SIGNATURE_BYTES);
      const verdict = checkContent({ declaredType: pending.contentType, declaredSize: pending.byteSize, actualSize: stored.size, head: head ?? new Uint8Array() });
      if (!verdict.ok) {
        await store.deleteObject(pending.key).catch((error: unknown) => logError(requestId, "me/documents.confirm", error));
        await discardPending(env.db, me, parsed.value.id);
        return invalid({ file: verdict.reason.toUpperCase() });
      }
      if (!(await markUploaded(env.db, me, parsed.value.id))) return errorResponseFor("CONFLICT", "That upload changed. Try again.", requestId);
      return jsonResponse({ id: parsed.value.id, state: "uploaded" });
    },
  },

  /** The manager (or an admin) approves a file or asks for a clearer one. */
  "admin/documents.review": {
    access: { kind: "role", role: "manager" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(reviewBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await reviewDocument(env.db, actor as Actor, { id: parsed.value.id, decision: parsed.value.decision, note: parsed.value.note ?? null });
      if (outcome === "not_found") return errorResponseFor("NOT_FOUND", "That document does not exist.", requestId);
      if (outcome === "not_allowed") return errorResponseFor("FORBIDDEN", "Only the admin reviews a proof of payment.", requestId);
      if (outcome === "not_reviewable") return errorResponseFor("CONFLICT", "That document was already reviewed. Reload the page.", requestId);
      return jsonResponse({ id: parsed.value.id, state: parsed.value.decision });
    },
  },

  /** The admin approves the student's proof of payment (FR-46). The Momo details never pass through the app; this only records that the proof was seen. */
  "admin/payments.proofApprove": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(approveProofBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const outcome = await reviewDocument(env.db, actor as Actor, { id: parsed.value.id, decision: "approved", note: null, onlyKind: "payment_proof" });
      if (outcome === "not_found") return errorResponseFor("NOT_FOUND", "That proof of payment does not exist.", requestId);
      if (outcome === "not_allowed") return errorResponseFor("FORBIDDEN", "Only the admin reviews a proof of payment.", requestId);
      if (outcome !== "ok") return errorResponseFor("CONFLICT", "That proof was already reviewed. Reload the page.", requestId);
      return jsonResponse({ id: parsed.value.id, state: "approved" });
    },
  },

  /** The admin asks to upload a letter (a PDF) for a student: a link to send the file to, the same route as a student's upload. */
  "admin/documents.sign": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const parsed = parseBody(signLetterBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const store = storeOf(env);
      if (!store) return unavailable();
      const id = uuidv7(env.now().getTime());
      let key: string;
      try {
        key = documentKey(parsed.value.studentId, id);
      } catch {
        return invalid({ studentId: "INVALID" });
      }
      const made = await createPendingLetter(env.db, actor as Actor, { id, studentId: parsed.value.studentId, kind: parsed.value.kind, byteSize: parsed.value.byteSize, key });
      if (!made) return errorResponseFor("NOT_FOUND", "That student does not exist.", requestId);
      const signed = await store.signUpload(key, "application/pdf");
      const response = jsonResponse({ id, url: signed.url, headers: signed.headers, expiresInSeconds: signed.expiresInSeconds }, 201);
      response.headers.set("Cache-Control", "no-store");
      return response;
    },
  },

  /** The letter is sent: the Worker checks it (a PDF of the size declared) and only then does it count. A file that fails is deleted. Safe to repeat. */
  "admin/documents.confirm": {
    access: { kind: "role", role: "admin" },
    async handle({ actor, env, body, requestId }) {
      const admin = actor as Actor;
      const parsed = parseBody(confirmBody, body, requestId);
      if (!parsed.ok) return parsed.response;
      const store = storeOf(env);
      if (!store) return unavailable();
      const pending = await findPendingLetter(env.db, admin, parsed.value.id);
      if (!pending) return errorResponseFor("NOT_FOUND", "That upload does not exist or is already confirmed.", requestId);
      const stored = await store.head(pending.key);
      if (!stored) return errorResponseFor("CONFLICT", "The file has not arrived yet.", requestId, { fields: { file: "MISSING" } });
      const head = await store.readHead(pending.key, SIGNATURE_BYTES);
      const verdict = checkContent({ declaredType: pending.contentType, declaredSize: pending.byteSize, actualSize: stored.size, head: head ?? new Uint8Array() });
      if (!verdict.ok) {
        await store.deleteObject(pending.key).catch((error: unknown) => logError(requestId, "admin/documents.confirm", error));
        await discardPendingLetter(env.db, admin, parsed.value.id);
        return invalid({ file: verdict.reason.toUpperCase() });
      }
      if (!(await markLetterUploaded(env.db, admin, parsed.value.id))) return errorResponseFor("CONFLICT", "That upload changed. Try again.", requestId);
      return jsonResponse({ id: parsed.value.id, state: "uploaded" });
    },
  },
};

export function documentDataCalls(env: EndpointEnv): Record<string, DataCall> {
  return {
    /** The student's own documents and their states. */
    "me/documents": async (actor) => ({ documents: await listDocuments(env.db, actor, actor.userId) }),

    /** A five-minute link to one of the student's own files (a letter they were sent). Not audited: it is their own. */
    "me/document-link": async (actor, call) => {
      const parsed = idQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid({ id: "INVALID" });
      return openLink(env, actor, parsed.data.id, false);
    },

    /** A student's documents for the staff screen. Row level security limits a manager to the students assigned to them. */
    "admin/student-documents": async (actor, call) => {
      const parsed = studentQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid({ studentId: "INVALID" });
      return { documents: await listDocuments(env.db, actor, parsed.data.studentId) };
    },

    /** A five-minute link for staff. Opening a file writes an audit row in the same statement. */
    "admin/document-link": async (actor, call) => {
      const parsed = idQuery.safeParse(Object.fromEntries(call.url.searchParams));
      if (!parsed.success) return invalid({ id: "INVALID" });
      return openLink(env, actor, parsed.data.id, true);
    },
  };
}
