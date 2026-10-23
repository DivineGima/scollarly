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
