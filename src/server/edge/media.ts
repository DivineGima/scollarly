import type { MediaStore } from "@/server/media/store";

/**
 * `GET /media/[hash]` delivery (architecture 10.5, S0.5), run in the Worker entry before Next.js starts. The Cache API is
 * checked by `fast-path.ts`; this runs on a miss. It reads the image from the public bucket (no database, no
 * credential), answers it with immutable headers, and stores a copy in the Cache API. The URL is the content hash, so
 * the copy is valid forever.
 */

const HASH_PATTERN = /^([a-f0-9]{64})(?:\.webp)?$/;

export const IMMUTABLE_HEADERS = {
  "Content-Type": "image/webp",
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
} as const;

export interface ServeMediaDeps {
  hashParam: string;
  requestUrl: string;
  cache: Pick<Cache, "match" | "put">;
  store: Pick<MediaStore, "get">;
  waitUntil: (task: Promise<unknown>) => void;
}

export async function serveMedia(deps: ServeMediaDeps): Promise<Response> {
  const match = HASH_PATTERN.exec(deps.hashParam);
  if (!match?.[1]) return notFound();
  const sha256 = match[1];

  // One canonical cache key per image, whatever the extension or query string the page used.
  const cacheKey = new Request(`${new URL(deps.requestUrl).origin}/media/${sha256}.webp`);
  const hit = await deps.cache.match(cacheKey);
  if (hit) return hit;

  let upstream: Response | null;
  try {
    upstream = await deps.store.get(sha256);
  } catch {
    return new Response("Image storage is unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (!upstream) return notFound();

  const response = new Response(upstream.body, { status: 200, headers: IMMUTABLE_HEADERS });
  deps.waitUntil(deps.cache.put(cacheKey, response.clone()));
  return response;
}

function notFound(): Response {
  // Never cached, so an image uploaded a moment later is found.
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
