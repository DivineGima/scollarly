import { handleEventsPost } from "@/server/edge/events";
import { getEnv } from "@/server/env";

// The Worker entry answers this path before Next.js starts (worker/index.ts). This route calls the same function so local
// development and any request that reaches Next.js behave identically.
export async function POST(request: Request): Promise<Response> {
  return handleEventsPost(request, getEnv());
}
