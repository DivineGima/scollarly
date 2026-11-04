/**
 * The hosts a 360 tour may be shown from (PRD_3 F22, architecture 22.6, tracker F31). The security policy lets a page frame only these, YouTube's
 * privacy domain and Turnstile; before this list it allowed any https address on every page. A 360 tour on another host is not shown (the content
 * builder drops it), so a visitor never meets an empty frame. To add a host, add its origin here and say why in the pull request: it is a code change
 * on purpose, because it widens what the site may frame. No import, so the security headers can use it.
 */
export const TOUR_FRAME_ORIGINS: readonly string[] = ["https://www.iviewd.com", "https://virtualtour.kalingauniversity.ac.in"];
