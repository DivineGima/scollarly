import { KEPT_SHELL_CACHE } from "@/lib/sw-rules";

/**
 * Sign-out and erasure: forget the signed-in shells the service worker kept (architecture 21.11). They hold nothing private, but they
 * are the signed-in app's pages, so they go with the session. Swallows errors: where the Cache API is missing there is nothing kept.
 */
export async function clearKeptShells(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete(KEPT_SHELL_CACHE);
  } catch {
    // Nothing to clear.
  }
}
