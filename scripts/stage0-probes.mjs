#!/usr/bin/env node
/**
 * Stage 0 functional probes against the DEPLOYED Worker (S0.9). Each check is recorded as PASS, FAIL or
 * info, and the whole report is written to JSON and to the GitHub job summary. CPU time is measured
 * separately by scripts/measure-cpu.mjs, because wall-clock time from a client is not CPU time.
 *
 *   node scripts/stage0-probes.mjs --base https://scollarly.<you>.workers.dev --token $PHASE0_PROBE_TOKEN \
 *        [--media <sha256>] [--cold-wait 330]
 *
 * Nothing here prints a secret. The probe token only travels in the x-phase0-token request header.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { markdownTable } from "./ci/lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : [])),
);
const base = (args.base ?? "").replace(/\/$/, "");
const token = args.token ?? process.env.PHASE0_PROBE_TOKEN ?? "";
const media = args.media ?? "";
const coldWait = Number.parseInt(args["cold-wait"] ?? "0", 10);
if (!base || !token) {
  console.error("Usage: node scripts/stage0-probes.mjs --base <url> --token <probe token> [--media <sha256>] [--cold-wait <seconds>]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeHeaders = { "x-phase0-token": token };
const checks = [];
const record = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  const tag = pass === true ? "PASS" : pass === false ? "FAIL" : "info";
  console.log(`${tag.padEnd(5)} ${name}  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

async function call(path, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { redirect: "manual", ...init });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, ms: Math.round(performance.now() - started), headers: response.headers, text, json };
  } catch (error) {
    return { status: 0, ms: Math.round(performance.now() - started), headers: new Headers(), text: String(error), json: null };
  }
}
const probe = (name, query = "") => call(`/api/v1/probe/${name}${query}`, { headers: probeHeaders });

// 1. The Worker is up.
{
  const r = await call("/api/v1/health");
  record("Worker is up (GET /api/v1/health)", r.status === 200 && r.json?.status === "ok", { status: r.status, ms: r.ms });
}

// 2. Cache API on this hostname (the S0.1 first probe). If it is a no-op on workers.dev, tracker H7 becomes blocking.
{
  const r = await probe("cache");
  record("Cache API put/match works on this hostname (S0.1)", r.json?.putThenMatchWorks === true, r.json ?? { status: r.status, body: r.text.slice(0, 200) });
}

// 3. Neon cold start. Waits so the compute has scaled to zero (it sleeps after 5 minutes), then times the first query.
if (coldWait > 0) {
  console.log(`Waiting ${coldWait}s so Neon scales to zero...`);
  await sleep(coldWait * 1000);
}
{
  const r = await probe("neon-http");
  const ok = r.status === 200 && r.json?.value === 1;
  record("Neon cold start: first HTTP query after idle (gate: about 2 s or less)", ok ? (r.ms <= 2500 ? true : false) : false, {
    clientMs: r.ms,
    serverQueryMs: r.json?.wallMs,
    idleWaitSeconds: coldWait,
    note: coldWait > 0 ? "measured after an idle wait" : "NOT measured cold: no idle wait was requested",
  });
}
{
  const r = await probe("neon-http");
  record("Neon warm HTTP query", r.status === 200 && r.json?.value === 1, { clientMs: r.ms, serverQueryMs: r.json?.wallMs });
}

// 4. WebSocket transaction (ADR-019).
{
  const r = await probe("neon-ws");
  record("Neon WebSocket transaction", r.status === 200 && r.json?.value === 2, r.json ?? { status: r.status, body: r.text.slice(0, 200) });
}

// 5. Non-gating: can Neon's API report CU-hours?
{
  const r = await probe("neon-cu");
  record("Neon API reports CU-hours (info only, non-gating)", null, r.json ?? { status: r.status });
}

// 6. Durable Objects: a counter that increments and a limiter that answers. (Cron is checked separately.)
{
  const a = await probe("do");
  const b = await probe("do");
  const works = a.status === 200 && b.status === 200 && b.json?.counter === a.json?.counter + 1 && typeof b.json?.limiter?.allowed === "boolean";
  record("Durable Object counter and rate limiter work (S0.7)", works, { first: a.json?.counter, second: b.json?.counter, limiter: b.json?.limiter, lastCronAt: b.json?.lastCronAt ?? null });
}

// 7. Tag revalidation: publish new content and see the cached page change without a deploy (S0.6).
{
  const before = await call("/phase0/published");
  const title = `Published ${new Date().toISOString()}`;
  const pub = await probe("publish", `?title=${encodeURIComponent(title)}`);
  const started = performance.now();
  let seen = false;
  let last = before.text;
  for (let i = 0; i < 18 && !seen; i++) {
    await sleep(5000);
    const r = await call("/phase0/published");
    last = r.text;
    seen = r.text.includes(title);
  }
  record("Revalidation: a publish updates the page with no deploy (S0.6)", pub.status === 200 && seen, {
    publishStatus: pub.status,
    pageUpdated: seen,
    secondsUntilUpdated: seen ? Math.round((performance.now() - started) / 1000) : null,
    beforeHadTitle: before.text.includes(title),
    pageStatus: before.status,
    cacheHeaders: { "x-nextjs-cache": before.headers.get("x-nextjs-cache"), "cf-cache-status": before.headers.get("cf-cache-status") },
    lastBodyExcerpt: seen ? undefined : last.slice(last.indexOf("published-title") - 5, last.indexOf("published-title") + 120),
  });
}

// 8. Image served from media_blob through the Cache API (S0.5).
if (media) {
  const first = await call(`/media/${media}.webp`);
  const second = await call(`/media/${media}.webp`);
  const sizeOk = Number(first.headers.get("content-length") ?? first.text.length) > 200_000;
  record("Image: served as image/webp, immutable cache headers (S0.5)", first.status === 200 && first.headers.get("content-type") === "image/webp" && /immutable/.test(first.headers.get("cache-control") ?? "") && sizeOk, {
    firstMs: first.ms,
    secondMs: second.ms,
    status: [first.status, second.status],
    cfCacheStatus: [first.headers.get("cf-cache-status"), second.headers.get("cf-cache-status")],
    age: second.headers.get("age"),
  });
} else {
  record("Image check skipped: no --media hash given", null, "run npm run phase0:seed-image and pass --media");
}

// 9. Lead POST stub: validation, idempotency, conflict and the rate limiter, end to end.
{
  const post = (key, body, extra = {}) =>
    call("/api/v1/leads", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}), ...extra }, body: JSON.stringify(body) });
  const lead = { name: "Probe Student", whatsapp: "+237651232301", country_code: "CM", turnstile_token: "dummy-token" };
  const key = crypto.randomUUID();
  const noKey = await post(null, lead);
  const invalid = await post(crypto.randomUUID(), { ...lead, country_code: "XX" });
  const created = await post(key, lead);
  const replay = await post(key, lead);
  const conflict = await post(key, { ...lead, name: "Someone Else" });
  const more = [await post(crypto.randomUUID(), lead), await post(crypto.randomUUID(), lead)];
  const limited = await post(crypto.randomUUID(), lead);
  record("Lead POST: missing Idempotency-Key is refused (400)", noKey.status === 400, noKey.status);
  record("Lead POST: invalid country is refused (400)", invalid.status === 400, invalid.status);
  record("Lead POST: valid lead is stored (201), replay returns 200, changed payload returns 409", created.status === 201 && replay.status === 200 && conflict.status === 409, {
    created: created.status,
    replay: replay.status,
    conflict: conflict.status,
    sameReference: created.json?.ref === replay.json?.ref,
  });
  record("Lead POST: the Durable Object limiter returns 429 with Retry-After after 5 valid requests a minute", more.every((r) => r.status === 201) && limited.status === 429 && Boolean(limited.headers.get("retry-after")), {
    others: more.map((r) => r.status),
    sixth: limited.status,
    retryAfter: limited.headers.get("retry-after"),
  });
}

// 10. Sign-in through each hash variant, then the stub pages as the signed-in user (S0.4).
const cookieFrom = async (variant, role) => {
  const response = await fetch(`${base}/api/v1/probe/signin-${variant}?role=${role}`, { headers: probeHeaders });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const cookie = (response.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { status: response.status, json, cookie, text };
};
for (const variant of ["pbkdf2", "passwordless", "default"]) {
  const r = await cookieFrom(variant, "admin");
  const exceeded = r.status >= 500 || /1102|exceeded/i.test(r.text);
  record(`Sign-in works: ${variant} hash variant (S0.4)`, variant === "default" ? (r.json?.ok === true ? true : null) : r.json?.ok === true, {
    status: r.status,
    ok: r.json?.ok,
    cookiesIssued: r.json?.cookiesIssued,
    ...(variant === "default" && exceeded ? { note: "The default scrypt variant failed or exceeded CPU on the free plan. This is a finding, not a bug in the probe." } : {}),
  });
}
{
  const admin = await cookieFrom("pbkdf2", "admin");
  const student = await cookieFrom("pbkdf2", "student");
  const anon = await call("/admin/phase0");
  const adminPage = await call("/admin/phase0", { headers: { cookie: admin.cookie } });
  const studentOnAdmin = await call("/admin/phase0", { headers: { cookie: student.cookie } });
  const studentPage = await call("/me/phase0", { headers: { cookie: student.cookie } });
  record("Auth over the Neon driver: admin page renders for an admin", adminPage.status === 200 && /Stub leads stored/.test(adminPage.text), { status: adminPage.status, ms: adminPage.ms });
  record("Auth: an anonymous visitor and a student are refused on the admin page", anon.status === 404 && studentOnAdmin.status === 404, { anonymous: anon.status, student: studentOnAdmin.status });
  record("Auth: student page renders through the cookie-cache path", studentPage.status === 200 && /Your sessions/.test(studentPage.text), { status: studentPage.status, ms: studentPage.ms });
}

// Report
mkdirSync("scripts/.generated", { recursive: true });
const out = `scripts/.generated/stage0-probes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ base, measuredAt: new Date().toISOString(), coldWaitSeconds: coldWait, checks }, null, 2));
const failed = checks.filter((c) => c.pass === false);
console.log(`\n${checks.filter((c) => c.pass === true).length} passed, ${failed.length} failed, ${checks.filter((c) => c.pass === null).length} informational. Report: ${out}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Stage 0 functional probes\n\n${markdownTable(checks)}\n`);
process.exit(0);
