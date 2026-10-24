import { revalidateTag } from "next/cache";
import { CONTENT_TAGS, type ContentArea } from "./tags";

/**
 * Called by a publish, unpublish or archive (Stage 6) after the database write: marks the areas stale so the next request
 * regenerates the pages that read them (architecture 10.4). Pass every area the change touched. A university change, for
 * instance, also changes the testimonials that name it, so it passes `catalogue` and `trust`.
 */
export function revalidateContent(...areas: ContentArea[]): void {
  for (const area of new Set(areas)) revalidateTag(CONTENT_TAGS[area]);
}
