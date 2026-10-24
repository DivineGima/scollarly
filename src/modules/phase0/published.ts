import { unstable_cache } from "next/cache";
import { ANONYMOUS, inContext } from "@/server/db/rls";
import { getDb } from "@/server/db/runtime";
import { getEnv } from "@/server/env";
import { readPhase0TitleQuery } from "@/server/repositories/phase0-probe";
import { PHASE0_CONTENT_TAG } from "./tags";

const FALLBACK = "Nothing published yet";

/**
 * S0.6: public content read at render/revalidate time and cached under a tag. The page never queries
 * the database on a normal request; publishing calls `revalidateTag`, and the next request rebuilds the page.
 * The fallback is returned from inside the cached function so the tag is attached even when the database
 * is unreachable (for example during the build).
 */
const readCachedTitle = unstable_cache(
  async (): Promise<string> => {
    try {
      const db = getDb(getEnv());
      const [rows] = await inContext(db, ANONYMOUS, readPhase0TitleQuery(db));
      return rows[0]?.value ?? FALLBACK;
    } catch {
      return FALLBACK;
    }
  },
  ["phase0-title"],
  { tags: [PHASE0_CONTENT_TAG] },
);

export function getPublishedTitle(): Promise<string> {
  return readCachedTitle();
}
