#!/usr/bin/env node
/**
 * Production smoke test (S11.7). The part of it a script can do without anyone's password: every public page answers, the health route is up,
 * the signed-in screens and data calls refuse a visitor (so nothing private is public), the security headers are on, and the two routes that must
 * be closed are closed. The part that needs a person (signing in as a student, an admin and the owner and opening each screen) is the checklist in
 * docs/pre-launch-checklist.md and is recorded by the owner, never by this script.
 *
 *   node scripts/smoke.mjs https://scollarly.gimafolabit.workers.dev
 *
 * Exit code 0 only when every check passed.
 */

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/smoke.mjs <https://address-of-the-site>");
  process.exit(2);
}

const PUBLIC = ["/", "/universities", "/fees", "/campus-tours", "/process", "/visa", "/faq", "/about", "/blog", "/contact", "/apply", "/privacy", "/terms", "/offline", "/sign-in"];
const CLOSED_SHELLS = ["/admin", "/admin/payments", "/admin/settings", "/admin/health", "/admin/analytics/performance", "/me"];
const CLOSED_DATA = ["/api/v1/admin/payments", "/api/v1/admin/settings", "/api/v1/admin/health", "/api/v1/admin/audit", "/api/v1/admin/performance-all", "/api/v1/me/progress"];

const results = [];
const check = async (name, work) => {
  try {
    const problem = await work();
    results.push({ name, ok: problem === undefined || problem === true, problem: typeof problem === "string" ? problem : "" });
  } catch (error) {
    results.push({ name, ok: false, problem: error instanceof Error ? error.message : String(error) });
  }
};
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });

await check("health answers 200 with status ok", async () => {
  const response = await get("/api/v1/health");
  const body = await response.json();
  if (response.status !== 200 || body.status !== "ok") return `HTTP ${response.status} ${JSON.stringify(body)}`;
});
await check("the deep health check refuses a visitor", async () => {
  const response = await get("/api/v1/health?deep=1");
  if (![401, 403].includes(response.status)) return `HTTP ${response.status}`;
});

for (const path of PUBLIC) {
  await check(`public page ${path} answers 200 with the security headers`, async () => {
    const response = await get(path);
    if (response.status !== 200) return `HTTP ${response.status}`;
    const csp = response.headers.get("content-security-policy") ?? "";
    if (!csp.includes("default-src 'self'") || !csp.includes("frame-ancestors 'none'")) return "the Content-Security-Policy is missing or not enforced";
    if (response.headers.get("x-content-type-options") !== "nosniff") return "X-Content-Type-Options is missing";
    if (!response.headers.get("strict-transport-security")) return "Strict-Transport-Security is missing";
  });
}
for (const path of CLOSED_SHELLS) {
  await check(`signed-in screen ${path} is 404 to a visitor`, async () => {
    const response = await get(path);
    if (response.status !== 404) return `HTTP ${response.status}`;
  });
}
for (const path of CLOSED_DATA) {
  await check(`data call ${path} is 401 to a visitor`, async () => {
    const response = await get(path);
    if (response.status !== 401) return `HTTP ${response.status}`;
  });
}
await check("a made-up session cookie is not a session", async () => {
  const response = await get("/api/v1/admin/payments", { headers: { cookie: "__Secure-neon-auth.session_token=forged.forged" } });
  if (![401, 403].includes(response.status)) return `HTTP ${response.status}`;
});
await check("a cross-origin POST to a mutation is refused", async () => {
  const response = await get("/api/v1/admin/payments.record", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  if (response.status !== 403) return `HTTP ${response.status}`;
});
await check("the old probe routes are gone", async () => {
  const response = await get("/api/v1/probe/auth");
  if (![404, 405].includes(response.status)) return `HTTP ${response.status}`;
});
await check("a page that does not exist is a 404", async () => {
  const response = await get("/no-such-page-" + Date.now());
  if (response.status !== 404) return `HTTP ${response.status}`;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.problem ? `  (${r.problem})` : ""}`);
}
console.log(`\n${results.length - failed} of ${results.length} checks passed against ${base}.`);
console.log("Not covered here: signing in as a student, an admin and the owner. Do that with docs/pre-launch-checklist.md.");
process.exit(failed === 0 ? 0 : 1);
