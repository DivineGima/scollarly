#!/usr/bin/env node
/**
 * Public bundle check (S3.5, essentials Stage 3 exit criteria). Run after `next build`.
 *
 *  1. First-load JavaScript of every public route, gzipped, stays under the ceiling below.
 *  2. No admin-only library reaches a public route: none of the JavaScript files a public route loads contains the
 *     fingerprint of Recharts, tailwind-merge or class-variance-authority (the admin UI's building blocks).
 *
 * The 100 KB gzip budget in architecture 6.3 is marked [Mine, confirm] and is below what the framework alone costs
 * (Next.js App Router plus React is about 104 KB gzip with no component of ours; tracker flag H9, Session 3). Until the owner
 * decides, the gate is the measured framework baseline plus a small allowance for our own islands, so a regression
 * (a new heavy dependency, an island that grows) still fails the build.
 */
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const ROOT = process.cwd();
const NEXT = join(ROOT, ".next");

/** Framework baseline (104 KB, measured 2026-10-25) plus 14 KB for our islands. Proposal, pending the owner's answer on H9. */
const CEILING_KB = Number(process.env.PUBLIC_JS_CEILING_KB ?? 118);
/** The architecture figure, printed for the record. */
const ARCHITECTURE_BUDGET_KB = 100;

/** Substrings that only the admin libraries contain. They survive minification because they are property names or class names. */
const FORBIDDEN = [
  { name: "Recharts", marker: "recharts-" },
  { name: "class-variance-authority", marker: "compoundVariants" },
  { name: "tailwind-merge", marker: "break-after" },
];

const manifestPath = join(NEXT, "app-build-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("No .next/app-build-manifest.json. Run `next build` first.");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const routes = Object.entries(manifest.pages).filter(([route]) => route.includes("/(public)/") && route.endsWith("/page"));
if (routes.length === 0) {
  console.error("No public routes found in the build manifest.");
  process.exit(2);
}

const cache = new Map();
function inspect(file) {
  if (!cache.has(file)) {
    const bytes = readFileSync(join(NEXT, file));
    cache.set(file, { gzip: gzipSync(bytes).length, text: bytes.toString("utf8") });
  }
  return cache.get(file);
}

let failed = false;
const rows = [];
for (const [route, files] of routes) {
  const js = files.filter((f) => f.endsWith(".js"));
  let gzip = 0;
  const found = new Set();
  for (const file of js) {
    const info = inspect(file);
    gzip += info.gzip;
    for (const { name, marker } of FORBIDDEN) if (info.text.includes(marker)) found.add(name);
  }
  const kb = gzip / 1024;
  const problems = [];
  if (kb > CEILING_KB) problems.push(`first load ${kb.toFixed(1)} KB gzip is over the ${CEILING_KB} KB ceiling`);
  if (found.size > 0) problems.push(`contains admin library code: ${[...found].join(", ")}`);
  if (problems.length > 0) failed = true;
  rows.push({ route, kb: kb.toFixed(1), problems });
}

console.log(`Public routes: first-load JS, gzip (ceiling ${CEILING_KB} KB; architecture budget ${ARCHITECTURE_BUDGET_KB} KB, see H9)`);
for (const row of rows) console.log(`${row.problems.length > 0 ? "FAIL" : "ok  "} ${row.kb.padStart(6)} KB  ${row.route}${row.problems.length ? `  <- ${row.problems.join("; ")}` : ""}`);
if (failed) {
  console.error("\nPublic bundle check failed.");
  process.exit(1);
}
console.log("\nPublic bundle check passed.");
