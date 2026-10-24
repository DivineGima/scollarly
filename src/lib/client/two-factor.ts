import type { ApiFail } from "./api";

export type CodeErrorKey = "errorInvalid" | "errorUsed" | "errorLocked" | "errorGeneric";

/**
 * Which message a failed code check gets. A wrong code and a lockout are different things for the person: the first can
 * be retried now, the second cannot for 15 minutes. Anything unexpected (a lost connection, a server fault) is generic.
 */
export function codeErrorKey(result: Pick<ApiFail, "code" | "fields">): CodeErrorKey {
  if (result.code === "RATE_LIMITED") return "errorLocked";
  if (result.fields.code === "INVALID_CODE") return "errorInvalid";
  if (result.fields.code === "CODE_ALREADY_USED") return "errorUsed";
  return "errorGeneric";
}

export interface TwoFactorStatus {
  enrolled: boolean;
  pending: boolean;
  verified: boolean;
  stepUpFresh: boolean;
}

/** Where the owner belongs, given their 2FA state: the page that does not match the state sends them on. */
export function twoFactorDestination(status: TwoFactorStatus, here: "enrol" | "verify"): string | null {
  if (status.enrolled && status.verified) return "/admin";
  if (here === "enrol" && status.enrolled) return "/two-factor/verify";
  if (here === "verify" && !status.enrolled) return "/two-factor/enrol";
  return null;
}
