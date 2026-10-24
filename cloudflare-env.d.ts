// Hand-written binding and secret types for the Worker environment (OpenNext's getCloudflareContext
// reads the global CloudflareEnv interface). Keep in step with wrangler.jsonc and .dev.vars.example.
interface CloudflareEnv {
  // Platform bindings
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  NEXT_INC_CACHE_KV: KVNamespace;
  NEXT_TAG_CACHE_D1: D1Database;
  NEXT_CACHE_DO_QUEUE: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  COLLECTOR: DurableObjectNamespace;

  // Secrets
  /** Connection string of the non-owner `app_runtime` role (pooled), ADR-038. */
  DATABASE_URL: string;
  /** Neon Auth URL of the branch, including its path (ADR-037). */
  NEON_AUTH_BASE_URL: string;
  /** At least 32 characters. Signs the `session_data` cookie the Neon Auth SDK mints. */
  NEON_AUTH_COOKIE_SECRET: string;
  /** Base64 of 32 random bytes. Encrypts the owner's authenticator secret (ADR-037). */
  TOTP_ENCRYPTION_KEY: string;
  /** Salts the hashed caller key of the rate limiter. Never a raw IP. */
  RATE_LIMIT_SECRET: string;
  /** Neon Object Storage (ADR-039): endpoint, region and a write-scoped credential. Reads need none. */
  NEON_STORAGE_ENDPOINT: string;
  NEON_STORAGE_REGION: string;
  NEON_STORAGE_ACCESS_KEY_ID: string;
  NEON_STORAGE_SECRET_ACCESS_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  OWNER_EMAIL: string;
  PHASE0_PROBE_TOKEN: string;
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
}
