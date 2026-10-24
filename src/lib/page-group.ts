/**
 * Page groups for analytics (architecture 7.5, `event.page_group`): a coarse name for where an event happened, never a full
 * path, so no slug, query or reference can leak into a count. Shared by the browser (which names the group) and the server
 * (which accepts only these names).
 */
export const PAGE_GROUPS = ["home", "universities", "university", "fees", "tours", "process", "visa", "faq", "about", "blog", "post", "contact", "apply", "privacy", "terms", "other"] as const;
export type PageGroup = (typeof PAGE_GROUPS)[number];

const STATIC: Record<string, PageGroup> = {
  "/": "home",
  "/universities": "universities",
  "/fees": "fees",
  "/campus-tours": "tours",
  "/process": "process",
  "/visa": "visa",
  "/faq": "faq",
  "/about": "about",
  "/blog": "blog",
  "/contact": "contact",
  "/apply": "apply",
  "/privacy": "privacy",
  "/terms": "terms",
};

export function pageGroupOf(pathname: string): PageGroup {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const exact = STATIC[path];
  if (exact) return exact;
  if (/^\/universities\/[^/]+$/.test(path)) return "university";
  if (/^\/blog\/[^/]+$/.test(path)) return "post";
  return "other";
}
