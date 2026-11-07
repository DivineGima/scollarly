import { sql } from "drizzle-orm";
import { uuidv7 } from "@/lib/uuid";
import type { DocumentKind } from "@/lib/constants";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import { runAs } from "./as-actor";

/**
 * Student documents (architecture 24.2, 24.5, migration 0024). The file is in the private bucket; this table holds the key, the kind, the size
 * and the state. Row level security decides who sees a row (the student their own, an admin all, a manager the students assigned to them) and a
 * trigger decides which state changes are allowed, so these functions only ask. The storage key never leaves the server.
 */

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  state: "pending" | "uploaded" | "approved" | "rejected";
  contentType: string;
  byteSize: number;
  rejectionNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

interface RawDocument {
  id: string;
  kind: DocumentKind;
  state: DocumentView["state"];
  content_type: string;
  byte_size: number;
  rejection_note: string | null;
  created_at: string | Date;
  reviewed_at: string | Date | null;
}

const toView = (r: RawDocument): DocumentView => ({
  id: r.id,
  kind: r.kind,
  state: r.state,
  contentType: r.content_type,
  byteSize: r.byte_size,
  rejectionNote: r.rejection_note,
  createdAt: new Date(r.created_at),
  reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
});

/** The kinds a student supplies once each; a new upload replaces a pending or uploaded one. The proof of payment may be sent again. */
const ONE_LIVE_KINDS: ReadonlySet<string> = new Set(["results", "id", "birth_certificate", "signature", "passport"]);

function mentions(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes(constraint)) return true;
    current = current.cause;
  }
  return false;
}

export type CreatePendingOutcome = { kind: "ok"; replacedKeys: string[] } | { kind: "already_approved" };

/**
 * The student asks to upload. In one transaction: the copy they had (pending or uploaded) is put aside and the new row is made, pending. The keys
 * of the replaced files come back so the caller can delete the objects. An approved copy is not replaced: the unique index refuses it.
 */
export async function createPendingDocument(
  db: Db,
  actor: Actor,
  input: { id: string; kind: DocumentKind; contentType: string; byteSize: number; key: string; applicationId: string | null },
): Promise<CreatePendingOutcome> {
  const replace = ONE_LIVE_KINDS.has(input.kind);
  // Two signs of one kind at once (a double tap, two tabs) both pass the "nothing live" check and the second hits the unique index. That is not an
  // approved document: only an approved row is. After a collision the second attempt replaces the first one's pending row.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await insertPending(db, actor, input, replace);
    } catch (error) {
      if (!mentions(error, "student_document_one_live_per_kind")) throw error;
      if (await hasApproved(db, actor, input.kind)) return { kind: "already_approved" };
      if (attempt >= 1) throw error;
    }
  }
}

async function hasApproved(db: Db, actor: Actor, kind: DocumentKind): Promise<boolean> {
  const [result] = await runAs(db, actor, db.execute(sql`select 1 from student_document where student_id = ${actor.userId} and kind = ${kind} and state = 'approved' limit 1`));
  return rowsOf(result).length > 0;
}

async function insertPending(
  db: Db,
  actor: Actor,
  input: { id: string; kind: DocumentKind; contentType: string; byteSize: number; key: string; applicationId: string | null },
  replace: boolean,
): Promise<CreatePendingOutcome> {
  {
    const [replaced] = await runAs(
      db,
      actor,
      db.execute(sql`
        with old as (
          select id, storage_key from student_document
           where ${replace}::boolean and student_id = ${actor.userId} and kind = ${input.kind} and state in ('pending', 'uploaded')
        ), put_aside as (
          update student_document d set state = 'purged', storage_key = null from old where d.id = old.id
          returning old.storage_key
        ), ins as (
          insert into student_document (id, student_id, application_id, kind, storage_key, content_type, byte_size, state)
          values (${input.id}::uuid, ${actor.userId}, ${input.applicationId}::uuid, ${input.kind}, ${input.key}, ${input.contentType}, ${input.byteSize}, 'pending')
          returning id
        )
        select storage_key from put_aside`),
    );
    return { kind: "ok", replacedKeys: rowsOf<{ storage_key: string | null }>(replaced).flatMap((r) => (r.storage_key ? [r.storage_key] : [])) };
  }
}

