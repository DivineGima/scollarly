import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import type { Db } from "@/server/db/client";
import { schema } from "@/server/db/schema";

const MIGRATIONS = "./src/server/db/migrations";

export interface TestDb {
  db: Db;
  engine: "postgres" | "pglite";
  run: (statement: string) => Promise<unknown[]>;
  close: () => Promise<void>;
}

/**
 * A freshly migrated database for one test file.
 *  - TEST_DATABASE_URL set (CI service container, architecture 13.3): a real Postgres, schema reset first.
 *  - otherwise: PGlite, an in-process Postgres, so the suite runs anywhere with no Docker.
 * Either way the committed migrations are what builds the schema, so migrations are tested too.
 */
export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    const db = drizzleNodePg(pool, { schema });
    await db.execute(sql.raw("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;"));
    await migrateNodePg(db, { migrationsFolder: MIGRATIONS });
    return {
      db: db as unknown as Db,
      engine: "postgres",
      run: async (statement) => (await pool.query(statement)).rows,
      close: () => pool.end(),
    };
  }

  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return {
    db: db as unknown as Db,
    engine: "pglite",
    run: async (statement) => (await client.query(statement)).rows,
    close: () => client.close(),
  };
}
