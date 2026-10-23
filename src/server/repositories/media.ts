import { eq, isNull, and } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { mediaAsset, mediaBlob } from "@/server/db/schema";

export interface MediaBlobResult {
  sha256: string;
  mime: string;
  bytes: number;
  data: Uint8Array;
}

/**
 * The only reader of `media_blob` (architecture 7.4). Looks the image up by content hash.
 * Archived assets are not served.
 */
export async function findBlobBySha256(db: Db, sha256: string): Promise<MediaBlobResult | null> {
  const [row] = await db
    .select({ sha256: mediaAsset.sha256, mime: mediaAsset.mime, bytes: mediaAsset.bytes, data: mediaBlob.data })
    .from(mediaAsset)
    .innerJoin(mediaBlob, eq(mediaBlob.mediaId, mediaAsset.id))
    .where(and(eq(mediaAsset.sha256, sha256), isNull(mediaAsset.archivedAt)))
    .limit(1);
  return row ?? null;
}

export interface NewMedia {
  id: string;
  kind: "logo" | "photo" | "blog" | "testimonial" | "other";
  width: number;
  height: number;
  sha256: string;
  data: Uint8Array;
}

/** Inserts an asset and its bytes in one transaction. Returns false if the hash already exists (dedupe). */
export async function insertMedia(db: Db, media: NewMedia): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(mediaAsset)
      .values({
        id: media.id,
        kind: media.kind,
        width: media.width,
        height: media.height,
        bytes: media.data.byteLength,
        mime: "image/webp",
        sha256: media.sha256,
      })
      .onConflictDoNothing({ target: mediaAsset.sha256 })
      .returning({ id: mediaAsset.id });
    if (inserted.length === 0) return false;
    await tx.insert(mediaBlob).values({ mediaId: media.id, data: media.data });
    return true;
  });
}
