/**
 * The public Turnstile site key, fixed into the pages at build time (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`). It is public by design:
 * it only names the widget. The matching secret key lives in the Worker (`TURNSTILE_SECRET_KEY`) and is never in the browser.
 * Empty means Turnstile is not configured: the forms still save the lead on the phone, but sending waits (nothing is lost).
 */
export const TURNSTILE_SITE_KEY: string = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
