import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { inContext, type RlsContext } from "@/server/db/rls";
import { rowsOf } from "@/server/db/rows";

/**
 * Create account (architecture 21.3, ADR-042): the caller confirms their own Scollarly account. The SECURITY DEFINER function
 * `app_confirm_account()` (migration 0013) changes only the caller's own row, named by the row-level-security context, and writes the
 * audit row. Returns true the first time and false when the account was already confirmed, so a second tap is harmless.
 */
export async function confirmAccount(db: Db, ctx: RlsContext): Promise<boolean> {
  const [result] = await inContext(db, ctx, db.execute(sql`select public.app_confirm_account() as confirmed`));
  return rowsOf<{ confirmed: boolean }>(result)[0]?.confirmed === true;
}
