import { defineConfig } from "drizzle-kit";

// Migrations run from CI or a developer machine with a direct (non-pooled) connection, never from the Worker (architecture 13.3).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
