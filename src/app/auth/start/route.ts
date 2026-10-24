import { handleSignIn } from "@/server/edge/sign-in";
import { getEnv } from "@/server/env";

// The Worker entry answers this path itself (src/server/edge/sign-in.ts); this file is the same function for `next dev`.
export async function GET(request: Request): Promise<Response> {
  return (await handleSignIn(request, getEnv())) ?? new Response("Not found", { status: 404 });
}
