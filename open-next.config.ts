import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

/**
 * S0.6: the OpenNext cache bindings Stage 0 tests (architecture sections 6.1 and 17).
 *
 *   incremental cache  KV   binding NEXT_INC_CACHE_KV      free, no payment method expected
 *   tag cache          D1   binding NEXT_TAG_CACHE_D1      free, no payment method expected
 *   queue              DO   binding NEXT_CACHE_DO_QUEUE    SQLite-backed Durable Object, free plan
 *
 * Not used: the read-only static-assets cache (it cannot revalidate) and R2 (whether R2 needs a
 * payment method is unchecked; if KV proves unusable, R2 is the alternative and the owner decides, G6).
 * OpenNext discourages KV for incremental cache; the gate is whether it revalidates a published
 * page without a deploy on the free plan. The measured outcome goes in the tracker.
 */
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  tagCache: d1NextTagCache,
  queue: doQueue,
});
