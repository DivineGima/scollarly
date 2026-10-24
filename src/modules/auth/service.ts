import type { Role } from "@/server/auth/actor";

/**
 * Where a person goes right after Google sign-in (architecture 16, A9 step 2 and C0 to C1). Pure, so the rule is a table test.
 *
 *  - student: `/me`
 *  - admin: `/admin`
 *  - owner who has passed 2FA in this session: `/admin`
 *  - owner who has not: the 2FA prompt, or the enrolment page if no authenticator is confirmed yet
 */
export function landingPathFor(input: { storedRole: Role; twoFactorVerified: boolean; twoFactorEnrolled: boolean }): string {
  switch (input.storedRole) {
    case "student":
      return "/me";
    case "admin":
      return "/admin";
    case "owner":
      if (input.twoFactorVerified) return "/admin";
      return input.twoFactorEnrolled ? "/two-factor/verify" : "/two-factor/enrol";
  }
}

/** Only these characters, 43 of them (32 random bytes in base64url), are ever accepted as an invite token. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
