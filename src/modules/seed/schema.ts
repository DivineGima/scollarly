import * as z from "zod";
import { CAMPUS_EXPERIENCE_KINDS, CURRENCIES, PROCESS_STEP_KINDS, YOUTUBE_ID_PATTERN } from "@/lib/constants";
import { isE164 } from "@/lib/phone";
import { contentStatusSchema, isoDateTimeSchema, translationsSchema } from "@/lib/schemas/common";

/**
 * The shape of the seed files (S1.7). They hold the content that moves from the old site into the database: universities
 * with their programmes, fees, campus experiences and resources, FAQs, process steps and copy blocks.
 *
 * The files describe OUR tables, not the old site's: once the owner supplies the old data (tracker H2) it is converted
 * into these files once, by hand or by a throwaway script, and reviewed. Nothing here invents content.
 *
 * Safety rules built into the format:
 *  - `status` defaults to `draft`, so nothing becomes public by accident; a row is published only if its file says so.
 *  - a fee with `data_confirmed: true` must carry a real range (FR-2), the same rule as the database CHECK.
 *  - every row has a stable natural key, and a duplicate key inside the files is an error, so the seed is unambiguous.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();
const sortOrder = z.number().int().min(0).max(100000).optional();
const status = contentStatusSchema.default("draft");
const url = z.url().max(500);

/** An image file next to the seed files, imported through the MediaStore path (WebP, size caps, hash dedupe). */
export const imageRefSchema = z.strictObject({
  /** Path relative to the seed directory, for example `logos/jain.png`. */
  file: text(200),
  alt: optionalText(200),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

const programmeSchema = z.strictObject({
  name: text(200),
  level: optionalText(60),
  field: optionalText(120),
  duration_months: z.number().int().positive().max(120).optional(),
  status,
  sort_order: sortOrder,
  translations: translationsSchema.optional(),
});

const feeSchema = z
  .strictObject({
    /** The name of one of this university's programmes, or absent for a university-wide fee. */
    programme: optionalText(200),
    currency: z.enum(CURRENCIES),
    amount_min: z.number().nonnegative().max(1e9).optional(),
    amount_max: z.number().nonnegative().max(1e9).optional(),
    period: text(60),
    data_confirmed: z.boolean().default(false),
    last_updated_at: isoDateTimeSchema.optional(),
    source_url: url.optional(),
    status,
    sort_order: sortOrder,
    translations: translationsSchema.optional(),
  })
  .superRefine((fee, ctx) => {
    if (!fee.data_confirmed) return;
    const { amount_min: min, amount_max: max } = fee;
    if (min === undefined || max === undefined || min <= 0 || max < min) {
      ctx.addIssue({ code: "custom", path: ["data_confirmed"], message: "A confirmed fee needs amount_min above 0 and amount_max at least amount_min." });
    }
  });

const campusExperienceSchema = z.strictObject({
  kind: z.enum(CAMPUS_EXPERIENCE_KINDS),
  title: text(200),
  youtube_id: z.string().regex(YOUTUBE_ID_PATTERN, "A YouTube id is exactly 11 characters from a-z, A-Z, 0-9, _ and -.").optional(),
  url: url.optional(),
  thumbnail: imageRefSchema.optional(),
  url_last_checked_at: isoDateTimeSchema.optional(),
  status,
  sort_order: sortOrder,
  translations: translationsSchema.optional(),
});

const resourceSchema = z.strictObject({
  title: text(200),
  url,
  kind: optionalText(60),
  url_last_checked_at: isoDateTimeSchema.optional(),
  status,
  sort_order: sortOrder,
  translations: translationsSchema.optional(),
});

export const universitySeedSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "A slug is lower-case words joined by hyphens."),
  name: text(200),
  city: optionalText(100),
  state: optionalText(100),
  type: optionalText(60),
  naac_grade: optionalText(10),
  website_url: url.optional(),
  logo: imageRefSchema.optional(),
  status,
  sort_order: sortOrder,
  translations: translationsSchema.optional(),
  programmes: z.array(programmeSchema).default([]),
  fees: z.array(feeSchema).default([]),
  campus_experiences: z.array(campusExperienceSchema).default([]),
  resources: z.array(resourceSchema).default([]),
});

