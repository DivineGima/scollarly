import { isCourseField, type CourseField } from "@/lib/courses";
import { PROFILE_RELATIONSHIPS, type ProfileRelationship } from "@/lib/constants";

/**
 * Sign in versus Create account (architecture 21.3, ADR-042). The intent rides along the whole Google trip in the query string
 * (`/auth/start` to `/auth/return` to `/auth/landing`), the way the invite token already does. It is not a secret and not a
 * permission: the server decides from the account's own state, and the worst a tampered link can do is make a person confirm
 * (or skip the confirm screen for) an account for themselves, which they could do anyway.
 *
 * Pure, so the rules are table tests.
 */

export type SignInIntent = "sign-in" | "sign-up";

export interface AuthIntent {
  intent: SignInIntent;
  /** Who is signing up. Only meaningful for `sign-up`. */
  as: ProfileRelationship | null;
  /** A course picked on the landing page, carried into the study-plan step (F13, F15). */
  course: CourseField | null;
}

export const DEFAULT_INTENT: AuthIntent = { intent: "sign-in", as: null, course: null };

/** Anything that is not exactly a known value is dropped, never passed on. */
export function readIntent(url: URL): AuthIntent {
  const intent = url.searchParams.get("intent") === "sign-up" ? "sign-up" : "sign-in";
  const as = url.searchParams.get("as");
  const course = url.searchParams.get("course");
  return {
    intent,
    as: (PROFILE_RELATIONSHIPS as readonly string[]).includes(as ?? "") ? (as as ProfileRelationship) : null,
    course: isCourseField(course) ? course : null,
  };
}

/** The query string that carries an intent on. Empty for the plain sign-in default, so existing links do not change. */
export function intentParams(value: AuthIntent): URLSearchParams {
  const params = new URLSearchParams();
  if (value.intent === "sign-up") params.set("intent", "sign-up");
  if (value.intent === "sign-up" && value.as) params.set("as", value.as);
  if (value.intent === "sign-up" && value.course) params.set("course", value.course);
  return params;
}

/**
 * Whether the onboarding screens exist yet. S13.2 ships the sign-in and confirm steps before S13.3 builds onboarding, so until
 * S13.3 flips this, a new account goes to the student home (`/me`) instead of a page that does not exist.
 */
export const ONBOARDING_READY = false;

export function onboardingPath(as: ProfileRelationship, course: CourseField | null, ready: boolean = ONBOARDING_READY): string {
  if (!ready) return "/me";
  const params = new URLSearchParams({ as });
  if (course) params.set("course", course);
  return `/me/onboarding?${params.toString()}`;
}

export const CONFIRM_PATH = "/account/confirm";

export interface UnconfirmedLanding {
  /** Confirm the account now (the person chose Create account), or show the confirm screen first (they used Sign in). */
  confirmNow: boolean;
  path: string;
  as: ProfileRelationship;
}

/** Where a Google login with no confirmed Scollarly account goes next. A confirmed account never reaches this: it goes to its role's home. */
export function unconfirmedLanding(value: AuthIntent, ready: boolean = ONBOARDING_READY): UnconfirmedLanding {
  const as = value.as ?? "student";
  if (value.intent === "sign-up") return { confirmNow: true, path: onboardingPath(as, value.course, ready), as };
  return { confirmNow: false, path: CONFIRM_PATH, as };
}
