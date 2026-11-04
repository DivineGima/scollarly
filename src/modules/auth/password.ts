/**
 * Email and password sign-up and sign-in (PRD_3 F21, architecture 22.3, ADR-052). The rules live here, once, so the form on the
 * phone and the server check the same thing. Pure, so they are table tests. Nothing here keeps a password beyond a single call.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

export type PasswordField = "name" | "email" | "password";
export type PasswordIssue = "required" | "invalid" | "too_short" | "too_long" | "weak";
export type PasswordIssues = Partial<Record<PasswordField, PasswordIssue>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function checkEmail(value: string): PasswordIssue | null {
  const email = normaliseEmail(value);
  if (email === "") return "required";
  if (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) return "invalid";
  return null;
}

/** A password the person can remember but a guesser cannot: long enough, not one repeated character, not just the part of the email before the @. */
export function checkPassword(value: string, email = ""): PasswordIssue | null {
  if (value === "") return "required";
  if (value.length < PASSWORD_MIN) return "too_short";
  if (value.length > PASSWORD_MAX) return "too_long";
  if (new Set(value).size < 3) return "weak";
  const local = normaliseEmail(email).split("@")[0] ?? "";
  if (local.length >= 4 && value.toLowerCase() === local) return "weak";
  return null;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export function validateSignUp(input: SignUpInput): PasswordIssues {
  const issues: PasswordIssues = {};
  const name = input.name.trim();
  if (name === "") issues.name = "required";
  else if (name.length > NAME_MAX) issues.name = "too_long";
  const email = checkEmail(input.email);
  if (email) issues.email = email;
  const password = checkPassword(input.password, input.email);
  if (password) issues.password = password;
  return issues;
}

/** Sign-in only needs both fields to be there. A wrong password is the server's answer and never says which part was wrong. */
export function validateSignIn(input: Pick<SignUpInput, "email" | "password">): PasswordIssues {
  const issues: PasswordIssues = {};
  const email = checkEmail(input.email);
  if (email) issues.email = email;
  if (input.password === "") issues.password = "required";
  else if (input.password.length > PASSWORD_MAX) issues.password = "too_long";
  return issues;
}

export const PASSWORD_SIGN_UP_PATH = "/api/auth/sign-up/email";
export const PASSWORD_SIGN_IN_PATH = "/api/auth/sign-in/email";
