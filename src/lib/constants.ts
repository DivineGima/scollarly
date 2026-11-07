/**
 * Closed value lists shared by the database CHECK constraints (`src/server/db/schema.ts` builds each CHECK from these),
 * the Zod schemas and the services, so the three can never drift apart. A test compares every list with the database.
 * Values are stored exactly as written here.
 */

/** Version 5 (ADR-063): `manager` is what `admin` was, `admin` is what `owner` was; at most two admins. */
export const ROLES = ["student", "manager", "admin"] as const;

/** The seven student countries (PRD section 3), as ISO 3166-1 alpha-2 codes. */
export const STUDENT_COUNTRIES = ["CM", "NG", "GH", "CI", "SN", "GN", "ZA"] as const;
export type StudentCountry = (typeof STUDENT_COUNTRIES)[number];
/** The countries a student may type a WhatsApp number from when linking an application: the student countries plus India (ADR-025). */
export const NUMBER_COUNTRIES = [...STUDENT_COUNTRIES, "IN"] as const;

/** Version 5 (architecture 24.2, ADR-065): `pipeline_stage` holds the owner's seven steps, in this order. */
export const PIPELINE_STAGE_CODES = ["course_interest", "documents", "university_review", "offer_letter", "registration", "visa", "arrived"] as const;
export type PipelineStageCode = (typeof PIPELINE_STAGE_CODES)[number];
/** ADR-021: a new lead starts at the first stage. */
export const DEFAULT_STAGE_CODE: PipelineStageCode = "course_interest";

/** `open` until the student arrives or an admin closes the file (architecture 24.2). */
export const LEAD_STATUSES = ["open", "arrived", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Why an admin closed a file (version 5, FR-48). A code, never free text. */
export const LEAD_CLOSE_REASONS = ["no_response", "refused", "withdrew", "other"] as const;
export type LeadCloseReason = (typeof LEAD_CLOSE_REASONS)[number];

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** `onboarding` (architecture 21.2, ADR-043): the lead a finished student or parent questionnaire creates. */
export const INTAKE_KINDS = ["full", "quick", "onboarding"] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

/** Who is filling in the questionnaire (architecture 21.2). A parent is a student-role account, not a role (ADR-043). */
export const PROFILE_RELATIONSHIPS = ["student", "parent"] as const;
export type ProfileRelationship = (typeof PROFILE_RELATIONSHIPS)[number];

export const STUDY_LEVELS = ["undergraduate", "postgraduate"] as const;
export type StudyLevel = (typeof STUDY_LEVELS)[number];

/** A student chooses between one and this many course fields in the questionnaire (architecture 21.2). */
export const MAX_COURSE_FIELDS = 5;

export const QUALIFICATION_TYPES = ["olevel_alevel", "grade10_11"] as const;
export type QualificationType = (typeof QUALIFICATION_TYPES)[number];

export const LEAD_ACTIVITY_TYPES = [
  "created",
  "note",
  "stage_changed",
  "reply_logged",
  "assigned",
  "admin_wa_opened",
  "claimed",
  "merged",
  "duplicate_dismissed",
  "anonymised",
  "closed",
  "reopened",
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const CLAIM_METHODS = ["auto", "ref", "number"] as const;
export const CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
/** Architecture 9.6: how the admin checked the identity of a claimant. */
export const VERIFICATION_METHODS = ["email_match", "whatsapp_confirmed"] as const;

export const DUPLICATE_DECISIONS = ["merged", "not_duplicate"] as const;

/** Student documents (architecture 24.2, 24.5). The first five are supplied by the student, the letters by the admin, the proof by the student. */
export const DOCUMENT_KINDS = ["results", "id", "birth_certificate", "signature", "passport", "offer_letter", "acceptance_letter", "payment_proof"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** The four every file needs before step 3; the passport joins them when the university asks. */
export const REQUIRED_DOCUMENT_KINDS = ["results", "id", "birth_certificate", "signature"] as const;
export const STUDENT_DOCUMENT_KINDS = ["results", "id", "birth_certificate", "signature", "passport", "payment_proof"] as const;
export const LETTER_KINDS = ["offer_letter", "acceptance_letter"] as const;
export const DOCUMENT_STATES = ["pending", "uploaded", "approved", "rejected", "purged"] as const;
export const DOCUMENT_CONTENT_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const DATA_REQUEST_KINDS = ["export", "erasure"] as const;
export const DATA_REQUEST_CHANNELS = ["portal", "whatsapp", "other"] as const;
export const DATA_REQUEST_STATUSES = ["open", "done", "rejected"] as const;

export const CAMPUS_EXPERIENCE_KINDS = ["video", "tour360", "gallery"] as const;
export const CONSENT_SCOPES = ["testimonial", "journey", "photo"] as const;
export const PROCESS_STEP_KINDS = ["application", "visa"] as const;
export const CURRENCIES = ["USD", "INR"] as const;
export const MEDIA_KINDS = ["logo", "photo", "blog", "testimonial", "other"] as const;

export const EVENT_TYPES = ["page_view", "wa_tap", "form_start", "form_submit", "install"] as const;

/** FR-3: a YouTube video id is exactly 11 characters from this set. Used by the CHECK and by the Zod schema. */
export const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

/** The default `site_setting` rows (architecture 7.3). A null value means "not set yet" and is never invented. */
export const SETTING_KEYS = [
  "whatsapp_number_e164",
  "contact_phone_display",
  "sla_weekday_hours",
  "sla_weekend_hours",
  "timezone",
  "media_budget_bytes",
  "stale_fee_days",
  "stale_tour_days",
  "pipeline_freshness_days",
  "collect_page_views",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
