#!/usr/bin/env node
/**
 * Creates (or finds) the two Cloudflare resources OpenNext needs, then writes their IDs into wrangler.jsonc
 * in the CI workspace only (never committed). It is safe to run repeatedly: it looks the resources up by name first.
 *
 *   KV namespace  scollarly-next-inc-cache   -> binding NEXT_INC_CACHE_KV (incremental cache)
 *   D1 database   scollarly-next-tag-cache   -> binding NEXT_TAG_CACHE_D1 (tag cache)
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Prints names and IDs, never the token.
 * Records whether Cloudflare asked for a payment method (a 402/403 message about billing), because
 * that answer is the S0.6 finding.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { D1_NAME, KV_TITLE, patchWranglerConfig } from "./lib.mjs";

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.");
  process.exit(2);
}

const api = async (method, path, body) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const errors = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${response.status}`;
    const billing = /payment|billing|card|subscription/i.test(errors) ? " [PAYMENT METHOD REQUIRED?]" : "";
    throw new Error(`${method} ${path} failed: ${errors}${billing}`);
  }
  return json.result;
};

const kvList = await api("GET", `/accounts/${account}/storage/kv/namespaces?per_page=100`);
let kv = kvList.find((n) => n.title === KV_TITLE);
const kvCreated = !kv;
if (!kv) kv = await api("POST", `/accounts/${account}/storage/kv/namespaces`, { title: KV_TITLE });
console.log(`KV namespace "${KV_TITLE}": ${kvCreated ? "created" : "already existed"} (${kv.id})`);

const d1List = await api("GET", `/accounts/${account}/d1/database?name=${encodeURIComponent(D1_NAME)}`);
let d1 = d1List.find((d) => d.name === D1_NAME);
const d1Created = !d1;
if (!d1) d1 = await api("POST", `/accounts/${account}/d1/database`, { name: D1_NAME });
console.log(`D1 database "${D1_NAME}": ${d1Created ? "created" : "already existed"} (${d1.uuid})`);

const file = "wrangler.jsonc";
writeFileSync(file, patchWranglerConfig(readFileSync(file, "utf8"), { kvId: kv.id, d1Id: d1.uuid }));
console.log(`${file} updated in this workspace (not committed).`);
console.log("S0.6 finding: KV and D1 are usable on this account with no payment-method error from Cloudflare.");

if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kv_id=${kv.id}\nd1_id=${d1.uuid}\n`);
