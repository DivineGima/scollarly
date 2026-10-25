import { Pool, neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import type { Schema } from "./schema";

/**
 * The database handle repositories depend on. It is the driver-neutral Drizzle base type, so the same
 * repository code runs on the Neon HTTP driver, the Neon WebSocket driver and node-postgres (CI tests).
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/**
 * The handles are built WITHOUT the schema object. Handing Drizzle the schema makes it build the relational query
 * configuration of every table the first time a handle is made, and it makes this module load the whole schema file, on every
 * fresh Worker instance, even for a request (a lead, an event) that needs one table. No code uses Drizzle's relational query
 * API (the only thing that needs the schema object); repositories use the query builder and `sql`, which need only the table
 * objects they import themselves. The type still carries the schema, so nothing changes for callers (Stage 4 CPU repair,
 * tracker Session 21).
 */

/** ADR-019: single queries use HTTP. Stateless, so nothing is held between requests. */
export function createHttpDb(databaseUrl: string): Db {
  return drizzleHttp(neon(databaseUrl)) as unknown as Db;
}

export interface WsDb {
  db: Db;
  /** Must be called (usually through ctx.waitUntil) when the request is done. */
  close: () => Promise<void>;
}

/** ADR-019: transactions use the WebSocket driver, one Pool per request, never shared across requests. */
export function createWsDb(databaseUrl: string): WsDb {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  return { db: drizzleWs(pool) as unknown as Db, close: () => pool.end() };
}
