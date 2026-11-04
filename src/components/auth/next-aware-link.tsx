"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { safeNext } from "@/modules/gate/next";

/**
 * A link on the sign-in or sign-up page that keeps the page the person came from (`?next=`, PRD_3 F20). The page is the same for
 * everyone and cached, so the value is read after load and added to the link. A value that is not an allowed address is dropped
 * here and checked again by the server, so a tampered link only ever leads to the person's own home. With no script the link still
 * works, without the return trip.
 */
export function NextAwareLink({ href, ...rest }: ComponentProps<"a"> & { href: string }) {
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const target = next ? `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}` : href;
  // Full navigations to Worker routes and pages: <Link> would prefetch them.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  return <a {...rest} href={target} />;
}
