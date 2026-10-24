import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { SecondFactorStore, TotpRecord } from "@/server/auth/second-factor";
import type { Db } from "@/server/db/client";
import { type RlsContext, inContext } from "@/server/db/rls";
import { ownerTotp, recoveryCode, stepUp } from "@/server/db/schema";

/**
 * The Drizzle side of the owner's second factor (ADR-037). Every method runs inside the row-level-security context of
 * the owner it acts for, so the policies (`user_id = app.user_id`) hold even if a caller passes the wrong user id.
 */
export function createSecondFactorStore(db: Db, ctx: RlsContext): SecondFactorStore {
  return {
    async getTotp(userId) {
      const [rows] = await inContext(
        db,
        ctx,
        db
          .select({
            userId: ownerTotp.userId,
            secretEncrypted: ownerTotp.secretEncrypted,
            confirmed: ownerTotp.confirmed,
            lastUsedStep: ownerTotp.lastUsedStep,
            failedCount: ownerTotp.failedCount,
            lockedUntil: ownerTotp.lockedUntil,
          })
          .from(ownerTotp)
          .where(eq(ownerTotp.userId, userId))
          .limit(1),
      );
      return (rows[0] as TotpRecord | undefined) ?? null;
    },

    async saveUnconfirmed(userId, secretEncrypted) {
      const [rows] = await inContext(
        db,
        ctx,
        db
          .insert(ownerTotp)
          .values({ userId, secretEncrypted, confirmed: false })
          .onConflictDoUpdate({
            target: ownerTotp.userId,
            set: { secretEncrypted, enrolledAt: new Date(), lastUsedStep: null, failedCount: 0, lockedUntil: null },
            // A confirmed secret is never replaced by a second enrolment.
            setWhere: eq(ownerTotp.confirmed, false),
          })
          .returning({ userId: ownerTotp.userId }),
      );
      return rows.length > 0;
    },

    async acceptStep(userId, step) {
      const [rows] = await inContext(
        db,
        ctx,
        db
          .update(ownerTotp)
          .set({ lastUsedStep: step, confirmed: true, failedCount: 0, lockedUntil: null })
          .where(and(eq(ownerTotp.userId, userId), or(isNull(ownerTotp.lastUsedStep), lt(ownerTotp.lastUsedStep, step))))
          .returning({ userId: ownerTotp.userId }),
      );
      return rows.length > 0;
    },

    async recordFailure(userId, max, lockUntil) {
      const [rows] = await inContext(
        db,
        ctx,
        db
          .update(ownerTotp)
          .set({
            failedCount: sql`${ownerTotp.failedCount} + 1`,
            lockedUntil: sql`case when ${ownerTotp.failedCount} + 1 >= ${max} then ${lockUntil.toISOString()}::timestamptz else ${ownerTotp.lockedUntil} end`,
          })
          .where(eq(ownerTotp.userId, userId))
          .returning({ failedCount: ownerTotp.failedCount, lockedUntil: ownerTotp.lockedUntil }),
      );
      const row = rows[0];
      return { failedCount: row?.failedCount ?? 0, lockedUntil: row?.lockedUntil ?? null };
    },

    async replaceRecoveryCodes(userId, hashes) {
      await inContext(
        db,
        ctx,
        // No physical deletes in v1 (CLAUDE.md): old codes are retired by marking them used.
        db.update(recoveryCode).set({ usedAt: new Date() }).where(and(eq(recoveryCode.userId, userId), isNull(recoveryCode.usedAt))),
        db.insert(recoveryCode).values(hashes.map((codeHash) => ({ id: crypto.randomUUID(), userId, codeHash }))),
      );
    },

    async consumeRecoveryCode(userId, hash) {
      const [rows] = await inContext(
        db,
        ctx,
        db
          .update(recoveryCode)
          .set({ usedAt: new Date() })
          .where(and(eq(recoveryCode.userId, userId), eq(recoveryCode.codeHash, hash), isNull(recoveryCode.usedAt)))
          .returning({ id: recoveryCode.id }),
      );
      return rows.length > 0;
    },

    async markStepUp(sessionId, userId, at) {
      await inContext(
        db,
        ctx,
        db
          .insert(stepUp)
          .values({ sessionId, userId, verifiedAt: at })
          .onConflictDoUpdate({ target: stepUp.sessionId, set: { verifiedAt: at } }),
      );
    },
  };
}
