/**
 * The owner's full export (S10.3; architecture 13.7, 16 C4 step 3): which tables go in, and why four do not. Image bytes are never in
 * the database (they are in Neon Object Storage, ADR-039), so the export carries the `media_asset` manifest (hash, size, kind) and nothing
 * else about images. A test compares these two lists with the tables that exist, so a new table has to be put in one of them on purpose.
 */

export const EXPORT_TABLES = [
  "app_user",
  "audit_log",
  "media_asset",
  "page_image",
  "pipeline_stage",
  "lead",
  "lead_programme_pref",
  "lead_activity",
  "lead_note",
  "lead_claim",
  "student_profile",
  "lead_duplicate_decision",
  "data_request",
  "university",
  "programme",
  "fee_structure",
  "campus_experience",
  "official_resource",
  "consent_record",
  "testimonial",
  "journey",
  "journey_step",
  "team_member",
  "faq",
  "trust_stat",
  "post",
  "process_step",
  "content_block",
  "message_template",
  "site_setting",
  "event",
  "event_daily_agg",
  "placement_payment",
] as const;

/** Left out on purpose: they hold secrets or short-lived credentials, which a file that gets emailed or stored must never carry. */
export const EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  owner_totp: "the encrypted authenticator secret of the owner",
  recovery_code: "hashes of the owner's recovery codes",
  step_up: "ids of live sessions",
  admin_invite: "hashes of invite links that may still work",
};

export const EXPORT_FORMAT = "scollarly-export-v1";

/** The name of the downloaded file, in WAT: `scollarly-export-2026-10-26.json`. */
export function exportFileName(watDate: string): string {
  return `scollarly-export-${watDate}.json`;
}

/**
 * Joins the per-table JSON texts into one document without parsing them. Each part is already valid JSON produced by Postgres; the Worker
 * only concatenates, which keeps the CPU cost of a large export small.
 */
export function assembleExport(exportedAtIso: string, parts: Readonly<Record<string, string>>): string {
  const tables = Object.entries(parts)
    .map(([name, json]) => `${JSON.stringify(name)}:${json}`)
    .join(",");
  return `{"format":${JSON.stringify(EXPORT_FORMAT)},"exportedAt":${JSON.stringify(exportedAtIso)},"imageBytesIncluded":false,"tables":{${tables}}}`;
}
