import { type Db, createHttpDb } from "./client";

/**
 * The per-isolate database handle for Worker code (ADR-019). The Neon HTTP driver is stateless, so reusing the handle
 * between requests is safe and saves rebuilding it. `env.DATABASE_URL` is the connection string of the non-owner
 * `app_runtime` role (ADR-038), never the owner role.
 */
const handles = new Map<string, Db>();

export function getDb(env: Pick<CloudflareEnv, "DATABASE_URL">): Db {
  let db = handles.get(env.DATABASE_URL);
  if (!db) {
    db = createHttpDb(env.DATABASE_URL);
    handles.set(env.DATABASE_URL, db);
  }
  return db;
}
