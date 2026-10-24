/**
 * Small, pure helpers for the Stage 0 deploy workflow. They are kept here (and unit tested) so the
 * workflow YAML stays thin and the parts that can go wrong are checked before they run in CI.
 */

export const KV_PLACEHOLDER = "REPLACE_ME_KV_NAMESPACE_ID";
export const D1_PLACEHOLDER = "REPLACE_ME_D1_DATABASE_ID";
export const KV_TITLE = "scollarly-next-inc-cache";
export const D1_NAME = "scollarly-next-tag-cache";

/** Fills the two placeholder IDs in wrangler.jsonc. Throws if either is missing, so a stale config is never deployed silently. */
export function patchWranglerConfig(text, { kvId, d1Id }) {
  if (!/^[0-9a-f]{32}$/i.test(kvId ?? "")) throw new Error("KV namespace id must be 32 hex characters");
  if (!/^[0-9a-f-]{36}$/i.test(d1Id ?? "")) throw new Error("D1 database id must be a UUID");
  if (!text.includes(KV_PLACEHOLDER)) throw new Error("KV placeholder not found in wrangler.jsonc");
  if (!text.includes(D1_PLACEHOLDER)) throw new Error("D1 placeholder not found in wrangler.jsonc");
  return text.replaceAll(KV_PLACEHOLDER, kvId).replaceAll(D1_PLACEHOLDER, d1Id);
}

/** Reads the `sha256: <hex>` line printed by scripts/seed-phase0-image.mjs. */
export function parseSeedSha(output) {
  const match = /^sha256:\s*([0-9a-f]{64})\s*$/im.exec(output);
  if (!match) throw new Error("seed script output has no sha256 line");
  return match[1].toLowerCase();
}

/** `https://<worker>.<subdomain>.workers.dev` from the account's workers.dev subdomain. */
export function workersDevUrl(workerName, subdomain) {
  if (!/^[a-z0-9-]+$/.test(workerName ?? "")) throw new Error("invalid worker name");
  if (!/^[a-z0-9-]+$/.test(subdomain ?? "")) throw new Error("this account has no workers.dev subdomain yet");
  return `https://${workerName}.${subdomain}.workers.dev`;
}

/** Quantile of a numeric list (nearest rank). Returns null for an empty list. */
export function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Markdown table for the GitHub job summary. Cells are escaped so a stray pipe cannot break the table. */
export function markdownTable(rows) {
  const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = ["| Check | Result | Detail |", "|---|---|---|"];
  for (const r of rows) {
    const result = r.pass === true ? "PASS" : r.pass === false ? "FAIL" : "info";
    lines.push(`| ${cell(r.name)} | ${result} | ${cell(typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail))} |`);
  }
  return lines.join("\n");
}

/**
 * `wrangler tail --format json` prints pretty-printed, multi-line JSON, so it cannot be read line by line.
 * Takes the text received so far and returns every COMPLETE top-level JSON object in it, plus the unfinished
 * remainder to keep for the next chunk. Braces inside strings are ignored.
 */
export function drainJsonObjects(buffer) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let consumed = 0;
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = depth > 0;
    else if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}" && depth > 0 && --depth === 0) {
      objects.push(buffer.slice(start, i + 1));
      consumed = i + 1;
      start = -1;
    }
  }
  return { objects, rest: depth > 0 && start >= 0 ? buffer.slice(start) : buffer.slice(consumed).replace(/^[^{]*/, "") };
}

/** Nearest-rank statistics for a list of CPU times, with the first `warmup` samples also reported separately. */
export function cpuStats(values, warmup = 3) {
  const all = values;
  const warm = values.slice(warmup);
  const stat = (v) => ({ n: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95), max: v.length ? Math.max(...v) : null });
  return { all: stat(all), warm: stat(warm) };
}

/**
 * The Worker's connection string (ADR-038): the pooled OWNER string with its credentials swapped for the non-owner `app_runtime`
 * role. Host, database and parameters are kept, so the Worker uses the same pooled endpoint. Throws on a string that is not a URL.
 */
export function buildRuntimeUrl(pooledOwnerUrl, password) {
  const url = new URL(pooledOwnerUrl);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("Not a Postgres connection string");
  url.username = "app_runtime";
  url.password = password;
  return url.toString();
}
