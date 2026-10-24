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
