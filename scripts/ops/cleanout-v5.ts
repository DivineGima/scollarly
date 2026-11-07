/**
 * Runs the one-time clean-out (tracker_5 flag F41). A DRY RUN unless `--confirm` is given: it shows what would go and rolls back.
 *
 *   CLEANOUT_DATABASE_URL=postgres://<owner role>@... npx tsx scripts/ops/cleanout-v5.ts --keep owner@example.com
 *   CLEANOUT_DATABASE_URL=...                         npx tsx scripts/ops/cleanout-v5.ts --keep owner@example.com --confirm
 *
 * Before `--confirm`: take a Neon snapshot, and rehearse the same command on a Neon branch of production.
 * The connection must be the database OWNER role (the one migrations use), because row level security would otherwise hide the rows.
 */
import pg from "pg";
import { cleanOut } from "../lib/cleanout-v5";

function valueOf(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const url = process.env.CLEANOUT_DATABASE_URL;
  const keep = valueOf("--keep");
  if (!url) throw new Error("CLEANOUT_DATABASE_URL is not set");
  if (!keep) throw new Error("--keep <email of the account to keep> is required");

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const report = await cleanOut(async (statement) => (await client.query(statement)).rows, {
      keepEmail: keep,
      confirm: process.argv.includes("--confirm"),
      includeUnlinkedLeads: process.argv.includes("--include-unlinked-leads"),
      includeAllPayments: process.argv.includes("--include-payments"),
    });
    console.log(JSON.stringify({ ...report, note: report.committed ? "COMMITTED" : "DRY RUN: nothing was changed" }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
