import { getCloudflareContext } from "@opennextjs/cloudflare";

/** The one place that reads Worker bindings and secrets. Server code never touches `process.env` for secrets. */
export function getEnv(): CloudflareEnv {
  return getCloudflareContext().env;
}

/** Defer work until after the response is sent (cache writes, emails, closing sockets). */
export function runInBackground(task: Promise<unknown>): void {
  const swallow = task.catch(() => undefined);
  try {
    getCloudflareContext().ctx.waitUntil(swallow);
  } catch {
    // No request context (build time or a test): the promise simply runs.
  }
}
