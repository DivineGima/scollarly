import { authRouteHandlers } from "@/server/auth";

// Better Auth owns /api/auth/*. Handlers are built per request so the Worker env is read inside the request.
export async function GET(request: Request) {
  return authRouteHandlers().GET(request);
}

export async function POST(request: Request) {
  return authRouteHandlers().POST(request);
}
