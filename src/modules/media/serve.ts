import type { MediaBlobResult } from "@/server/repositories/media";

/**
 * `GET /media/[hash]` delivery (architecture 10.5, S0.5): Cache API first, the database only on a miss.
 * The URL is the content hash, so the response can be cached forever. A cache hit makes no database access.
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
  loadBlob: (sha256: string) => Promise<MediaBlobResult | null>;
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

  const blob = await deps.loadBlob(sha256);
  if (!blob || blob.mime !== "image/webp") return notFound();

  const response = new Response(blob.data as BodyInit, {
    status: 200,
    headers: { ...IMMUTABLE_HEADERS, "Content-Length": String(blob.data.byteLength) },
  });
  deps.waitUntil(deps.cache.put(cacheKey, response.clone()));
  return response;
}

function notFound(): Response {
  // Not cached, so a hash uploaded a moment later is found.
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
