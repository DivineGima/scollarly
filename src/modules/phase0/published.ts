import { unstable_cache } from "next/cache";
import { createHttpDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { readPhase0Title } from "@/server/repositories/phase0-probe";
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
      return (await readPhase0Title(createHttpDb(getEnv().DATABASE_URL))) ?? FALLBACK;
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
