#!/usr/bin/env node
/**
 * Stage 0 CPU measurement (S0.9). Drives a DEPLOYED Worker and reads the CPU time Cloudflare records for each
 * request from `wrangler tail`, then prints statistics per scenario against the architecture section 17 thresholds.
 * Wall-clock time seen by a client is NOT CPU time and is never reported as such.
 *
 *   node scripts/measure-cpu.mjs --base https://scollarly.<you>.workers.dev --token $PHASE0_PROBE_TOKEN \
 *        [--worker scollarly] [--samples 50] [--only public,signin,admin,student,lead,media] [--staff-variant pbkdf2] \
 *        [--media <sha256>] [--warmup 3]
 *
 * Statistics are given twice: "all" (every request, including the first ones that pay the isolate start-up cost)
 * and "warm" (after the first --warmup requests of the scenario). The gate verdict uses warm p95, and the worst
 * request overall is shown beside it so a bad cold start is never hidden.
 *
 * Needs `wrangler login` (or CLOUDFLARE_API_TOKEN). Nothing here reads or prints a secret value.
 * The deployed Worker must use Turnstile's documented always-pass TEST secret during measurement.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpuStats, drainJsonObjects } from "./ci/lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : [])),
);
const base = (args.base ?? "").replace(/\/$/, "");
const token = args.token ?? process.env.PHASE0_PROBE_TOKEN ?? "";
const worker = args.worker ?? "scollarly";
const samples = Number.parseInt(args.samples ?? "50", 10);
const warmup = Number.parseInt(args.warmup ?? "3", 10);
const staffVariant = args["staff-variant"] ?? "pbkdf2";
const only = new Set((args.only ?? "public,signin,admin,student,lead,media").split(","));
const REQUEST_TIMEOUT_MS = 90_000;

if (!base || !token) {
  console.error("Usage: node scripts/measure-cpu.mjs --base <https://worker-url> --token <PHASE0_PROBE_TOKEN> [--samples 50] [--only a,b] [--media <sha256>]");
  process.exit(2);
}

// Thresholds from architecture section 17 (proposed, [Mine, confirm]). `null` means record only.
const LIMITS = { public: 5, signin: 10, admin: 8, student: null, lead: 8, media: 8 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];

/** Starts `wrangler tail` directly (no shell), so it can be stopped reliably on every platform. */
function startTail() {
  const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  const child = spawn(process.execPath, [wranglerBin, "tail", worker, "--format", "json"], { stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const { objects, rest } = drainJsonObjects(buffer);
    buffer = rest;
    for (const text of objects) {
      try {
        events.push(JSON.parse(text));
      } catch {
        /* a fragment that is not an event */
      }
    }
  });
  child.stderr.on("data", () => {});
  return child;
}

const cpuOf = (e) => (typeof e.cpuTime === "number" ? e.cpuTime : null);
const urlOf = (e) => e.event?.request?.url ?? "";

async function call(path, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
    await response.arrayBuffer();
    return { status: response.status, ms: performance.now() - started, headers: response.headers };
  } catch (error) {
    return { status: 0, ms: performance.now() - started, headers: new Headers(), error: error?.name ?? "Error" };
  }
}

const probeHeaders = { "x-phase0-token": token };

