#!/usr/bin/env node
/**
 * Sets the password of the non-owner `app_runtime` role (created by migration 0002) and prints the connection string the Worker
 * uses, derived from the pooled owner connection string (ADR-038). The Worker never connects as the owner.
 *
 * Environment (all secrets, none printed):
 *   MIGRATION_DATABASE_URL   owner, direct connection: used to run ALTER ROLE
 *   POOLED_DATABASE_URL      owner, pooled connection: the host the runtime connection string is built from
 *   RUNTIME_DB_PASSWORD      the new password of app_runtime (at least 24 characters)
 *
 * In GitHub Actions the result goes to the step output `runtime_url`, after `::add-mask::`, so it is hidden in the log.
 */
import { appendFileSync } from "node:fs";
import pg from "pg";
import { buildRuntimeUrl } from "./lib.mjs";

const { MIGRATION_DATABASE_URL, POOLED_DATABASE_URL, RUNTIME_DB_PASSWORD } = process.env;
if (!MIGRATION_DATABASE_URL || !POOLED_DATABASE_URL || !RUNTIME_DB_PASSWORD) {
  console.error("MIGRATION_DATABASE_URL, POOLED_DATABASE_URL and RUNTIME_DB_PASSWORD are all required.");
  process.exit(1);
}
if (RUNTIME_DB_PASSWORD.length < 24) {
  console.error("RUNTIME_DB_PASSWORD must be at least 24 characters.");
  process.exit(1);
}

const runtimeUrl = buildRuntimeUrl(POOLED_DATABASE_URL, RUNTIME_DB_PASSWORD);

const client = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
await client.connect();
try {
  // ALTER ROLE cannot take a bind parameter, so the password is quoted as a literal (doubled quotes) after a strict check.
  if (!/^[A-Za-z0-9_\-+/=.]+$/.test(RUNTIME_DB_PASSWORD)) throw new Error("RUNTIME_DB_PASSWORD may contain only letters, digits and _-+/=.");
  await client.query(`alter role app_runtime with login password '${RUNTIME_DB_PASSWORD.replace(/'/g, "''")}'`);
  const { rows } = await client.query("select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'app_runtime'");
  const role = rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || !role.rolcanlogin) throw new Error("app_runtime has the wrong attributes: it must log in, and must not be a superuser or bypass row level security");
  console.log("app_runtime: password set, login allowed, no superuser, no BYPASSRLS.");
} finally {
  await client.end();
}

if (process.env.GITHUB_OUTPUT) {
  console.log(`::add-mask::${runtimeUrl}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `runtime_url=${runtimeUrl}\n`);
} else {
  console.log("Not in GitHub Actions: the runtime connection string is not printed.");
}
