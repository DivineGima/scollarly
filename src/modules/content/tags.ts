/**
 * Cache tags for public content (architecture 10.4). A publish calls `revalidateContent` with the area it changed, the
 * next request regenerates the pages that read that area, and the edge copy expires within 30 seconds (ADR-033).
 * Kept in its own file so a public page can import a tag without pulling in the database code.
 */
export const CONTENT_TAGS = {
  catalogue: "content:catalogue",
  site: "content:site",
  trust: "content:trust",
  blog: "content:blog",
  pageImages: "content:page-images",
} as const;

export type ContentArea = keyof typeof CONTENT_TAGS;

/** The safety net: a page regenerates at least this often even if no publish happened (seconds). */
export const CONTENT_REVALIDATE_SECONDS = 3600;
