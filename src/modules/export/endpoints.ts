import { watDateString } from "@/lib/time";
import type { Actor } from "@/server/auth/actor";
import type { Mutation } from "@/server/edge/mutations";
import { exportEverything } from "@/server/repositories/export";
import { exportFileName } from "./tables";

/**
 * C4 step 3 "Download full export" (S10.3). The owner only, with a 2FA check inside the last 10 minutes, because the file holds every
 * lead's personal data. It is a POST, not a link, so the check, the audit row and the no-cache headers apply to it like any other change.
 * The file has no image bytes (they are in Neon Object Storage) and none of the secrets listed in `EXPORT_EXCLUDED`.
 */
export const exportMutations: Record<string, Mutation> = {
  "admin/export.download": {
    access: { kind: "role", role: "owner", stepUp: true },
    async handle({ actor, env }) {
      const now = env.now();
      const file = await exportEverything(env.db, actor as Actor, now);
      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${exportFileName(watDateString(now))}"`,
          "Cache-Control": "no-store",
        },
      });
    },
  },
};
