import { isCourseField } from "@/lib/courses";
import { isPublicPagePath } from "@/lib/public-paths";

/**
 * Where a person goes after signing in or signing up (PRD_3 F20, PRD_4 F24, architecture 22.2, 23.5, ADR-051). A "Create an account" link
 * sends a signed-out visitor to `/sign-up?next=<the page they were on>`; the value rides along the Google trip like the intent does. It
 * is user input, so it is an allow-list, never a free redirect: only a public page of ours (the same list the edge cache serves), plus
 * `/apply`, which is no longer a page: the Worker forwards it to the Apply screen inside the account (a link or bookmark from before
 * version 4 keeps working). Anything else is dropped and the person simply lands on their own home.
 *
 * Pure, so the rules are table tests.
 */

const MAX_LENGTH = 200;

/** The old public address of the Apply form. It answers a redirect from the Worker (`edge/legacy-redirects.ts`), and is still a valid return address. */
export const APPLY_ADDRESS = "/apply";

const hasControlCharacter = (text: string): boolean => [...text].some((character) => character.charCodeAt(0) < 32);

/** The path a `next` value stands for, or null when it is not an allowed address. */
export function safeNext(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return null;
  // Same-site paths only: one leading slash, no scheme, no protocol-relative address, no backslash or control character.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes(String.fromCharCode(92)) || hasControlCharacter(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://scollarly.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://scollarly.invalid" || url.hash !== "") return null;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  // Not a page any more, but the address the Worker forwards to the Apply screen. A query on it (the old `?university=`) is dropped.
  if (path === APPLY_ADDRESS) return APPLY_ADDRESS;
  if (!isPublicPagePath(path) || path === "/sign-in" || path === "/sign-out") return null;

  const keys = [...url.searchParams.keys()];
  if (keys.length === 0) return url.search === "" ? path : null;
  if (keys.length === 1 && path === "/" && keys[0] === "course") {
    const course = url.searchParams.get("course");
    return isCourseField(course) ? `${path}?course=${course}` : null;
  }
  return null;
}

/** `/sign-in?next=...` and `/sign-up?next=...`, with the value checked. Without a valid next the plain page. */
export function authHref(page: "/sign-in" | "/sign-up", next: string | null | undefined): string {
  const safe = safeNext(next);
  return safe ? `${page}?next=${encodeURIComponent(safe)}` : page;
}
