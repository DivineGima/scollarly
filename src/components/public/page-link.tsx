import type { ComponentProps } from "react";

/**
 * A plain anchor on purpose. A full page load is answered from the edge cache and the service worker; a client-router
 * navigation (`next/link`) would prefetch pages the visitor may never open on a limited data plan, and its requests are
 * Next.js data requests that the edge fast path does not serve (architecture 6.1, ADR-033).
 */
export function PageLink(props: ComponentProps<"a">) {
  return <a {...props} />;
}
