/**
 * Closed value lists shared by the database CHECK constraints (`src/server/db/schema.ts` builds each CHECK from these),
 * the Zod schemas and the services, so the three can never drift apart. A test compares every list with the database.
 * Values are stored exactly as written here.
 */

export const ROLES = ["student", "admin", "owner"] as const;

/** The seven student countries (PRD section 3), as ISO 3166-1 alpha-2 codes. */
export const STUDENT_COUNTRIES = ["CM", "NG", "GH", "CI", "SN", "GN", "ZA"] as const;
export type StudentCountry = (typeof STUDENT_COUNTRIES)[number];
/** The countries a student may type a WhatsApp number from when linking an application: the student countries plus India (ADR-025). */
export const NUMBER_COUNTRIES = [...STUDENT_COUNTRIES, "IN"] as const;

/** Architecture 7.2: `pipeline_stage` is seeded with these six, in this order. */
export const PIPELINE_STAGE_CODES = ["share_results", "choose_course", "offer_letter", "confirm_admission", "visa", "arrived"] as const;
export type PipelineStageCode = (typeof PIPELINE_STAGE_CODES)[number];
/** ADR-021: a new lead starts at the first stage. */
export const DEFAULT_STAGE_CODE: PipelineStageCode = "share_results";

export const CONTENT_STATUSES = ["draft", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const INTAKE_KINDS = ["full", "quick"] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

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
] as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const CLAIM_METHODS = ["auto", "ref", "number"] as const;
export const CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
/** Architecture 9.6: how the admin checked the identity of a claimant. */
export const VERIFICATION_METHODS = ["email_match", "whatsapp_confirmed"] as const;

export const DUPLICATE_DECISIONS = ["merged", "not_duplicate"] as const;

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
