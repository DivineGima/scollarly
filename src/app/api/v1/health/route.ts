import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db/runtime";
import { handleHealth } from "@/server/edge/health";
import { getEnv } from "@/server/env";
import { pingDatabase } from "@/server/repositories/health";

// Architecture 8.2: `200 {status, version}`, no database. Used by CI and the hourly uptime workflow (S11.8). `?deep=1` is the admin's
// database check (S10.2); the logic and its tests are in `server/edge/health.ts`.
export function GET(request: Request): Promise<Response> {
  return handleHealth(request, {
    version: process.env.NEXT_PUBLIC_BUILD_ID ?? "phase0",
    requireAdmin: (headers) => requireRole(headers, "admin"),
    pingDatabase: () => pingDatabase(getDb(getEnv())),
  });
}
