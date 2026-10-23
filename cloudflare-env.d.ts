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
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  OWNER_EMAIL: string;
  PHASE0_PROBE_TOKEN: string;
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
}
