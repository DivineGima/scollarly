import { type MediaStore, createMediaStore } from "./store";

let cached: { key: string; store: MediaStore } | null = null;

/** The per-isolate image store, built from the Worker secrets. Throws a clear error if one is missing. */
export function getMediaStore(env: Pick<CloudflareEnv, "NEON_STORAGE_ENDPOINT" | "NEON_STORAGE_REGION" | "NEON_STORAGE_ACCESS_KEY_ID" | "NEON_STORAGE_SECRET_ACCESS_KEY">): MediaStore {
  const { NEON_STORAGE_ENDPOINT: endpoint, NEON_STORAGE_REGION: region, NEON_STORAGE_ACCESS_KEY_ID: accessKeyId, NEON_STORAGE_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) throw new Error("Neon Object Storage is not configured");
  const key = `${endpoint}|${accessKeyId}`;
  if (cached?.key !== key) cached = { key, store: createMediaStore({ endpoint, region, accessKeyId, secretAccessKey }) };
  return cached.store;
}
