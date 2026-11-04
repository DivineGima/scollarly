/**
 * A hint, kept on the phone, that this browser has a signed-in session (PRD_3 F20, architecture 22.2). Public pages are cached and
 * identical for everyone, and the session cookie cannot be read by script, so the page cannot know who is looking. The signed-in
 * screens set this when their data call succeeds and clear it when the session is lost or the person signs out. It is only a
 * convenience for choosing between a real button and a sign-in pop-up: it grants nothing, and the server refuses an action
 * without a session whatever it says. Storage can be blocked, so every access is guarded and "no hint" is the safe answer.
 */

const KEY = "scollarly:signed-in";

export function markSignedIn(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked or full: the person just sees the pop-up once more, and the server still decides.
  }
}

export function clearSignedIn(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The return trip from sign-in sends a student back to the public page with this fragment (`edge/landing.ts`). A fragment is never
 * sent to the server, so the page stays cacheable, and a cookie would have made it bypass the edge cache. The first read turns it
 * into the stored hint and removes it from the address.
 */
export const SIGNED_IN_FRAGMENT = "#signed-in";

function consumeFragment(): void {
  if (window.location.hash !== SIGNED_IN_FRAGMENT) return;
  markSignedIn();
  try {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  } catch {
    // The address stays as it is; harmless.
  }
}

export function isSignedInHint(): boolean {
  consumeFragment();
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
