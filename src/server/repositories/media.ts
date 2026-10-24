import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { mediaAsset } from "@/server/db/schema";

/**
 * Image metadata only (architecture 7.4). The bytes live in Neon Object Storage under `<sha256>.webp` (ADR-039), so the
 * serving path reads storage and never this table. Writes are staff-only under row level security: run them with `inContext`.
 */

export interface NewMedia {
  id: string;
  kind: "logo" | "photo" | "blog" | "testimonial" | "other";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  /** Translatable alternative text, for example `{ en: "Jain University campus" }`. */
  alt?: Record<string, string>;
}

/** Inserts the metadata row. Returns no row when the hash already exists (deduplication by content hash). */
export function insertMediaAssetQuery(db: Db, media: NewMedia) {
  return db
    .insert(mediaAsset)
    .values({ ...media, mime: "image/webp" })
    .onConflictDoNothing({ target: mediaAsset.sha256 })
    .returning({ id: mediaAsset.id });
}

/** The live (not archived) asset with this hash. */
export function findAssetBySha256Query(db: Db, sha256: string) {
  return db
    .select({ id: mediaAsset.id, kind: mediaAsset.kind, width: mediaAsset.width, height: mediaAsset.height, bytes: mediaAsset.bytes, sha256: mediaAsset.sha256 })
    .from(mediaAsset)
    .where(and(eq(mediaAsset.sha256, sha256), isNull(mediaAsset.archivedAt)))
    .limit(1);
}

/** The id of the asset with this hash, archived or not. For the import script and the upload path, which run with the owner role or inside `inContext`. */
export async function findAssetIdBySha256(db: Db, sha256: string): Promise<string | null> {
  const [row] = await db.select({ id: mediaAsset.id }).from(mediaAsset).where(eq(mediaAsset.sha256, sha256)).limit(1);
  return row?.id ?? null;
}

/** Inserts the metadata row and returns its id, or null when the hash already exists. Runs with the owner role (the import script). */
export async function insertMediaAsset(db: Db, media: NewMedia): Promise<string | null> {
  const [row] = await insertMediaAssetQuery(db, media);
  return row?.id ?? null;
}
