#!/usr/bin/env node
/**
 * Stage 0 CPU measurement (S0.9). Drives a DEPLOYED Worker and reads the CPU time Cloudflare records
 * for each request from `wrangler tail`, then prints p50/p95/max per scenario against the architecture
 * section 17 thresholds. Wall-clock timings from a client are NOT CPU time, so they are never reported as such.
 *
 *   node scripts/measure-cpu.mjs --base https://scollarly.<you>.workers.dev --token $PHASE0_PROBE_TOKEN \
 *        [--worker scollarly] [--samples 50] [--only public,signin,admin,student,lead,media] [--staff-variant pbkdf2]
 *
 * Needs `wrangler login` (or CLOUDFLARE_API_TOKEN). Nothing here reads or prints a secret value.
 * The deployed Worker must use Turnstile's documented always-pass TEST secret during measurement
 * (1x0000000000000000000000000000000AA) so the lead POST can be exercised with a dummy token.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : [])),
);
const base = (args.base ?? "").replace(/\/$/, "");
const token = args.token ?? process.env.PHASE0_PROBE_TOKEN ?? "";
const worker = args.worker ?? "scollarly";
const samples = Number.parseInt(args.samples ?? "50", 10);
const staffVariant = args["staff-variant"] ?? "pbkdf2";
const only = new Set((args.only ?? "public,signin,admin,student,lead,media").split(","));

if (!base || !token) {
  console.error("Usage: node scripts/measure-cpu.mjs --base <https://worker-url> --token <PHASE0_PROBE_TOKEN> [--samples 50] [--only a,b] [--staff-variant pbkdf2]");
  process.exit(2);
}

// Thresholds from architecture section 17 (proposed, [Mine, confirm]).
const LIMITS = { public: 5, signin: 10, admin: 8, student: 8, lead: 8, media: 8 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];

function startTail() {
  const child = spawn("npx", ["wrangler", "tail", worker, "--format", "json"], { shell: true });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* partial line */
      }
    }
  });
  child.stderr.on("data", () => {});
  return child;
}

const cpuOf = (e) => e.cpuTime ?? e.cpuTimeMs ?? e.event?.cpuTime ?? null;
const pathOf = (e) => {
  try {
    return new URL(e.event?.request?.url ?? "").pathname + (new URL(e.event.request.url).search || "");
  } catch {
    return "";
  }
};

async function call(path, init = {}) {
  const started = performance.now();
  const response = await fetch(base + path, { redirect: "manual", ...init });
  await response.arrayBuffer();
  return { status: response.status, ms: performance.now() - started, headers: response.headers };
}

const probeHeaders = { "x-phase0-token": token };
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);

async function scenario(name, key, fn, count = samples) {
  if (!only.has(key)) return null;
  const marker = `m=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outcomes = [];
  for (let i = 0; i < count; i++) {
    outcomes.push((await fn(marker, i)).status);
    await sleep(120);
  }
  await sleep(2500); // let the tail deliver the last events
  const mine = events.filter((e) => pathOf(e).includes(marker));
  const cpus = mine.map(cpuOf).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const exceeded = mine.filter((e) => /exceeded/i.test(e.outcome ?? "")).length;
  const row = {
    scenario: name,
    requests: count,
    tailEvents: mine.length,
    httpStatuses: [...new Set(outcomes)],
    cpuMs: { p50: quantile(cpus, 0.5), p95: quantile(cpus, 0.95), max: cpus.at(-1) ?? null },
    exceededCpuOutcomes: exceeded,
    limitMs: LIMITS[key],
  };
  row.result = cpus.length === 0 ? "NO CPU DATA (tail did not report cpuTime; read it from the dashboard)" : exceeded === 0 && row.cpuMs.p95 <= LIMITS[key] ? "PASS" : "FAIL";
  return row;
}

const tail = startTail();
await sleep(6000); // wait for the tail session to connect
const rows = [];

// Cached public page, after one warm-up so it is served from cache. Gate: at most 5 ms.
rows.push(await scenario("Public page (cached)", "public", (m) => call(`/?${m}`)));

// Password sign-in for each hash variant. Gate: at most 10 ms, no Error 1102 over 50 sign-ins.
for (const variant of ["default", "pbkdf2", "passwordless"]) {
  rows.push(await scenario(`Sign-in: ${variant}`, "signin", (m) => call(`/api/v1/probe/signin-${variant}?${m}`, { headers: probeHeaders })));
}

// Authenticated stub pages. Gate: at most 8 ms (fresh lookup for staff; cookie cache recorded for students).
async function sessionCookie(role) {
  const res = await fetch(`${base}/api/v1/probe/signin-${staffVariant}?role=${role}`, { headers: probeHeaders });
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}
if (only.has("admin")) {
  const cookie = await sessionCookie("admin");
  rows.push(await scenario("Admin page, fresh session lookup (staff)", "admin", (m) => call(`/admin/phase0?${m}`, { headers: { cookie } })));
}
if (only.has("student")) {
  const cookie = await sessionCookie("student");
  rows.push(await scenario("Student page, cookie cache (record only)", "student", (m) => call(`/me/phase0?${m}`, { headers: { cookie } })));
}

// Lead POST stub. Gate: at most 8 ms. Each request has its own idempotency key and a fresh token.
rows.push(
  await scenario(
    "Lead POST (stub)",
    "lead",
    (m, i) =>
      call(`/api/v1/leads?${m}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ name: "Measure Probe", whatsapp: "+237651232301", country_code: "CM", turnstile_token: `dummy-${i}` }),
      }),
    Math.min(samples, 4), // the limiter allows 5 a minute per caller; more would measure the 429 path
  ),
);

// Image serve: first call is a miss (reads the database), the rest are cache hits. Needs `npm run phase0:seed-image`.
if (args.media) {
  rows.push(await scenario("Image serve (300 KB)", "media", (m) => call(`/media/${args.media}.webp?${m}`)));
}

tail.kill();
mkdirSync("scripts/.generated", { recursive: true });
const file = `scripts/.generated/measurements-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const report = rows.filter(Boolean);
writeFileSync(file, JSON.stringify({ base, measuredAt: new Date().toISOString(), samples, report }, null, 2));

console.table(report.map((r) => ({ scenario: r.scenario, n: r.requests, events: r.tailEvents, "p50 ms": r.cpuMs.p50, "p95 ms": r.cpuMs.p95, "max ms": r.cpuMs.max, "limit ms": r.limitMs, exceeded: r.exceededCpuOutcomes, result: r.result })));
console.log(`\nWritten to ${file}`);
console.log("Cold start, Cache API, Durable Object, cron and revalidation probes are separate: see docs/stage-0-runbook.md.");
process.exit(0);
