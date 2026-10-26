import { revalidateContent } from "@/modules/content/revalidate";
import { requireRole } from "@/server/auth";
import { handleRevalidate } from "@/server/edge/revalidate";

// S6.4. Next.js is needed here (revalidateTag), so this is one of the few signed-in requests that is not a plain function in the
// Worker entry; the Worker entry does not claim this path, so it falls through to this route. The session is checked inside.
export async function POST(request: Request): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  return handleRevalidate(request, {
    requireAdmin: (headers) => requireRole(headers, "admin"),
    revalidate: revalidateContent,
    purge: (url) => cache.delete(new Request(url)),
  });
}
