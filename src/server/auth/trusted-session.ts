/**
 * The one rule for "may this session be trusted at all" (review of S14.1 to S14.4, finding 1 and 2). It is used by the auth facade and by the
 * lead endpoint, so the two can never drift apart again.
 *
 * Google tells us an email is verified. An email and password account (PRD_3 F21) is created with no verification, because we have no email
 * sender. That is acceptable for a student, who can only see and change their own records. It is never acceptable for staff: an admin or the
 * owner must have a verified email. The owner bootstrap, the invite acceptance and the email-based claims also check the verified flag inside
 * their own SQL, so an unverified student cannot reach any of them. This file imports nothing so the lead endpoint can use it without
 * loading anything else (`tests/unit/worker-startup.test.ts`).
 */
export function isTrustedSession(session: { emailVerified: boolean; role: string }): boolean {
  return session.emailVerified || session.role === "student";
}

/**
 * Whether a student must finish onboarding before applying (PRD_3 F15, ADR-053). The same question `needsOnboarding` asks of an `Actor`
 * (`actor.ts`), for the lead endpoint, which holds a session and loads nothing else. An unknown stored role counts as a student, as it
 * does everywhere else.
 */
export function sessionNeedsOnboarding(session: { role: string; onboardingDone?: boolean }): boolean {
  return session.role !== "admin" && session.role !== "owner" && session.onboardingDone === false;
}
