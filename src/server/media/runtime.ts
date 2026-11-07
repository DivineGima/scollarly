import { type DocumentStore, createDocumentStore } from "./documents";
import { type MediaStore, createMediaStore } from "./store";

type StorageEnv = Pick<CloudflareEnv, "NEON_STORAGE_ENDPOINT" | "NEON_STORAGE_REGION" | "NEON_STORAGE_ACCESS_KEY_ID" | "NEON_STORAGE_SECRET_ACCESS_KEY">;

let cached: { key: string; store: MediaStore } | null = null;
let cachedDocuments: { key: string; store: DocumentStore } | null = null;

function configOf(env: StorageEnv) {
  const { NEON_STORAGE_ENDPOINT: endpoint, NEON_STORAGE_REGION: region, NEON_STORAGE_ACCESS_KEY_ID: accessKeyId, NEON_STORAGE_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) throw new Error("Neon Object Storage is not configured");
  return { key: `${endpoint}|${accessKeyId}`, config: { endpoint, region, accessKeyId, secretAccessKey } };
}

/** The per-isolate image store, built from the Worker secrets. Throws a clear error if one is missing. */
export function getMediaStore(env: StorageEnv): MediaStore {
  const { key, config } = configOf(env);
  if (cached?.key !== key) cached = { key, store: createMediaStore(config) };
  return cached.store;
}

/** The per-isolate student-document store (the private bucket), from the same secrets. */
export function getDocumentStore(env: StorageEnv): DocumentStore {
  const { key, config } = configOf(env);
  if (cachedDocuments?.key !== key) cachedDocuments = { key, store: createDocumentStore(config) };
  return cachedDocuments.store;
}
