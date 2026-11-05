"use client";

import { useEffect } from "react";
import { isSignedInHint } from "@/lib/client/signed-in-hint";

/**
 * The "My account" swap (PRD_4 F25, FR-36; architecture 23.7). Every public page is the same cached HTML for everyone, so it cannot know who is
 * looking. The Sign in links and the Create an account buttons carry a mark; when this browser has the signed-in hint, they read "My account"
 * and go to `/account`. The hint only chooses a label: `/account` forwards to the right home whatever the hint says, and sends a visitor whose
 * session ended to Sign in, so a stale or missing hint can never lead anyone to the wrong place. Without JavaScript the links stay as served.
 */
export function AccountLinkSwap({ label }: { label: string }) {
  useEffect(() => {
    if (!isSignedInHint()) return;
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-account-link], a[data-sign-in-link]")) {
      if (link.hasAttribute("data-hide-signed-in")) {
        // Inline, because the site's own `display` rule on the link class would beat the `hidden` attribute.
        link.style.display = "none";
        link.hidden = true;
        continue;
      }
      link.textContent = label;
      link.setAttribute("href", "/account");
    }
  }, [label]);
  return null;
}
