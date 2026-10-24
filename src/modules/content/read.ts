import { unstable_cache } from "next/cache";
import { getDb } from "@/server/db/runtime";
import { getEnv } from "@/server/env";
import { readCatalogueRows, readPostRows, readSiteRows, readTrustRows } from "@/server/repositories/content";
import { buildBlog, buildCatalogue, buildSite, buildTrust } from "./builders";
import { loadFixture } from "./fixture";
import { CONTENT_REVALIDATE_SECONDS, CONTENT_TAGS } from "./tags";
import { EMPTY_BLOG, EMPTY_CATALOGUE, EMPTY_SITE, EMPTY_TRUST, type BlogSnapshot, type CatalogueSnapshot, type SiteSnapshot, type TrustSnapshot } from "./types";

/**
 * The content read layer (S3.1, architecture 6.1): public pages read content here, at build or revalidate time, and
 * Next.js keeps the result under a tag (`unstable_cache`). A page request that hits the cache never reaches Neon.
 *
 * Failure rules, which matter because the result is cached:
 *  - No database configured (a CI build): an empty snapshot, so the pages render their "nothing published yet" states
 *    and the build passes. The pages regenerate within CONTENT_REVALIDATE_SECONDS, and at once after a publish.
 *  - A database that is configured but fails at run time (asleep, down): the error is thrown. Next.js then keeps serving
 *    the previous copy of the page instead of replacing it with an empty one.
 */

function databaseHandle() {
  // Inside the Worker the binding is the source of truth. Outside it (a build on a CI runner) only DATABASE_URL exists.
  try {
    return getDb(getEnv());
  } catch {
    const url = process.env.DATABASE_URL;
    return url ? getDb({ DATABASE_URL: url }) : null;
  }
}

async function read<Snapshot, Rows>(
  fixtureKey: "catalogue" | "site" | "trust" | "blog",
  empty: Snapshot,
  fetchRows: (db: NonNullable<ReturnType<typeof databaseHandle>>) => Promise<Rows>,
  build: (rows: Rows) => Snapshot,
): Promise<Snapshot> {
  const fixture = await loadFixture<Snapshot>(fixtureKey);
  if (fixture) return fixture;
  const db = databaseHandle();
  if (!db) return empty;
  return build(await fetchRows(db));
}

const options = (tag: string) => ({ tags: [tag], revalidate: CONTENT_REVALIDATE_SECONDS });
// A build that reads a test fixture must not reuse what an earlier build cached from the database, so the fixture file is part of the key.
const source = process.env.CONTENT_FIXTURE_FILE ?? "db";

export const readCatalogue = unstable_cache(
  (): Promise<CatalogueSnapshot> => read("catalogue", EMPTY_CATALOGUE, readCatalogueRows, (rows) => buildCatalogue(rows)),
  ["content-catalogue-v1", source],
  options(CONTENT_TAGS.catalogue),
);

export const readSite = unstable_cache(
  (): Promise<SiteSnapshot> => read("site", EMPTY_SITE, readSiteRows, (rows) => buildSite(rows)),
  ["content-site-v1", source],
  options(CONTENT_TAGS.site),
);

export const readTrust = unstable_cache(
  (): Promise<TrustSnapshot> => read("trust", EMPTY_TRUST, readTrustRows, (rows) => buildTrust(rows)),
  ["content-trust-v1", source],
  options(CONTENT_TAGS.trust),
);

export const readBlog = unstable_cache(
  (): Promise<BlogSnapshot> => read("blog", EMPTY_BLOG, readPostRows, (rows) => buildBlog(rows)),
  ["content-blog-v1", source],
  options(CONTENT_TAGS.blog),
);
