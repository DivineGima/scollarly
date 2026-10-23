import { Pool, neon } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import { schema, type Schema } from "./schema";

/**
 * The database handle repositories depend on. It is the driver-neutral Drizzle base type, so the same
 * repository code runs on the Neon HTTP driver, the Neon WebSocket driver and node-postgres (CI tests).
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** ADR-019: single queries use HTTP. Stateless, so nothing is held between requests. */
export function createHttpDb(databaseUrl: string): Db {
  return drizzleHttp(neon(databaseUrl), { schema });
}

export interface WsDb {
  db: Db;
  /** Must be called (usually through ctx.waitUntil) when the request is done. */
  close: () => Promise<void>;
}

/** ADR-019: transactions use the WebSocket driver, one Pool per request, never shared across requests. */
export function createWsDb(databaseUrl: string): WsDb {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  return { db: drizzleWs(pool, { schema }), close: () => pool.end() };
}
