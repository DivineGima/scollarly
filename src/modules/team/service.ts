import { sha256Hex } from "@/lib/hash";
import { INVITE_TOKEN_PATTERN } from "@/modules/auth/service";

/** Architecture 9.4: an invite expires after 7 days [Mine, confirm]. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 random bytes as base64url (43 characters). Only the hash is stored; the token is shown once, inside the link. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The stored form of a token. Null for anything that is not a well-formed token, so a malformed link never reaches the database. */
export async function hashInviteToken(token: string): Promise<string | null> {
  return INVITE_TOKEN_PATTERN.test(token) ? sha256Hex(token) : null;
}

export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

export function inviteLink(origin: string, token: string): string {
  return `${origin}/accept-invite/${token}`;
}

export type OpenInviteState = "open" | "expired";

export function inviteState(invite: { expiresAt: Date }, now: Date): OpenInviteState {
  return invite.expiresAt.getTime() > now.getTime() ? "open" : "expired";
}

/** Postgres error 23505 (unique violation), whichever way the driver wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const causeCode = ((error as { cause?: { code?: unknown } } | null)?.cause ?? null)?.code;
  return code === "23505" || causeCode === "23505";
}