export const faqSeedSchema = z.strictObject({
  category: optionalText(60),
  question: text(500),
  answer: text(5000),
  status,
  sort_order: sortOrder,
  translations: translationsSchema.optional(),
});

export const processStepSeedSchema = z.strictObject({
  kind: z.enum(PROCESS_STEP_KINDS),
  position: z.number().int().min(1).max(50),
  title: text(200),
  body: text(5000),
  status,
  translations: translationsSchema.optional(),
});

export const contentBlockSeedSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/, "A key is lower-case words joined by . _ or -."),
  /** The whole text of the block, English required. */
  translations: translationsSchema,
  status,
});

/** A page-level decorative photo (home hero, about, campus tours, universities), by its own stable key. */
export const pageImageSeedSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]+(\.[a-z0-9]+)*$/, "A key is lower-case words joined by dots, for example home.hero."),
  file: text(200),
  /** Required: a page photo is meaningful content, so it never ships with an empty alt. */
  alt: text(200),
});

/**
 * The two owner-confirmed contact settings (tracker H3). They are applied only while the setting is still "not set" (JSON
 * null), so a later edit in the admin screens is never overwritten; every other setting keeps its migration default.
 */
export const siteSettingSeedSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("whatsapp_number_e164"), value: z.string().refine(isE164, "A WhatsApp number is + and 7 to 15 digits (E.164).") }),
  z.strictObject({ key: z.literal("contact_phone_display"), value: text(40) }),
]);

export const seedBundleSchema = z
  .strictObject({
    universities: z.array(universitySeedSchema).default([]),
    faqs: z.array(faqSeedSchema).default([]),
    process_steps: z.array(processStepSeedSchema).default([]),
    content_blocks: z.array(contentBlockSeedSchema).default([]),
    page_images: z.array(pageImageSeedSchema).default([]),
    site_settings: z.array(siteSettingSeedSchema).default([]),
  })
  .superRefine((bundle, ctx) => {
    const duplicates = (label: string, keys: string[]) => {
      const seen = new Set<string>();
      for (const key of keys) {
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: [label], message: `Duplicate ${label} key: ${key}` });
        seen.add(key);
      }
    };
    duplicates("universities", bundle.universities.map((u) => u.slug));
    duplicates("faqs", bundle.faqs.map((f) => f.question));
    duplicates("process_steps", bundle.process_steps.map((s) => `${s.kind}/${s.position}`));
    duplicates("content_blocks", bundle.content_blocks.map((b) => b.key));
    duplicates("page_images", bundle.page_images.map((p) => p.key));
    duplicates("site_settings", bundle.site_settings.map((s) => s.key));
    bundle.universities.forEach((u, i) => {
      const programmeNames = u.programmes.map((p) => p.name);
      const names = new Set(programmeNames);
      if (names.size !== programmeNames.length) ctx.addIssue({ code: "custom", path: ["universities", i, "programmes"], message: "Duplicate programme name" });
      for (const fee of u.fees) {
        if (fee.programme !== undefined && !names.has(fee.programme)) {
          ctx.addIssue({ code: "custom", path: ["universities", i, "fees"], message: `Fee names the programme "${fee.programme}", which ${u.slug} does not list.` });
        }
      }
      const tours = u.campus_experiences.map((c) => `${c.kind}/${c.title}`);
      if (new Set(tours).size !== tours.length) ctx.addIssue({ code: "custom", path: ["universities", i, "campus_experiences"], message: "Duplicate campus experience" });
      const resources = u.resources.map((r) => r.title);
      if (new Set(resources).size !== resources.length) ctx.addIssue({ code: "custom", path: ["universities", i, "resources"], message: "Duplicate resource title" });
      const fees = u.fees.map((f) => `${f.programme ?? "*"}/${f.currency}/${f.period}`);
      if (new Set(fees).size !== fees.length) ctx.addIssue({ code: "custom", path: ["universities", i, "fees"], message: "Duplicate fee (same programme, currency and period)" });
    });
  });

export type SeedBundle = z.infer<typeof seedBundleSchema>;
/** The file names the runner reads from the seed directory; each holds one array. */
export const SEED_FILES = {
  universities: "universities.json",
  faqs: "faqs.json",
  process_steps: "process-steps.json",
  content_blocks: "content-blocks.json",
  page_images: "page-images.json",
  site_settings: "site-settings.json",
} as const;
