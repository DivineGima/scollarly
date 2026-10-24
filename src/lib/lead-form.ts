import { QUALIFICATION_TYPES, STUDENT_COUNTRIES } from "./constants";
import { normalisePhone } from "./phone";
import { generateRef } from "./ref";

/**
 * The checks and the request body of the two lead forms (architecture 16 A5, A5b), written without Zod so the form code the
 * browser loads stays small. The server never trusts this: `POST /api/v1/leads` validates with the shared schema
 * (`lib/schemas/lead.ts`), and a test feeds the same cases to both so the two cannot drift apart.
 *
 * Errors are message tokens, not sentences, exactly as the server sends them (`lib/schemas/common.ts`); the form maps each token to
 * its translated text. `CONSENT_REQUIRED` exists only here: the box must be ticked before a request is made.
 */

/** The version of the privacy notice the student agreed to. Updated when the legal text changes (tracker H5). */
export const CONSENT_NOTICE_VERSION = "draft-1";

export type FieldErrors = Record<string, string>;

export interface QuickValues {
  name: string;
  country: string;
  whatsapp: string;
  consent: boolean;
}

export interface FullValues extends QuickValues {
  qualification: string;
  results: { subject: string; grade: string }[];
  /** In rank order: the first is the first choice. */
  programmeIds: string[];
  email: string;
}

export interface LeadContext {
  /** The page the student is on, `source.page`. */
  page: string;
  universityId?: string | undefined;
  programmeId?: string | undefined;
  locale: string;
  /** The raw query string, for `utm_*` tags. */
  search?: string;
}

const isCountry = (value: string) => (STUDENT_COUNTRIES as readonly string[]).includes(value);
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

function commonErrors(values: QuickValues): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "REQUIRED";
  else if (name.length > 100) errors.name = "TOO_LONG";
  if (!values.country) errors.country_code = "REQUIRED";
  else if (!isCountry(values.country)) errors.country_code = "UNKNOWN_VALUE";
  if (!values.whatsapp.trim()) errors.whatsapp = "REQUIRED";
  else if (!isCountry(values.country) || !normalisePhone(values.whatsapp, values.country).ok) errors.whatsapp = "PHONE_INVALID";
  if (!values.consent) errors.consent = "CONSENT_REQUIRED";
  return errors;
}

/** The quick form (ADR-030): name, number, country and a university or programme from the page. */
export function validateQuick(values: QuickValues, context: Pick<LeadContext, "universityId" | "programmeId">): FieldErrors {
  const errors = commonErrors(values);
  if (!context.universityId && !context.programmeId) errors.university = "UNIVERSITY_OR_PROGRAMME_REQUIRED";
  return errors;
}

/** The full form: at least three different programmes and a qualification; results and email are optional. */
export function validateFull(values: FullValues): FieldErrors {
  const errors = commonErrors(values);
  if (!(QUALIFICATION_TYPES as readonly string[]).includes(values.qualification)) errors.qualification_type = "REQUIRED";
  if (new Set(values.programmeIds).size < 3) errors.programme_ids = "PROGRAMMES_MIN_3";
  if (values.email.trim() && !looksLikeEmail(values.email.trim())) errors.email = "INVALID";
  if (values.results.length > 30) errors.results = "TOO_LONG";
  for (const row of values.results) {
    if (row.subject.length > 60 || row.grade.length > 10) errors.results = "TOO_LONG";
  }
  return errors;
}

/** The `utm_*` tags of the landing address, kept for the lead's source (at most 8 short pairs). */
export function utmFromSearch(search: string | undefined): Record<string, string> | undefined {
  if (!search) return undefined;
  const utm: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (/^utm_[a-z]{1,20}$/.test(key) && value && Object.keys(utm).length < 8) utm[key] = value.slice(0, 200);
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

function sourceOf(context: LeadContext): Record<string, unknown> {
  const utm = utmFromSearch(context.search);
  return {
    page: context.page.slice(0, 200),
    ...(context.universityId ? { university_id: context.universityId } : {}),
    ...(context.programmeId ? { programme_id: context.programmeId } : {}),
    ...(utm ? { utm } : {}),
  };
}

function commonBody(values: QuickValues, context: LeadContext, now: Date, ref: string) {
  return {
    name: values.name.trim(),
    whatsapp: values.whatsapp.trim(),
    country_code: values.country,
    source: sourceOf(context),
    locale: context.locale,
    client_ref: ref,
    client_created_at: now.toISOString(),
    consent: { notice_version: CONSENT_NOTICE_VERSION },
  };
}

/** The body of a quick lead, without the Turnstile token and the idempotency key (the queue adds those). */
export function buildQuickPayload(values: QuickValues, context: LeadContext, now: Date = new Date(), ref: string = generateRef()) {
  return { intake_kind: "quick" as const, ...commonBody(values, context, now, ref), programme_ids: context.programmeId ? [context.programmeId] : [] };
}

export function buildFullPayload(values: FullValues, context: LeadContext, now: Date = new Date(), ref: string = generateRef()) {
  const email = values.email.trim();
  return {
    intake_kind: "full" as const,
    ...commonBody(values, context, now, ref),
    ...(email ? { email } : {}),
    qualification_type: values.qualification,
    results: values.results.map((r) => ({ subject: r.subject.trim(), grade: r.grade.trim() })).filter((r) => r.subject && r.grade),
    programme_ids: values.programmeIds,
  };
}

/** Fills `{name}`-style placeholders. Unknown placeholders become empty, so a translation typo never prints `{x}`. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}
