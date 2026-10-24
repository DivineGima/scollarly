import { revalidateTag } from "next/cache";
import { sha256Hex } from "@/lib/hash";
import { createWsDb } from "@/server/db/client";
import { inContext } from "@/server/db/rls";
import { getDb } from "@/server/db/runtime";
import { getMediaStore } from "@/server/media/runtime";
import { rlsProbe, selectOne, transactionRoundTrip, writePhase0TitleQuery } from "@/server/repositories/phase0-probe";
import { createDurableObjectLimiter, limiterKey } from "@/server/security/rate-limit";
import { runInBackground } from "@/server/env";
import { PHASE0_CONTENT_TAG } from "./tags";

/**
 * Stage 0 probes. They exist only to produce numbers for the architecture section 17 gates and are
 * removed (with `/api/v1/probe/*`) once the gate is decided. Every probe is guarded by
 * `PHASE0_PROBE_TOKEN` in the route, returns no personal data, and is never linked from the site.
 */

export interface ProbeContext {
  env: CloudflareEnv;
  url: URL;
}

export type ProbeResult = Record<string, unknown>;
export type Probe = (ctx: ProbeContext) => Promise<ProbeResult>;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

/**
 * S0.1 first probe: does the Cache API (put, match, delete) work on this hostname?
 * On `*.workers.dev` Cloudflare documents the Cache API as a no-op, which makes the owner's domain
 * action (tracker H7) blocking before the cache gates (S0.2, S0.5, S0.6).
 */
const cache: Probe = async ({ url }) => {
  const store = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${url.origin}/__phase0_cache_probe__`);
  const body = `probe-${Date.now()}`;
  await store.put(key, new Response(body, { headers: { "Cache-Control": "public, max-age=60" } }));
  const hit = await store.match(key);
  const hitBody = hit ? await hit.text() : null;
  const deleted = await store.delete(key);
  const afterDelete = await store.match(key);
  const onWorkersDev = url.hostname.endsWith(".workers.dev");
  const putThenMatchWorks = hitBody === body;
  return {
    host: url.host,
    onWorkersDev,
    putThenMatchWorks,
    deleteReportedSuccess: deleted,
    stillPresentAfterDelete: afterDelete !== undefined,
    conclusion: putThenMatchWorks
      ? "Cache API stores and returns entries on this hostname."
      : onWorkersDev
        ? "Cache API is a no-op on workers.dev: owner action H7 (domain on Cloudflare) is blocking before S0.2, S0.5 and S0.6."
        : "Cache API did not return the stored entry on a custom hostname: investigate before the cache gates.",
  };
};

/** S0.3: one HTTP query. Call it after the database has idled 5+ minutes to record the cold start. */
const neonHttp: Probe = async ({ env }) => {
  const { value, ms } = await timed(() => selectOne(getDb(env)));
  return { driver: "neon-http", value, wallMs: ms };
};

/** S0.3: one WebSocket transaction. */
const neonWs: Probe = async ({ env }) => {
  const ws = createWsDb(env.DATABASE_URL);
  try {
    const { value, ms } = await timed(() => transactionRoundTrip(ws.db));
    return { driver: "neon-serverless (WebSocket)", value, wallMs: ms };
  } finally {
    runInBackground(ws.close());
  }
};

/** S0.3 non-gating probe: can Neon's API report compute usage (CU-hours) to a cron job? */
const neonCu: Probe = async ({ env }) => {
  if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) {
    return { available: null, note: "NEON_API_KEY and NEON_PROJECT_ID are not set; probe not run." };
  }
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 3600 * 1000);
  const endpoint = new URL("https://console.neon.tech/api/v2/consumption_history/v2/projects");
  endpoint.searchParams.set("project_ids", env.NEON_PROJECT_ID);
  endpoint.searchParams.set("from", from.toISOString());
  endpoint.searchParams.set("to", to.toISOString());
  endpoint.searchParams.set("granularity", "daily");
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${env.NEON_API_KEY}`, Accept: "application/json" } });
  if (!response.ok) return { available: false, httpStatus: response.status };
  const json = (await response.json()) as unknown;
  const text = JSON.stringify(json);
  return { available: /compute_time_seconds/.test(text), httpStatus: response.status, reportsComputeTime: /compute_time_seconds/.test(text) };
};

/** S0.7: one Durable Object counter, one Durable Object rate limiter, and the last cron run. */
const durableObjects: Probe = async ({ env, url }) => {
  const collector = env.COLLECTOR.get(env.COLLECTOR.idFromName("global")) as unknown as {
    increment(type: string, by?: number): Promise<number>;
    lastCron(): Promise<number | null>;
  };
  const counter = await collector.increment("probe");
  const limiter = createDurableObjectLimiter(env.RATE_LIMITER);
  const key = await limiterKey({ route: `probe:${url.pathname}`, ip: null }, env.RATE_LIMIT_SECRET);
  const decision = await limiter(key, 3, 60_000);
  const lastCron = await collector.lastCron();
  return { counter, limiter: decision, lastCronAt: lastCron ? new Date(lastCron).toISOString() : null };
};

/** S0.6: write new content, then revalidate the tag. The public Phase 0 page must change without a deploy. */
const publish: Probe = async ({ env, url }) => {
  const title = (url.searchParams.get("title") ?? `Published at ${new Date().toISOString()}`).slice(0, 120);
  // Probe-only: the route is guarded by PHASE0_PROBE_TOKEN, so the write runs with an admin context under row level security.
  const db = getDb(env);
  await inContext(db, { userId: null, role: "admin" }, writePhase0TitleQuery(db, title));
  revalidateTag(PHASE0_CONTENT_TAG);
  return { published: title, revalidatedTag: PHASE0_CONTENT_TAG };
};

/**
 * S0.10 (ADR-038): the runtime role is not the owner and cannot bypass row level security. Asks the live database who this
 * connection is, whether an unauthenticated read of `app_user` returns rows, and whether Neon Auth's own tables are closed.
 */
const rls: Probe = async ({ env }) => ({ ...(await rlsProbe(getDb(env))) });

/**
 * S0.10 (ADR-039): store a small test object under its own hash, then read it back through the public bucket URL.
 * Proves the Worker can sign a write and fetch a public read. Probe objects live under their hash and are never deleted by code.
 */
const storage: Probe = async ({ env, url }) => {
  const store = getMediaStore(env);
  const bytes = new TextEncoder().encode(`scollarly-probe-${url.searchParams.get("n") ?? "1"}`);
  const sha = await sha256Hex(bytes);
  const put = await timed(() => store.put(sha, bytes));
  const read = await timed(async () => {
    const response = await store.get(sha);
    return response ? new Uint8Array(await response.arrayBuffer()).byteLength : null;
  });
  return { sha256: sha, putWallMs: put.ms, readBytes: read.value, readWallMs: read.ms, publicUrl: store.publicUrl(sha) };
};

export const probes: Record<string, Probe> = {
  cache,
  "neon-http": neonHttp,
  "neon-ws": neonWs,
  "neon-cu": neonCu,
  do: durableObjects,
  publish,
  rls,
  storage,
};
