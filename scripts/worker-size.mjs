#!/usr/bin/env node
/**
 * Gate "Worker size" (architecture 12 and 17): the compressed Worker must be at most 2.6 MiB,
 * which leaves about 15% headroom under the Workers Free limit of 3 MiB.
 *
 * Run after `npm run build:worker`. It asks Wrangler for a dry-run deploy (nothing is uploaded) and
 * reads the compressed size Wrangler reports, which is the number Cloudflare enforces.
 *
 *   node scripts/worker-size.mjs            human summary, exit 1 above the limit
 *   node scripts/worker-size.mjs --json     machine-readable
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const LIMIT_MIB = 2.6;
const FREE_PLAN_LIMIT_MIB = 3;
const asJson = process.argv.includes("--json");

if (!existsSync(".open-next/worker.js")) {
  console.error("Missing .open-next/worker.js. Run `npm run build:worker` first.");
  process.exit(2);
}

const outdir = ".wrangler/dry-run";
mkdirSync(outdir, { recursive: true });
const result = spawnSync("npx", ["wrangler", "deploy", "--dry-run", "--outdir", outdir], { encoding: "utf8", shell: true });
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

const match = output.match(/Total Upload:\s*([\d.,]+)\s*(KiB|MiB)\s*\/\s*gzip:\s*([\d.,]+)\s*(KiB|MiB)/i);
if (result.status !== 0 || !match) {
  console.error(output.trim().split("\n").slice(-25).join("\n"));
  console.error("\nCould not read the size from Wrangler's dry run.");
  process.exit(2);
}

const toMiB = (value, unit) => (Number.parseFloat(value.replace(/,/g, "")) * (unit.toLowerCase() === "kib" ? 1 : 1024)) / 1024;
const rawMiB = toMiB(match[1], match[2]);
const gzipMiB = toMiB(match[3], match[4]);
const pass = gzipMiB <= LIMIT_MIB;

const report = {
  gate: "Worker size",
  rawMiB: Number(rawMiB.toFixed(3)),
  gzipMiB: Number(gzipMiB.toFixed(3)),
  limitMiB: LIMIT_MIB,
  freePlanLimitMiB: FREE_PLAN_LIMIT_MIB,
  headroomMiB: Number((FREE_PLAN_LIMIT_MIB - gzipMiB).toFixed(3)),
  result: pass ? "PASS" : "FAIL",
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Worker size (compressed): ${report.gzipMiB} MiB   limit ${LIMIT_MIB} MiB   free-plan hard limit ${FREE_PLAN_LIMIT_MIB} MiB`);
  console.log(`Uncompressed: ${report.rawMiB} MiB   headroom to the hard limit: ${report.headroomMiB} MiB`);
  console.log(`Result: ${report.result}`);
  if (!pass) console.log("Options if this fails (architecture 17): split admin routes into a second Worker, replace heavy libraries, or a paid plan (owner decides).");
}
process.exit(pass ? 0 : 1);
