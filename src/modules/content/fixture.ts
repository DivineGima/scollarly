/**
 * A build-time test seam (S3.5). When the browser tests build the site they set `CONTENT_FIXTURE_FILE` to a JSON file that
 * holds finished snapshots, so every page is prerendered with content and the tests can check the real markup, the
 * fee rules and the facades without a database.
 *
 * It is read only when the variable is set and the process is not the running production server (`NEXT_PHASE`), which no deploy
 * does: the Worker has no such variable. A test proves that without the variable, and in the server phase, the loader returns null.
 */

type FixtureKey = "catalogue" | "site" | "trust" | "blog";

export function fixtureFileName(env: Record<string, string | undefined> = process.env): string | null {
  const file = env.CONTENT_FIXTURE_FILE;
  return file && env.NEXT_PHASE !== "phase-production-server" ? file : null;
}

export async function loadFixture<T>(key: FixtureKey, env: Record<string, string | undefined> = process.env): Promise<T | null> {
  const file = fixtureFileName(env);
  if (!file) return null;
  const { readFile } = await import(/* webpackIgnore: true */ "node:fs/promises");
  const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<Record<FixtureKey, T>>;
  return parsed[key] ?? null;
}
