import { randomBytes, randomUUID } from "node:crypto";
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

/**
 * The slice of Neon Auth's own schema our SQL reads (`app_resolve_session`, `app_bootstrap_owner`). In production Neon
 * creates and owns these tables; tests create just enough of them so the committed migrations and functions run for real.
 * Column names and types were read from the live `neon_auth` schema on 2026-10-24.
 */
const NEON_AUTH_STUB = `
  drop schema if exists neon_auth cascade;
  create schema neon_auth;
  create table neon_auth."user" (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    email text not null unique,
    "emailVerified" boolean not null default false,
    image text,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    role text,
    banned boolean,
    "banReason" text,
    "banExpires" timestamptz
  );
  create table neon_auth.session (
    id uuid primary key default gen_random_uuid(),
    "expiresAt" timestamptz not null,
    token text not null unique,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    "ipAddress" text,
    "userAgent" text,
    "userId" uuid not null references neon_auth."user"(id) on delete cascade
  );
`;

export interface SignedInUser {
  userId: string;
  sessionId: string;
  token: string;
  email: string;
}

export interface TestDb {
  db: Db;
  engine: "postgres" | "pglite";
  run: (statement: string) => Promise<unknown[]>;
  /** Connects as the Worker does: the non-owner `app_runtime` role, no BYPASSRLS (ADR-038). Row level security applies. */
  asRuntime: () => Promise<void>;
  /** Back to the owner role, for set-up and assertions that must see everything. */
  asOwner: () => Promise<void>;
  /** Creates a Neon Auth user and session as Neon would, and returns the session token. */
  signIn: (options?: { email?: string; verified?: boolean; banned?: boolean; expiresInMs?: number }) => Promise<SignedInUser>;
  close: () => Promise<void>;
}

/**
 * A freshly migrated database for one test file.
 *  - TEST_DATABASE_URL set (CI service container, architecture 13.3): a real Postgres, schema reset first.
 *  - otherwise: PGlite, an in-process Postgres, so the suite runs anywhere with no Docker.
 * Either way the committed migrations are what builds the schema, so migrations are tested too. Both use ONE connection,
 * so `set role` and the transaction helpers in `src/server/db/rls.ts` behave the same on both.
 */
export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  let db: Db;
  let run: TestDb["run"];
  let close: () => Promise<void>;
  let engine: TestDb["engine"];

  if (url) {
    // One pg Client, not a Pool: a Pool destroys its connection after any failed query (release(err)), which would silently drop
    // the session's `set role` and run the next statement as the owner. A Client keeps one session for the whole test file.
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const pgDb = drizzleNodePg(client, { schema });
    await pgDb.execute(sql.raw("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;"));
    await client.query(NEON_AUTH_STUB);
    await migrateNodePg(pgDb, { migrationsFolder: MIGRATIONS });
    db = pgDb as unknown as Db;
    run = async (statement) => (await client.query(statement)).rows;
    close = () => client.end();
    engine = "postgres";
  } else {
    const client = new PGlite();
    const pgliteDb = drizzlePglite(client, { schema });
    await client.exec(NEON_AUTH_STUB);
    await migratePglite(pgliteDb, { migrationsFolder: MIGRATIONS });
    db = pgliteDb as unknown as Db;
    run = async (statement) => (await client.query(statement)).rows;
    close = () => client.close();
    engine = "pglite";
  }

  const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return {
    db,
    engine,
    run,
    asRuntime: async () => void (await run("set role app_runtime")),
    asOwner: async () => void (await run("reset role")),
    signIn: async (options = {}) => {
      const email = options.email ?? `user-${randomUUID()}@example.test`;
      const token = randomBytes(24).toString("hex").slice(0, 32);
      const [user] = (await run(
        `insert into neon_auth."user" (name, email, "emailVerified", banned) values ('Test', ${literal(email)}, ${options.verified ?? true}, ${options.banned ?? false}) returning id`,
      )) as { id: string }[];
      const expires = new Date(Date.now() + (options.expiresInMs ?? 3600_000)).toISOString();
      const [session] = (await run(
        `insert into neon_auth.session ("expiresAt", token, "userId") values (${literal(expires)}, ${literal(token)}, '${user?.id}') returning id`,
      )) as { id: string }[];
      return { userId: user?.id ?? "", sessionId: session?.id ?? "", token, email };
    },
    close,
  };
}
