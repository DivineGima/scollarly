"use client";

import { useEffect } from "react";

/**
 * The last safety net: a page whose code failed to load or run (typically a page kept from before a deploy, whose build
 * files are gone) reloads itself once from the network instead of staying on a blank "Application error" screen. The
 * kept pages are dropped first, so the reload gets the current version. A second failure shows a plain message and a
 * button. It replaces the root layout, so it cannot use the translation provider; the words are kept few.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    const key = "scollarly-reloaded-once";
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    const reload = () => window.location.reload();
    if (typeof caches === "undefined") reload();
    else void caches.delete("pages").then(reload, reload);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: "2rem 1rem", fontFamily: "system-ui, sans-serif", color: "#0b1220", background: "#ffffff" }}>
        <main style={{ maxWidth: "32rem", margin: "0 auto" }}>
          <h1>This page did not load</h1>
          <p>Check your connection and try again.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ minHeight: "2.75rem", padding: "0 1.5rem", font: "inherit", fontWeight: 600, color: "#ffffff", background: "#1d4ed8", border: 0, borderRadius: "0.5rem" }}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
