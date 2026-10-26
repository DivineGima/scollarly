#!/usr/bin/env node
/**
 * Stage 0 CPU measurement (S0.9). Drives a DEPLOYED Worker and reads the CPU time Cloudflare records for each
 * request from `wrangler tail`, then prints statistics per scenario against the architecture section 17 thresholds.
 * Wall-clock time seen by a client is NOT CPU time and is never reported as such.
 *
 *   node scripts/measure-cpu.mjs --base https://scollarly.<you>.workers.dev --token $PHASE0_PROBE_TOKEN \
 *        [--worker scollarly] [--samples 50] [--only public,admin-shell,admin-data,student-shell,student-data,lead,media,media-miss] \
 *        [--sessions scripts/.generated/probe-sessions.json] [--media <sha256>] [--media-list scripts/.generated/phase0-images.json] \
 *        [--lead-samples 50] [--lead-interval-ms 12500] [--warmup 3]
 *
 * Statistics are given twice: "all" (every request, including the first ones that pay the isolate start-up cost)
 * and "warm" (after the first --warmup requests of the scenario). The gate verdict uses warm p95, and the worst
 * request overall is shown beside it so a bad cold start is never hidden.
 *
 * Needs `wrangler login` (or CLOUDFLARE_API_TOKEN). Nothing here reads or prints a secret value.
 * The deployed Worker must use Turnstile's documented always-pass TEST secret during measurement.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { probeLead } from "./probe-lead.mjs";
import { cpuStats, drainJsonObjects } from "./ci/lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : [])),
);
const base = (args.base ?? "").replace(/\/$/, "");
const token = args.token ?? process.env.PHASE0_PROBE_TOKEN ?? "";
const worker = args.worker ?? "scollarly";
const samples = Number.parseInt(args.samples ?? "50", 10);
const warmup = Number.parseInt(args.warmup ?? "3", 10);
const only = new Set((args.only ?? "public,admin-shell,admin-data,student-shell,student-data,overview,leads-list,lead-detail,lead-write,lead-merge,lead-erase,events,content-list,analytics,student-progress,lead,media,media-miss").split(","));
const sessionsFile = args.sessions ?? "";
const leadSamples = Number.parseInt(args["lead-samples"] ?? "50", 10);
const leadIntervalMs = Number.parseInt(args["lead-interval-ms"] ?? "12500", 10); // the limiter allows 5 a minute per caller
const REQUEST_TIMEOUT_MS = 90_000;

if (!base || !token) {
  console.error("Usage: node scripts/measure-cpu.mjs --base <https://worker-url> --token <PHASE0_PROBE_TOKEN> [--samples 50] [--only a,b] [--media <sha256>]");
  process.exit(2);
}

// Thresholds from architecture section 17 (proposed, [Mine, confirm]). `null` means record only.
// The Google sign-in return trip is not scripted (it needs a person); it is read from the Worker log once, by hand.
// Stage 5 adds the lead screens' data calls and one write (architecture 8.3: a stage that builds an operation builds its CPU row).
const LIMITS = { public: 5, "admin-shell": 8, "admin-data": 8, "student-shell": 8, "student-data": 8, overview: 8, "leads-list": 8, "lead-detail": 8, "lead-write": 8, "lead-merge": 8, "lead-erase": 8, events: 8, "content-list": 8, analytics: 8, "student-progress": 8, lead: 8, media: 8, "media-miss": 8 };

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

// Proves to the Worker that this is the measurement: it skips Turnstile for these leads and stamps them so the cleanup finds them (security/measurement.ts).
const measurementHeaders = { "x-phase0-token": token };

async function scenario(name, key, fn, count = samples, delayMs = 150, matchBy = null) {
  if (!only.has(key)) return null;
  const marker = `m=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const statuses = [];
  const clientMs = [];
  const instanceNth = []; // `X-Instance-Request` of each answer, when the endpoint sends it (the lead endpoint does)
  for (let i = 0; i < count; i++) {
    const r = await fn(marker, i);
    statuses.push(r.status);
    clientMs.push(r.ms);
    const nth = Number.parseInt(r.headers?.get?.("x-instance-request") ?? "", 10);
    instanceNth.push(Number.isFinite(nth) ? nth : null);
    await sleep(delayMs);
  }
  await sleep(3000); // let the tail deliver the last events
  const decoded = (e) => {
    try {
      return decodeURIComponent(urlOf(e));
    } catch {
      return urlOf(e);
    }
  };
  const found = (e) => (typeof matchBy === "function" ? matchBy(decoded(e)) : matchBy ? decoded(e).includes(matchBy) : decoded(e).includes(marker));
  const mine = events.filter(found).sort((a, b) => a.eventTimestamp - b.eventTimestamp);
  const cpus = mine.map(cpuOf).filter((v) => v !== null);
  const stats = cpuStats(cpus, warmup);
  const exceeded = mine.filter((e) => /exceeded/i.test(e.outcome ?? "")).length;
  const limit = LIMITS[key];

  // Warm means "not the first request of its Worker instance" when the endpoint says so. A fresh instance runs the Worker's start-up
  // inside its first request (Cloudflare reports 37 to 40 ms for it at each deploy), which no handler can avoid, so those requests are
  // reported on their own and the gate judges the rest. Requests and tail events are in the same order, so they pair by position.
  const paired = cpus.length === instanceNth.length && instanceNth.some((n) => n !== null);
  const firstOfInstance = paired ? cpus.filter((_, i) => instanceNth[i] === 1) : [];
  const laterOfInstance = paired ? cpus.filter((_, i) => instanceNth[i] !== 1) : [];
  const row = {
    scenario: name,
    requests: count,
    tailEvents: mine.length,
    httpStatuses: Object.fromEntries([...new Set(statuses)].map((s) => [s, statuses.filter((x) => x === s).length])),
    cpuMs: stats,
    cpuSamplesInOrder: cpus, // every sampled event, oldest first, so a slow tail can be read request by request
    instanceRequestsInOrder: instanceNth,
    instanceSplit: paired ? { firstOfInstance: { n: firstOfInstance.length, ...cpuStats(firstOfInstance, 0).all }, laterOfInstance: { n: laterOfInstance.length, ...cpuStats(laterOfInstance, 0).all } } : null,
    exceededCpuOutcomes: exceeded,
    limitMs: limit,
    clientWallMs: { median: [...clientMs].sort((a, b) => a - b)[Math.floor(clientMs.length / 2)] },
  };
  if (cpus.length === 0) row.result = "NO CPU DATA";
  else if (limit === null) row.result = "recorded";
  else if (paired && laterOfInstance.length >= 10) row.result = exceeded === 0 && (row.instanceSplit.laterOfInstance.p95 ?? 0) <= limit ? "PASS" : "FAIL";
  else row.result = exceeded === 0 && (stats.warm.p95 ?? stats.all.p95) <= limit ? "PASS" : "FAIL";
  return row;
}

const tail = startTail();
await sleep(8000); // wait for the tail session to connect
const rows = [];

try {
  // Cached public page (static, prerendered). Gate: at most 5 ms.
  rows.push(await scenario("Public page (prerendered)", "public", (m) => call(`/?${m}`)));

  // Signed-in screens (ADR-040) with REAL Neon Auth sessions of throwaway users (scripts/ci/seed-probe-sessions.mjs): the cookie, the one
  // session query, the role from our table and row level security are all real. A screen is two requests, each with its own gate of
  // at most 8 ms: the shell (session check, then the cached page) and the data call (session check, then one query under row level security).
  if (sessionsFile && existsSync(sessionsFile)) {
    const sessions = JSON.parse(readFileSync(sessionsFile, "utf8"));
    const cookieOf = (who) => `__Secure-neon-auth.session_token=${sessions[who].token}.c2lnbmF0dXJl`;
    const as = (who) => ({ headers: { cookie: cookieOf(who) } });
    rows.push(await scenario("Staff screen, shell: session query, then the cached page", "admin-shell", (m) => call(`/admin/phase0?${m}`, as("admin"))));
    rows.push(await scenario("Staff screen, data: session query, then one query under row level security", "admin-data", (m) => call(`/api/v1/admin/phase0?${m}`, as("admin"))));
    // The lead screens (S5.1 to S5.3). Each is a data call: the session query, then the queries under row level security.
    const staff = as("admin");
    rows.push(await scenario("Staff Overview counts: one COUNT(*) FILTER statement and the funnel", "overview", (m) => call(`/api/v1/admin/overview?${m}`, staff)));
    // The list's query is strict (no marker can travel in it), so its events are found by the exact address.
    rows.push(
      await scenario("Staff leads list: the newest 51, the stage names, universities and the team", "leads-list", () => call("/api/v1/admin/leads", staff), samples, 150, (url) => url.endsWith("/api/v1/admin/leads")),
    );
    // Stages 6 and 7: the two NEW read shapes (a list of up to 300 content rows with a computed label, and the funnel with its eight
    // queries in one round trip). The content and media WRITES and the revalidate call are the same shape as the measured lead writes,
    // so they are watched in Workers Logs after the deploy instead (tracker, Session 27 rule 1).
    rows.push(await scenario("Staff content list: up to 300 rows with labels and flags", "content-list", () => call("/api/v1/admin/content-list?type=faqs", staff), samples, 150, (url) => url.includes("/api/v1/admin/content-list")));
    rows.push(await scenario("Staff analytics: funnel, sources and filters in one round trip", "analytics", () => call("/api/v1/admin/analytics", staff), samples, 150, (url) => url.endsWith("/api/v1/admin/analytics")));
    const seedLead = async (overrides = {}) => {
      const body = probeLead({ name: "Measure Probe", ...overrides });
      try {
        const created = await fetch(base + "/api/v1/leads", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...measurementHeaders },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        await sleep(leadIntervalMs);
        if (created.status !== 201) return null;
        const { ref } = await created.json();
        const listed = await fetch(`${base}/api/v1/admin/leads?q=${encodeURIComponent(ref)}`, { headers: staff.headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const id = listed.ok ? ((await listed.json()).leads?.[0]?.id ?? "") : "";
        return id ? { ref, id } : null;
      } catch {
        return null;
      }
    };
    const staffWrite = (path, payload) => call(path, { method: "POST", headers: { ...staff.headers, origin: base, "content-type": "application/json" }, body: JSON.stringify(payload) });

    // A probe lead for the detail read and the write: only probe leads are written to (the cleanup step removes their rows).
    let probeLeadId = "";
    try {
      const listed = await fetch(`${base}/api/v1/admin/leads?q=Probe`, { headers: staff.headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const body = listed.ok ? await listed.json() : { leads: [] };
      probeLeadId = body.leads.find((l) => /Probe/.test(l.name ?? ""))?.id ?? "";
    } catch {
      probeLeadId = "";
    }
    // The cleanup step removes every measurement lead at the end of a run, so none is left for this one: make one (the deploy of
    // 2026-10-26 skipped both scenarios for that reason).
    if (!probeLeadId && (only.has("lead-detail") || only.has("lead-write"))) probeLeadId = (await seedLead())?.id ?? "";
    if (probeLeadId) {
      const detailPath = `/api/v1/admin/lead?id=${probeLeadId}`;
      rows.push(await scenario("Staff lead detail: lead, programmes, timeline, notes, team, duplicates", "lead-detail", () => call(detailPath, staff), samples, 150, (url) => /\/api\/v1\/admin\/lead(\?|$)/.test(url)));
      const writePath = "/api/v1/admin/leads.logAdminWhatsAppOpen";
      rows.push(
        await scenario(
          "Staff write: log a WhatsApp open (one insert under row level security)",
          "lead-write",
          () => call(writePath, { method: "POST", headers: { ...staff.headers, origin: base, "content-type": "application/json" }, body: JSON.stringify({ leadId: probeLeadId }) }),
          samples,
          150,
          writePath,
        ),
      );
    } else if ([...only].some((k) => k === "lead-detail" || k === "lead-write")) {
      console.error("No probe lead found: the lead detail and write scenarios were skipped.");
    }
    // The remaining Stage 4 and 5 paths (S4.5, S5.4, S5.5). Each needs probe leads of its own (stamped `source.measurement`, removed by the cleanup
    // step): a merge uses up a pair and an erasure uses up a lead, so they are made first. The lead endpoint allows five a minute per caller.
    const wantsSeeded = ["events", "lead-merge", "lead-erase"].some((k) => only.has(k));
    if (wantsSeeded) {
      // S4.5: a batch with a WhatsApp tap on a real lead reference (the heaviest case: one insert) and two counted events.
      if (only.has("events")) {
        const tapLead = await seedLead();
        const sessionId = `measure-${Date.now()}`;
        const events = [
          ...(tapLead ? [{ type: "wa_tap", session_id: sessionId, lead_ref: tapLead.ref }] : []),
          { type: "page_view", session_id: sessionId, page_group: "home" },
          { type: "form_start", session_id: sessionId },
        ];
        // The events endpoint allows 30 a minute per caller, so the requests are spaced out.
        rows.push(await scenario("Events POST (WhatsApp tap and counted events), edge handler", "events", (m) => call(`/api/v1/events?${m}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) }), 50, 2200));
      }

      // S5.4: merge a duplicate pair (one transaction in the database, audited).
      if (only.has("lead-merge")) {
        const pairs = [];
        for (let i = 0; i < 12; i++) {
          const whatsapp = probeLead().whatsapp;
          const a = await seedLead({ whatsapp });
          const b = await seedLead({ whatsapp });
          if (a && b) pairs.push([a.id, b.id]);
        }
        const mergePath = "/api/v1/admin/leads.resolveDuplicate";
        rows.push(
          await scenario(
            "Staff write: merge a duplicate pair (one database function)",
            "lead-merge",
            (_m, i) => staffWrite(mergePath, { keepId: pairs[i][0], otherId: pairs[i][1], decision: "merged" }),
            pairs.length,
            600,
            mergePath,
          ),
        );
      }

      // S5.5: erase a lead (all or nothing, in one database function).
      if (only.has("lead-erase")) {
        const victims = [];
        for (let i = 0; i < 12; i++) {
          const v = await seedLead();
          if (v) victims.push(v.id);
        }
        const erasePath = "/api/v1/admin/leads.eraseLead";
        rows.push(
          await scenario(
            "Staff write: erase a lead (one database function)",
            "lead-erase",
            (_m, i) => staffWrite(erasePath, { leadId: victims[i], identityConfirmed: true }),
            victims.length,
            600,
            erasePath,
          ),
        );
      }
    }
    rows.push(await scenario("Student screen, shell: session query, then the cached page", "student-shell", (m) => call(`/me/phase0?${m}`, as("student"))));
    rows.push(await scenario("Student /me progress: own lead, stages, claims and the WhatsApp setting", "student-progress", () => call("/api/v1/me/progress", as("student")), samples, 150, (url) => url.endsWith("/api/v1/me/progress")));
    rows.push(await scenario("Student screen, data: session query, then one query under row level security", "student-data", (m) => call(`/api/v1/me/phase0?${m}`, as("student"))));
  } else if ([...only].some((k) => /^(admin|student)-/.test(k))) {
    console.error("No --sessions file: the staff and student scenarios were skipped.");
  }


  // Lead POST, run by the Worker entry before Next.js starts. Gate: at most 8 ms over at least 50 requests. The limiter allows
  // 5 a minute per caller, so the requests are spaced out (about 10 minutes for 50).
  rows.push(
    await scenario(
      "Lead POST (quick lead), edge handler",
      "lead",
      (m) =>
        call(`/api/v1/leads?${m}`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...measurementHeaders },
          body: JSON.stringify(probeLead({ name: "Measure Probe" })),
        }),
      leadSamples,
      leadIntervalMs,
    ),
  );

  // Image hit: one image requested many times (the first request fills the cache, the rest are hits). Gate: at most 8 ms, no database.
  if (args.media) rows.push(await scenario("Image serve, cache hit (300 KB)", "media", (m) => call(`/media/${args.media}.webp?${m}`)));

  // Image miss: each image is requested once, so every request is a first request (read from Neon Object Storage, then cached).
  if (args["media-list"] && existsSync(args["media-list"])) {
    const list = JSON.parse(readFileSync(args["media-list"], "utf8"));
    const fresh = list.shas.slice(1); // the first image is the one used for the hit scenario
    rows.push(await scenario("Image serve, first request (cache miss, read from storage)", "media-miss", (m, i) => call(`/media/${fresh[i]}.webp?${m}`), fresh.length));
  }
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
    "warm p95": f(r.instanceSplit ? r.instanceSplit.laterOfInstance.p95 : r.cpuMs.warm.p95),
    "first-of-instance n": f(r.instanceSplit?.firstOfInstance.n),
    "first-of-instance worst": f(r.instanceSplit?.firstOfInstance.max),
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