async function scenario(name, key, fn, count = samples) {
  if (!only.has(key)) return null;
  const marker = `m=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const statuses = [];
  const clientMs = [];
  for (let i = 0; i < count; i++) {
    const r = await fn(marker, i);
    statuses.push(r.status);
    clientMs.push(r.ms);
    await sleep(150);
  }
  await sleep(3000); // let the tail deliver the last events
  const mine = events.filter((e) => urlOf(e).includes(marker)).sort((a, b) => a.eventTimestamp - b.eventTimestamp);
  const cpus = mine.map(cpuOf).filter((v) => v !== null);
  const stats = cpuStats(cpus, warmup);
  const exceeded = mine.filter((e) => /exceeded/i.test(e.outcome ?? "")).length;
  const limit = LIMITS[key];
  const row = {
    scenario: name,
    requests: count,
    tailEvents: mine.length,
    httpStatuses: Object.fromEntries([...new Set(statuses)].map((s) => [s, statuses.filter((x) => x === s).length])),
    cpuMs: stats,
    exceededCpuOutcomes: exceeded,
    limitMs: limit,
    clientWallMs: { median: [...clientMs].sort((a, b) => a - b)[Math.floor(clientMs.length / 2)] },
  };
  if (cpus.length === 0) row.result = "NO CPU DATA";
  else if (limit === null) row.result = "recorded";
  else row.result = exceeded === 0 && (stats.warm.p95 ?? stats.all.p95) <= limit ? "PASS" : "FAIL";
  return row;
}

const tail = startTail();
await sleep(8000); // wait for the tail session to connect
const rows = [];

try {
  // Cached public page (static, prerendered). Gate: at most 5 ms.
  rows.push(await scenario("Public page (prerendered)", "public", (m) => call(`/?${m}`)));

  // Password sign-in for each hash variant. Gate: at most 10 ms, no Error 1102 over 50 sign-ins.
  for (const variant of ["default", "pbkdf2", "passwordless"]) {
    rows.push(await scenario(`Sign-in: ${variant}`, "signin", (m) => call(`/api/v1/probe/signin-${variant}?${m}`, { headers: probeHeaders })));
  }

  // Authenticated stub pages. Gate: at most 8 ms for staff (fresh lookup); the student cookie-cache path is recorded.
  const sessionCookie = async (role) => {
    const res = await fetch(`${base}/api/v1/probe/signin-${staffVariant}?role=${role}`, { headers: probeHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    await res.arrayBuffer();
    return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  };
  if (only.has("admin")) {
    const cookie = await sessionCookie("admin");
    rows.push(await scenario(`Admin page, fresh session lookup (cookie ${cookie ? "present" : "MISSING"})`, "admin", (m) => call(`/admin/phase0?${m}`, { headers: { cookie } })));
  }
  if (only.has("student")) {
    const cookie = await sessionCookie("student");
    rows.push(await scenario(`Student page, cookie cache (cookie ${cookie ? "present" : "MISSING"})`, "student", (m) => call(`/me/phase0?${m}`, { headers: { cookie } })));
  }

  // Lead POST stub. Gate: at most 8 ms. The limiter allows 5 a minute per caller, so only 4 requests are sent.
  rows.push(
    await scenario(
      "Lead POST (stub)",
      "lead",
      (m) =>
        call(`/api/v1/leads?${m}`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ name: "Measure Probe", whatsapp: "+237651232301", country_code: "CM", turnstile_token: "dummy" }),
        }),
      Math.min(samples, 4),
    ),
  );

  // Image served through the Cache API (cache hits after the first request).
  if (args.media) rows.push(await scenario("Image serve (300 KB)", "media", (m) => call(`/media/${args.media}.webp?${m}`)));
} finally {
  tail.kill();
}

mkdirSync("scripts/.generated", { recursive: true });
const file = `scripts/.generated/measurements-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const report = rows.filter(Boolean);
writeFileSync(file, JSON.stringify({ base, measuredAt: new Date().toISOString(), samples, warmup, report }, null, 2));

const f = (v) => (v === null || v === undefined ? "-" : v);
console.table(
  report.map((r) => ({
    scenario: r.scenario,
    n: r.requests,
    events: r.tailEvents,
    "warm p50": f(r.cpuMs.warm.p50),
    "warm p95": f(r.cpuMs.warm.p95),
    "all p95": f(r.cpuMs.all.p95),
    "worst": f(r.cpuMs.all.max),
    limit: f(r.limitMs),
    exceeded: r.exceededCpuOutcomes,
    http: JSON.stringify(r.httpStatuses),
    result: r.result,
  })),
);
console.log(`\nCPU times are milliseconds from wrangler tail. Written to ${file}`);
process.exit(0);
