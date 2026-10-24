import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serveMedia } from "@/server/edge/media";
import { getMediaStore } from "@/server/media/runtime";

// The Worker entry normally answers images first (worker/index.ts). This route serves any request that reaches Next.js.
export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  const { hash } = await params;
  const { env, ctx } = getCloudflareContext();
  return serveMedia({
    hashParam: hash,
    requestUrl: request.url,
    cache: (caches as unknown as { default: Cache }).default,
    store: getMediaStore(env),
    waitUntil: (task) => ctx.waitUntil(task),
  });
}
