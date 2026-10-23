import { jsonResponse } from "@/lib/http";

/**
 * Architecture 8.2: `200 {status, version}`. Never touches the database. Used by CI and (from Stage 11)
 * the hourly uptime workflow. The `?deep=1` admin check is added in S10.2.
 */
export function GET(): Response {
  return jsonResponse({ status: "ok", version: process.env.NEXT_PUBLIC_BUILD_ID ?? "phase0" });
}
