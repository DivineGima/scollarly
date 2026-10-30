import { sql, type SQL } from "drizzle-orm";
import type { Actor } from "@/server/auth/actor";
import type { Db } from "@/server/db/client";
import { rowsOf } from "@/server/db/rows";
import type { NewMediaRow } from "@/server/media/ingest";
import { runAs } from "./as-actor";

/**
 * The image library for staff (architecture 7.4, 10.5, 16 B7; S6.3). The bytes live in Neon Object Storage under their own hash and
 * are never deleted or replaced (decision D17), so "archive" only hides an image from new use. This file reads and writes the
 * metadata row. Every write is one statement with its audit row, under row level security (only staff write `media_asset`).
 */

export const DEFAULT_MEDIA_BUDGET_BYTES = 3_758_096_384; // 3.5 GiB, the seeded default (tracker F16)
/** At this share of the budget the owner sees a banner (architecture 10.5). */
export const MEDIA_WARN_SHARE = 0.7;

/** Every place an image can be used, as rows of `(type, id, label, status, media_id)`. A content type's `type` is the key of `TYPE_DEFS`. */
const USES = `
  select 'universities' as type, id, name as label, status, logo_media_id as media_id from university where logo_media_id is not null
  union all select 'campus', id, title, status, thumbnail_media_id from campus_experience where thumbnail_media_id is not null
  union all select 'testimonials', id, student_name, status, photo_media_id from testimonial where photo_media_id is not null
  union all select 'team', id, name, status, photo_media_id from team_member where photo_media_id is not null
  union all select 'blog', id, title, status, cover_media_id from post where cover_media_id is not null
  union all select 'page', id, key, 'published', media_asset_id from page_image`;

export interface MediaItem {
  id: string;
  kind: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  createdAt: string;
  archived: boolean;
  /** Live (not archived) items that use it. Archiving is blocked while this is above zero. */
  usedBy: number;
}

export interface MediaOverview {
  items: MediaItem[];
  usedBytes: number;
  budgetBytes: number;
}

export async function mediaOverview(db: Db, actor: Actor): Promise<MediaOverview> {
  const [items, budget] = await runAs(
    db,
    actor,
    db.execute(sql`
      select m.id, m.kind, m.alt, m.width, m.height, m.bytes, m.sha256, m.created_at, m.archived_at,
             (select count(*)::int from (${sql.raw(USES)}) u where u.media_id = m.id and u.status <> 'archived') as used_by,
             (select coalesce(sum(a.bytes), 0)::bigint from media_asset a) as total
        from media_asset m order by m.created_at desc, m.id`),
    db.execute(sql`select value from site_setting where key = 'media_budget_bytes'`),
  );
  const rows = rowsOf<{
    id: string;
    kind: string;
    alt: Record<string, string> | null;
    width: number;
    height: number;
    bytes: number;
    sha256: string;
    created_at: string | Date;
    archived_at: string | Date | null;
    used_by: number;
    total: string | number;
  }>(items);
  const raw = rowsOf<{ value: unknown }>(budget)[0]?.value;
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      alt: r.alt?.en ?? "",
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      sha256: r.sha256,
      createdAt: new Date(r.created_at).toISOString(),
      archived: r.archived_at !== null,
      usedBy: r.used_by,
    })),
    usedBytes: Number(rows[0]?.total ?? 0),
    budgetBytes: typeof raw === "number" && raw > 0 ? raw : DEFAULT_MEDIA_BUDGET_BYTES,
  };
}

export interface MediaUse {
  type: string;
  id: string;
  label: string;
  status: string;
}

/** B7 step 3: the "Used in" list, archived items included (shown as such). */
export async function mediaUses(db: Db, actor: Actor, id: string): Promise<MediaUse[]> {
  const [result] = await runAs(db, actor, db.execute(sql`select type, id, label, status from (${sql.raw(USES)}) u where u.media_id = ${id}::uuid order by label`));
  return rowsOf<MediaUse>(result);
}

