#!/usr/bin/env node
/**
 * Creates (or removes) throwaway Neon Auth users and sessions so the deployed Worker can be measured on its real
 * authenticated path (S0.10): the cookie, the one session query, the role from our table, row level security.
 *
 *   node scripts/ci/seed-probe-sessions.mjs            create an admin and a student; write scripts/.generated/probe-sessions.json
 *   node scripts/ci/seed-probe-sessions.mjs --cleanup  delete every throwaway user and its rows
 *
 * The cleanup also removes the leads the probes and the CPU measurement created (`source.page = '/__probe'`, scripts/probe-lead.mjs): they
 * are test rows made by this workflow, not business data, so removing them does not touch the no-physical-delete rule for real leads.
 *
 * Environment: DATABASE_URL = the OWNER direct connection (it writes to Neon Auth's own tables, which the runtime role cannot).
 * Probe users use the reserved `.invalid` domain, sessions last two hours, and tokens are random and never printed.
 * This cannot exercise the Google sign-in round trip: that needs a person and is read from the Worker log by hand.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL (owner, direct) is required.");
  process.exit(1);
}
const EMAIL_PATTERN = "s010-probe-%@scollarly.invalid";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function cleanup() {
  await client.query("begin");
  try {
    const ids = (await client.query(`select id::text as id from neon_auth."user" where email like $1`, [EMAIL_PATTERN])).rows.map((r) => r.id);
    if (ids.length > 0) {
      for (const table of ["step_up", "recovery_code", "owner_totp"]) await client.query(`delete from public.${table} where user_id = any($1)`, [ids]);
      await client.query("delete from public.app_user where id = any($1)", [ids]);
      await client.query(`delete from neon_auth.session where "userId"::text = any($1)`, [ids]);
      await client.query(`delete from neon_auth."user" where id::text = any($1)`, [ids]);
    }
    // Probe leads, children first. Only rows whose source page is the probe marker.
    const probeLeads = "select id from public.lead where source ->> 'page' = '/__probe'";
    await client.query(`delete from public.event where lead_id in (${probeLeads})`);
    await client.query(`delete from public.lead_activity where lead_id in (${probeLeads})`);
    await client.query(`delete from public.lead_programme_pref where lead_id in (${probeLeads})`);
    const removedLeads = await client.query("delete from public.lead where source ->> 'page' = '/__probe'");
    await client.query("commit");
    console.log(`Removed ${ids.length} throwaway user(s) and their sessions, and ${removedLeads.rowCount} probe lead(s).`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

try {
  if (process.argv.includes("--cleanup")) {
    await cleanup();
  } else {
    await cleanup(); // never leave an earlier run's users behind
    const sessions = {};
    for (const [who, role] of [["admin", "admin"], ["student", "student"]]) {
      const email = `s010-probe-${who}-${randomBytes(4).toString("hex")}@scollarly.invalid`;
      const token = randomBytes(24).toString("hex").slice(0, 32);
      const user = await client.query(`insert into neon_auth."user" (name, email, "emailVerified") values ($1, $2, true) returning id::text as id`, [`S010 probe ${who}`, email]);
      const userId = user.rows[0].id;
      await client.query(`insert into neon_auth.session ("expiresAt", token, "userId", "updatedAt") values (now() + interval '2 hours', $1, $2::uuid, now())`, [token, userId]);
      await client.query("insert into public.app_user (id, role) values ($1, $2) on conflict (id) do update set role = excluded.role", [userId, role]);
      sessions[who] = { token, userId };
    }
    mkdirSync("scripts/.generated", { recursive: true });
    writeFileSync("scripts/.generated/probe-sessions.json", JSON.stringify(sessions));
    console.log("Created a throwaway admin and student with two-hour sessions. Tokens are in scripts/.generated/probe-sessions.json (not printed).");
  }
} finally {
  await client.end();
}