/** The student's own pending upload, for the check after the browser has sent the file. Null when it is not theirs or not pending. */
export async function findOwnPending(db: Db, actor: Actor, id: string): Promise<{ key: string; contentType: string; byteSize: number } | null> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select storage_key, content_type, byte_size from student_document
       where id = ${id}::uuid and student_id = ${actor.userId} and state = 'pending' and storage_key is not null`),
  );
  const row = rowsOf<{ storage_key: string; content_type: string; byte_size: number }>(result)[0];
  return row ? { key: row.storage_key, contentType: row.content_type, byteSize: row.byte_size } : null;
}

/** The file is in storage and passed the content check: it now counts. False when the row was no longer pending. */
export async function markUploaded(db: Db, actor: Actor, id: string): Promise<boolean> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`update student_document set state = 'uploaded' where id = ${id}::uuid and student_id = ${actor.userId} and state = 'pending' returning id`),
  );
  return rowsOf(result).length > 0;
}

/** The file failed the check (or never arrived): the row is put aside and its key forgotten. */
export async function discardPending(db: Db, actor: Actor, id: string): Promise<void> {
  await runAs(
    db,
    actor,
    db.execute(sql`update student_document set state = 'purged', storage_key = null where id = ${id}::uuid and student_id = ${actor.userId} and state = 'pending'`),
  );
}

/**
 * The same list as `listDocuments`, for the lead screen's single round trip: the student is taken from the lead through a sub-select, so it needs no
 * read of its own. The caller runs it inside `runAs` with its other statements and maps the result with `documentViews`.
 */
export function documentsOfLeadQuery(db: Db, leadId: string) {
  return db.execute(sql`
    select id, kind, state, content_type, byte_size, rejection_note, created_at, reviewed_at
      from student_document
     where student_id = (select user_id from lead where id = ${leadId}::uuid) and state in ('pending', 'uploaded', 'approved', 'rejected')
     order by created_at, id`);
}

export const documentViews = (result: unknown): DocumentView[] => rowsOf<RawDocument>(result).map(toView);

/** What a screen shows about a student's documents (no key). Row level security scopes it: a student sees their own, a manager their students'. */
export async function listDocuments(db: Db, actor: Actor, studentId: string): Promise<DocumentView[]> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select id, kind, state, content_type, byte_size, rejection_note, created_at, reviewed_at
        from student_document
       where student_id = ${studentId} and state in ('pending', 'uploaded', 'approved', 'rejected')
       order by created_at, id`),
  );
  return rowsOf<RawDocument>(result).map(toView);
}

export type ReviewOutcome = "ok" | "not_found" | "not_reviewable" | "not_allowed";

/**
 * The manager (or an admin) approves a file or asks for a clearer one. The change and its audit row commit together; the audit row carries only
 * the kind. The proof of payment is the admin's to approve (FR-46): a manager gets `not_allowed`. `onlyKind` limits the call to one kind (the
 * admin's proof-of-payment operation), so it cannot be used on another document.
 */
export async function reviewDocument(
  db: Db,
  actor: Actor,
  input: { id: string; decision: "approved" | "rejected"; note: string | null; onlyKind?: DocumentKind },
): Promise<ReviewOutcome> {
  const [updated, visible] = await runAs(
    db,
    actor,
    db.execute(sql`
      with upd as (
        update student_document
           set state = ${input.decision}, rejection_note = ${input.decision === "rejected" ? input.note : null}, reviewed_by = ${actor.userId}, reviewed_at = now()
         where id = ${input.id}::uuid and state = 'uploaded' and kind not in ('offer_letter', 'acceptance_letter')
           and (kind <> 'payment_proof' or ${actor.role === "admin"}::boolean) and (${input.onlyKind ?? null}::text is null or kind = ${input.onlyKind ?? null}::text)
        returning id, kind
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'documents.review', 'student_document', id::text, jsonb_build_object('kind', kind, 'decision', ${input.decision}::text) from upd
      )
      select id from upd`),
    db.execute(sql`select kind from student_document where id = ${input.id}::uuid`),
  );
  if (rowsOf(updated).length > 0) return "ok";
  const kind = rowsOf<{ kind: string }>(visible)[0]?.kind;
  if (kind === undefined) return "not_found";
  if (kind === "payment_proof" && actor.role !== "admin") return "not_allowed";
  if (input.onlyKind !== undefined && kind !== input.onlyKind) return "not_found";
  return "not_reviewable";
}

/**
 * The key of a file the caller may open, or null. A staff opening is written to the audit log in the same statement (the document id and its
 * kind, nothing else); a student opening their own letter is not. The signed link is made by the caller and is never logged.
 */
