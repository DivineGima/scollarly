import { getCloudflareContext } from "@opennextjs/cloudflare";
import { serveMedia } from "@/modules/media/serve";
import { createHttpDb } from "@/server/db/client";
import { findBlobBySha256 } from "@/server/repositories/media";

export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  const { hash } = await params;
  const { env, ctx } = getCloudflareContext();
  return serveMedia({
    hashParam: hash,
    requestUrl: request.url,
    cache: (caches as unknown as { default: Cache }).default,
    loadBlob: (sha256) => findBlobBySha256(createHttpDb(env.DATABASE_URL), sha256),
    waitUntil: (task) => ctx.waitUntil(task),
  });
}