/** Inserts the metadata row of a new image with its audit row. Returns null when the hash already exists (deduplication). */
export async function insertMediaAs(db: Db, actor: Actor, row: NewMediaRow, meta: { document: boolean }): Promise<string | null> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with ins as (
        insert into media_asset (id, kind, alt, width, height, bytes, mime, sha256, created_by)
        values (${row.id}::uuid, ${row.kind}, ${JSON.stringify(row.alt ?? {})}::jsonb, ${row.width}, ${row.height}, ${row.bytes}, 'image/webp', ${row.sha256}, ${actor.userId})
        on conflict (sha256) do nothing
        returning id
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'media.upload', 'media_asset', ins.id::text,
               jsonb_build_object('kind', ${row.kind}::text, 'bytes', ${row.bytes}::int, 'document', ${meta.document}::boolean)
          from ins
      )
      select id from ins`),
  );
  return rowsOf<{ id: string }>(result)[0]?.id ?? null;
}

/**
 * The id of the image with this hash. An archived image is restored by the same statement (with an audit row): the person is
 * about to use it again, and a live item must never point at an archived image (archiving is blocked while one does).
 */
export async function findMediaIdAs(db: Db, actor: Actor, sha256: string): Promise<string | null> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with found as (select id, archived_at from media_asset where sha256 = ${sha256}),
      restored as (
        update media_asset set archived_at = null
         where id in (select id from found where archived_at is not null)
        returning id
      ), aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'media.restore', 'media_asset', restored.id::text, '{}'::jsonb from restored
      )
      select id from found`),
  );
  return rowsOf<{ id: string }>(result)[0]?.id ?? null;
}

/** Bytes stored in all, and the budget, for the upload check and the meter. */
export async function mediaBudget(db: Db, actor: Actor): Promise<{ usedBytes: number; budgetBytes: number }> {
  const [used, budget] = await runAs(
    db,
    actor,
    db.execute(sql`select coalesce(sum(bytes), 0)::bigint as total from media_asset`),
    db.execute(sql`select value from site_setting where key = 'media_budget_bytes'`),
  );
  const raw = rowsOf<{ value: unknown }>(budget)[0]?.value;
  return { usedBytes: Number(rowsOf<{ total: string | number }>(used)[0]?.total ?? 0), budgetBytes: typeof raw === "number" && raw > 0 ? raw : DEFAULT_MEDIA_BUDGET_BYTES };
}

/** B7 step 3: "Alt text editor". English is the only active locale (ADR-018). */
export async function setMediaAlt(db: Db, actor: Actor, id: string, alt: string): Promise<boolean> {
  const value: SQL = alt === "" ? sql`'{}'::jsonb` : sql`jsonb_build_object('en', ${alt}::text)`;
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with upd as (update media_asset set alt = ${value} where id = ${id}::uuid returning id),
      aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'media.setAlt', 'media_asset', upd.id::text, '{}'::jsonb from upd
      )
      select count(*)::int as n from upd`),
  );
  return (rowsOf<{ n: number }>(result)[0]?.n ?? 0) > 0;
}

export type ArchiveMediaOutcome = { kind: "ok" } | { kind: "in_use"; uses: MediaUse[] } | { kind: "not_found" } | { kind: "already_archived" };

/** B7 step 4: archive an image that no live item uses. The file stays in storage (no physical delete). */
export async function archiveMedia(db: Db, actor: Actor, id: string): Promise<ArchiveMediaOutcome> {
  const [result] = await runAs(
    db,
    actor,
    db.execute(sql`
      with live as (select 1 from (${sql.raw(USES)}) u where u.media_id = ${id}::uuid and u.status <> 'archived'),
      upd as (
        update media_asset set archived_at = now()
         where id = ${id}::uuid and archived_at is null and not exists (select 1 from live)
        returning id
      ),
      aud as (
        insert into audit_log (id, actor_id, action, entity_type, entity_id, meta)
        select gen_random_uuid(), ${actor.userId}, 'media.archive', 'media_asset', upd.id::text, '{}'::jsonb from upd
      )
      select (select count(*) from upd)::int as archived, (select count(*) from live)::int as live,
             (select archived_at is not null from media_asset where id = ${id}::uuid) as was_archived`),
  );
  const row = rowsOf<{ archived: number; live: number; was_archived: boolean | null }>(result)[0];
  if (row && row.archived > 0) return { kind: "ok" };
  if (!row || row.was_archived === null) return { kind: "not_found" };
  if (row.live > 0) return { kind: "in_use", uses: (await mediaUses(db, actor, id)).filter((u) => u.status !== "archived") };
  return { kind: "already_archived" };
}