export async function keyToOpen(db: Db, actor: Actor, id: string, audit: boolean): Promise<{ key: string; byteSize: number } | null> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with d as (
        select id, storage_key, kind, byte_size from student_document
         where id = ${id}::uuid and storage_key is not null and state in ('uploaded', 'approved', 'rejected')
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'documents.open', 'student_document', id::text, jsonb_build_object('kind', kind) from d where ${audit}::boolean
      )
      select storage_key, byte_size from d`),
  );
  const row = rowsOf<{ storage_key: string; byte_size: number }>(result)[0];
  return row ? { key: row.storage_key, byteSize: row.byte_size } : null;
}

/** Step 2 to step 3: the four required documents are approved (and the passport, when the application's university asks). */
export async function documentsComplete(db: Db, actor: Actor, studentId: string, leadId: string): Promise<boolean> {
  const [result] = await runAs(db, actor, db.execute(sql`select public.app_documents_complete(${studentId}, public.app_lead_passport_required(${leadId}::uuid)) as complete`));
  return rowsOf<{ complete: boolean }>(result)[0]?.complete === true;
}

// ---- letters (S17.3; architecture 24.6): the admin uploads an offer or acceptance letter for a student -----------------------------------

export type LetterKind = "offer_letter" | "acceptance_letter";

/**
 * The admin asks to upload a letter for a student: a pending row, like a student's upload, made only if the student has a profile. The row points
 * at the student's application when there is one. Returns false when there is no such student.
 */
export async function createPendingLetter(db: Db, actor: Actor, input: { id: string; studentId: string; kind: LetterKind; byteSize: number; key: string }): Promise<boolean> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      insert into student_document (id, student_id, application_id, kind, storage_key, content_type, byte_size, state)
      select ${input.id}::uuid, sp.user_id, sp.lead_id, ${input.kind}, ${input.key}, 'application/pdf', ${input.byteSize}, 'pending'
        from student_profile sp where sp.user_id = ${input.studentId}
      returning id`),
  );
  return rowsOf(result).length > 0;
}

/** A pending letter the admin is confirming (the file is not the student's, so this is not `findOwnPending`). */
export async function findPendingLetter(db: Db, actor: Actor, id: string): Promise<{ key: string; contentType: string; byteSize: number } | null> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      select storage_key, content_type, byte_size from student_document
       where id = ${id}::uuid and state = 'pending' and storage_key is not null and kind in ('offer_letter', 'acceptance_letter')`),
  );
  const row = rowsOf<{ storage_key: string; content_type: string; byte_size: number }>(result)[0];
  return row ? { key: row.storage_key, contentType: row.content_type, byteSize: row.byte_size } : null;
}

/** The letter passed the content check. The uploader and the time are kept, and an audit row says which kind went to which student's file. */
export async function markLetterUploaded(db: Db, actor: Actor, id: string): Promise<boolean> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with upd as (
        update student_document set state = 'uploaded', reviewed_by = ${actor.userId}, reviewed_at = now()
         where id = ${id}::uuid and state = 'pending' and kind in ('offer_letter', 'acceptance_letter')
        returning id, kind
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select ${uuidv7()}::uuid, ${actor.userId}, 'documents.letter', 'student_document', id::text, jsonb_build_object('kind', kind) from upd
      )
      select id from upd`),
  );
  return rowsOf(result).length > 0;
}

export async function discardPendingLetter(db: Db, actor: Actor, id: string): Promise<void> {
  await runAs(
    db,
    actor,
    db.execute(sql`update student_document set state = 'purged', storage_key = null where id = ${id}::uuid and state = 'pending' and kind in ('offer_letter', 'acceptance_letter')`),
  );
}

// ---- purge and erasure (S17.3; architecture 24.7) --------------------------------------------------------------------------------------

/** The keys of the student's own files, for an account erasure. Row level security limits it to the caller. */
export async function ownDocumentKeys(db: Db, actor: Actor): Promise<string[]> {
  const [result] = await runAs(db, actor, db.execute(sql`select storage_key from student_document where student_id = ${actor.userId} and storage_key is not null`));
  return rowsOf<{ storage_key: string }>(result).map((r) => r.storage_key);
}

/** The keys an erasure of this lead will clear (migration 0025). The caller deletes the objects first, so a failed delete stops the erasure. */
export async function erasureDocumentKeys(db: Db, actor: Actor, leadId: string): Promise<string[]> {
  const [result] = await runAs(db, actor, db.execute(sql`select storage_key from public.app_erasure_document_keys(${leadId}::uuid)`));
  return rowsOf<{ storage_key: string }>(result).map((r) => r.storage_key);
}

/** The files the daily purge may delete now (migration 0025 decides: 90 days after Arrived or Closed with nothing open, or an upload that never finished). Runs as the system, with no signed-in user. */
export async function purgeCandidates(db: Db, limit: number): Promise<{ id: string; key: string }[]> {
  const result = await db.execute(sql`select document_id, storage_key from public.app_purge_candidates(${limit}::int)`);
  return rowsOf<{ document_id: string; storage_key: string }>(result).map((r) => ({ id: r.document_id, key: r.storage_key }));
}

/** After the objects are deleted: marks the rows purged, in one call. The database checks the rule again, so a row that no longer qualifies stays. */
export async function markPurged(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.execute(sql`select public.app_mark_documents_purged(${`{${ids.join(",")}}`}::uuid[]) as n`);
  return Number(rowsOf<{ n: number }>(result)[0]?.n ?? 0);
}
