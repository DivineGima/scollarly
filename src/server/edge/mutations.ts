import { errorResponse, errorResponseFor, isSameOrigin, newRequestId, readCappedBytes, readJsonBody } from "@/lib/http";
import { logError } from "@/server/log";
import { type Actor, AuthError, hasAtLeast, isStepUpFresh, type Role } from "@/server/auth/actor";
import { readSessionToken } from "@/server/auth/cookie";
import type { LimitDecision } from "@/server/security/rate-limit";
import type { EndpointEnv } from "./endpoint-env";

/**
 * Signed-in mutations on the free plan (architecture 8.3, ADR-040, owner decision D18): `POST /api/v1/<area>/<operation>`,
 * a plain function in the Worker entry. Next.js never starts, because its server layer alone costs more CPU than the
 * free plan allows. Order of work, the same for every operation: same-origin check, body, session (the facade's one
 * query), access, then the handler, which validates with Zod and calls a repository.
 *
 * Access control stays in the facade and the `Actor` (and row level security under them). This file only asks the question
 * the operation declares; it is not middleware.
 */

export const MUTATION_PATH = /^\/api\/v1\/(admin|me|auth|invites)\/([A-Za-z][A-Za-z0-9.]{0,63})$/;
const MAX_BODY_BYTES = 8 * 1024;

export type Access =
  /** Anyone, signed in or not. Needs `limit`, because there is no user to blame. */
  | { kind: "public" }
  /** Any signed-in user. */
  | { kind: "signed-in" }
  /** The owner account whether or not it has passed 2FA yet: the 2FA enrol and verify operations themselves. */
  | { kind: "stored-owner" }
  /** At least this effective role (an owner without 2FA is a student), and optionally a 2FA check in the last 10 minutes. */
  | { kind: "role"; role: Role; stepUp?: boolean };

export interface MutationCall {
  /** Null only for `public` operations. */
  actor: Actor | null;
  /** The session token from the cookie, for the few functions that identify the user by it. */
  token: string | null;
  body: unknown;
  /** The request body as bytes, for an operation declared `binary` (an image upload). Null for every other operation. */
  bytes: Uint8Array | null;
  requestId: string;
  request: Request;
  env: EndpointEnv;
}

export interface Mutation {
  access: Access;
  /** Required for `public`. Counted per caller and operation. */
  limit?: { max: number; windowMs: number };
  /**
   * The body is a file, not JSON (the image upload). It is read only after the session and the access check, because it can be
   * a few hundred kilobytes and an unauthenticated caller must not make the Worker read it. The details go in the query string.
   */
  binary?: { maxBytes: number };
  handle: (call: MutationCall) => Promise<Response>;
}

export interface MutationDeps {
  checkSession: (headers: Headers) => Promise<Actor | null>;
  mutations: Readonly<Record<string, Mutation>>;
  env: EndpointEnv;
  /** Hashes the caller (never stores an IP) and counts one hit. */
  limit: (operation: string, request: Request, max: number, windowMs: number) => Promise<LimitDecision>;
}

export function classifyMutation(method: string, url: URL): { area: string; operation: string } | null {
  if (method !== "POST") return null;
  const match = MUTATION_PATH.exec(url.pathname);
  return match ? { area: match[1] as string, operation: match[2] as string } : null;
}

export interface AccessDenied {
  status: 401 | 403;
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "STEP_UP_REQUIRED";
  message: string;
}

/** Pure: whether `actor` may call an operation with this access. Null means allowed. */
export function denyAccess(access: Access, actor: Actor | null, now: Date): AccessDenied | null {
  if (access.kind === "public") return null;
  if (!actor) return { status: 401, code: "UNAUTHENTICATED", message: "Sign in required." };
  switch (access.kind) {
    case "signed-in":
      return null;
    case "stored-owner":
      return actor.storedRole === "owner" ? null : { status: 403, code: "FORBIDDEN", message: "Not allowed." };
    case "role":
      if (!hasAtLeast(actor, access.role)) return { status: 403, code: "FORBIDDEN", message: "Not allowed." };
      if (access.stepUp && !isStepUpFresh(actor, now)) {
        return { status: 403, code: "STEP_UP_REQUIRED", message: "Confirm your authenticator code to continue." };
      }
      return null;
  }
}

/** Returns a response, or null when the request is not one of ours (the Worker entry then continues as before). */
export async function handleMutation(request: Request, makeDeps: () => MutationDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const route = classifyMutation(request.method, url);
  if (!route) return null;
  const deps = makeDeps();
  const mutation = deps.mutations[`${route.area}/${route.operation}`];
  if (!mutation) return null;

  const requestId = newRequestId();
  if (!isSameOrigin(request)) return errorResponse(403, "FORBIDDEN", "Cross-origin requests are not allowed.", requestId);

  const body = mutation.binary ? ({ ok: true, value: {} } as const) : await readJsonBody(request, MAX_BODY_BYTES, { emptyIs: {} });
  if (!body.ok) {
    return body.reason === "too_large"
      ? errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large.", requestId)
      : errorResponse(400, "VALIDATION", "Request body must be valid JSON.", requestId);
  }

  try {
    if (mutation.access.kind === "public") {
      const limit = mutation.limit ?? { max: 10, windowMs: 60_000 };
      const decision = await deps.limit(`${route.area}/${route.operation}`, request, limit.max, limit.windowMs);
      if (!decision.allowed) {
        return errorResponseFor("RATE_LIMITED", "Too many requests. Try again shortly.", requestId, {
          headers: { "Retry-After": String(decision.retryAfterSeconds) },
        });
      }
    }

    const actor = mutation.access.kind === "public" ? null : await deps.checkSession(request.headers);
    const denied = denyAccess(mutation.access, actor, deps.env.now());
    if (denied) return errorResponse(denied.status, denied.code, denied.message, requestId);

    let bytes: Uint8Array | null = null;
    if (mutation.binary) {
      const read = await readCappedBytes(request, mutation.binary.maxBytes);
      if (!read.ok) return errorResponse(413, "PAYLOAD_TOO_LARGE", "Request is too large.", requestId);
      bytes = read.value;
    }
    return await mutation.handle({ actor, token: readSessionToken(request.headers), body: body.value, bytes, requestId, request, env: deps.env });
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : 403;
      return errorResponse(status, error.code, error.message, requestId);
    }
    // No stack trace, no message from the database: the client gets the request id and nothing else (architecture 13.4). The id is logged with the error class.
    logError(requestId, `${route.area}/${route.operation}`, error);
    return errorResponseFor("INTERNAL", "Something went wrong.", requestId);
  }
}
