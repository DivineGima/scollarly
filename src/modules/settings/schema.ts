import * as z from "zod";
import { isE164 } from "@/lib/phone";
import type { SettingKey } from "@/lib/constants";
import { requiredText, V } from "@/lib/schemas/common";

/**
 * The Settings screen's values and the one operation that changes them (S10.1; architecture 7.3, 16 C4). Each setting has one rule, used
 * by the server to refuse a bad value and by the screen for its hints. `timezone` is shown but not editable: all times are stored in UTC
 * and shown in WAT (CLAUDE.md), so it is not a choice.
 *
 * Limits are sensible bounds, not business rules: they stop a typo (a weekday target of 400 hours, a budget of 1 byte) from silently
 * switching a feature off. A value outside them is a 400 that names the field.
 */

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** The image budget may not go below 100 MiB, and not above the 5 GiB that Neon Object Storage gives free (ADR-039). */
export const MEDIA_BUDGET_MIN_BYTES = 100 * MIB;
export const MEDIA_BUDGET_MAX_BYTES = 5 * GIB;

const whole = (min: number, max: number) =>
  z
    .number({ error: V.INVALID })
    .int(V.INVALID)
    .min(min, V.INVALID)
    .max(max, V.INVALID);

export const EDITABLE_SETTING_KEYS = [
  "whatsapp_number_e164",
  "contact_phone_display",
  "sla_weekday_hours",
  "sla_weekend_hours",
  "stale_fee_days",
  "stale_tour_days",
  "pipeline_freshness_days",
  "media_budget_bytes",
  "collect_page_views",
] as const satisfies readonly SettingKey[];
export type EditableSettingKey = (typeof EDITABLE_SETTING_KEYS)[number];

/** A WhatsApp number is stored as + and 7 to 15 digits. Spaces, dashes and brackets typed by a person are removed first. */
const whatsappNumber = z
  .string({ error: V.REQUIRED })
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .refine(isE164, V.PHONE_INVALID);

export const settingFields = {
  whatsapp_number_e164: whatsappNumber,
  contact_phone_display: requiredText(40),
  sla_weekday_hours: whole(1, 72),
  sla_weekend_hours: whole(1, 168),
  stale_fee_days: whole(30, 730),
  stale_tour_days: whole(30, 730),
  /** "Not set yet" is allowed: the owner sets it after four weeks of data (tracker H10). */
  pipeline_freshness_days: whole(1, 365).nullable(),
  media_budget_bytes: whole(MEDIA_BUDGET_MIN_BYTES, MEDIA_BUDGET_MAX_BYTES),
  collect_page_views: z.boolean({ error: V.INVALID }),
} as const;

export const updateSettingsBody = z
  .strictObject({
    changes: z
      .strictObject({
        whatsapp_number_e164: settingFields.whatsapp_number_e164.optional(),
        contact_phone_display: settingFields.contact_phone_display.optional(),
        sla_weekday_hours: settingFields.sla_weekday_hours.optional(),
        sla_weekend_hours: settingFields.sla_weekend_hours.optional(),
        stale_fee_days: settingFields.stale_fee_days.optional(),
        stale_tour_days: settingFields.stale_tour_days.optional(),
        pipeline_freshness_days: settingFields.pipeline_freshness_days.optional(),
        media_budget_bytes: settingFields.media_budget_bytes.optional(),
        collect_page_views: settingFields.collect_page_views.optional(),
      })
      .refine((changes) => Object.values(changes).some((value) => value !== undefined), { error: V.REQUIRED }),
  })
  .strict();
export type SettingsChanges = z.infer<typeof updateSettingsBody>["changes"];

/** The settings that appear on the public site: a change tells the site to refresh (architecture 10.4). */
export const PUBLIC_SETTING_KEYS: readonly EditableSettingKey[] = ["whatsapp_number_e164", "contact_phone_display"];
