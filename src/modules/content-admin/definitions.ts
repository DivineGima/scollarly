import type { CONSENT_SCOPES} from "@/lib/constants";
import { CAMPUS_EXPERIENCE_KINDS, CURRENCIES, PIPELINE_STAGE_CODES, PROCESS_STEP_KINDS, STUDENT_COUNTRIES, YOUTUBE_ID_PATTERN } from "@/lib/constants";
import type { ContentArea } from "@/modules/content/tags";

/**
 * The content types an admin manages (architecture 7.3, 16 B6; S6.1, S6.2). ONE definition per type drives everything that must
 * agree: the server's Zod schema, the admin form, the list, the publish gates and the public areas to refresh. Nothing here
 * imports the database or the Worker, so the browser can import it (the form is built from the same fields the server checks).
 */

export type FieldKind =
  | "text"
  | "textarea"
  | "markdown"
  | "slug"
  | "url"
  | "number"
  | "money"
  | "boolean"
  | "select"
  | "date"
  | "youtube"
  | "media"
  | "ref";

export type RefTarget = "university" | "programme" | "consent" | "stage";
export type MediaKind = "logo" | "photo" | "blog" | "testimonial" | "other";

export interface FieldDef {
  /** The name in the API and the form (camelCase). The database column is `column`, or this name in snake_case. */
  key: string;
  kind: FieldKind;
  /** Not null in the database: required even for a draft. Every other field may be blank until the item is published. */
  required?: boolean;
  max?: number;
  min?: number;
  options?: readonly string[];
  ref?: RefTarget;
  mediaKind?: MediaKind;
  /** The text lives in `translations.en` (the whole-text shape, for example a university's overview), not in a column. */
  store?: "translations.en";
  /** Set once when the item is created and fixed afterwards (a slug or a key is part of an address). */
  immutable?: boolean;
  /** The consent scope a `consent` reference accepts. */
  consentScope?: (typeof CONSENT_SCOPES)[number];
}

/** What blocks a publish. The server checks every gate; the form reads the same list to explain what is missing. */
export type Gate =
  | { kind: "required"; field: string }
  | { kind: "verifiedAndConsent" }
  | { kind: "confirmed"; field: string }
  | { kind: "feeRange" }
  | { kind: "campusLink" };

export type ContentTypeKey =
  | "universities"
  | "programmes"
  | "fees"
  | "campus"
  | "resources"
  | "testimonials"
  | "journeys"
  | "team"
  | "faqs"
  | "stats"
  | "steps"
  | "copy"
  | "blog"
  | "templates";

export interface TypeDef {
  type: ContentTypeKey;
  /** The SQL table. */
  table: string;
  fields: readonly FieldDef[];
  gates: readonly Gate[];
  /** The areas of the public site that read this type (`CONTENT_TAGS`). */
  areas: readonly ContentArea[];
  /** The public pages to drop from the edge cache after a change, besides the pages of the item itself. */
  pages: readonly string[];
  /** The SQL `order by` of the list, with `t` as the table's alias. */
  order: string;
  /** Where the item appears on the public site, for "View on site" (relative path), when it has a page of its own. */
  publicPath?: { prefix: "/universities" | "/blog"; slugField: "slug" };
  /** A type that has several rows in a fixed list (page copy: one per key). */
  keyed?: boolean;
  /** This type can be flagged stale and marked checked (S6.5). */
  stale?: "fee" | "link";
  /** The type has its own consent reference. */
  consent?: (typeof CONSENT_SCOPES)[number];
  /** Journey steps are edited with the journey. */
  steps?: boolean;
}

const PUBLIC_CATALOGUE = ["/", "/universities", "/fees", "/campus-tours", "/apply"] as const;
const PUBLIC_TRUST = ["/", "/about"] as const;

const text = (key: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, kind: "text", max: 200, ...extra });

/** Sorting number shown to staff as "Order": a lower number is earlier on the public page. */
const sort: FieldDef = { key: "sortOrder", kind: "number", min: 0, max: 100000 };

export const TYPE_DEFS: Readonly<Record<ContentTypeKey, TypeDef>> = {
  universities: {
    type: "universities",
    table: "university",
    fields: [
      text("name", { required: true }),
      { key: "slug", kind: "slug", required: true, max: 80, immutable: true },
      text("city", { max: 80 }),
      text("state", { max: 80 }),
      text("type", { max: 80 }),
      text("naacGrade", { max: 20 }),
      { key: "websiteUrl", kind: "url", max: 500 },
      { key: "logoMediaId", kind: "media", mediaKind: "logo" },
      { key: "overview", kind: "textarea", max: 5000, store: "translations.en" },
      sort,
    ],
    gates: [
      { kind: "required", field: "name" },
      { kind: "required", field: "slug" },
    ],
    areas: ["catalogue", "trust"],
    pages: PUBLIC_CATALOGUE,
    order: "t.sort_order, t.name",
    publicPath: { prefix: "/universities", slugField: "slug" },
  },
  programmes: {
    type: "programmes",
    table: "programme",
    fields: [
      { key: "universityId", kind: "ref", ref: "university", required: true },
      text("name", { required: true }),
      text("level", { max: 80 }),
      text("field", { max: 80 }),
      { key: "durationMonths", kind: "number", min: 1, max: 240 },
      sort,
    ],
    gates: [
      { kind: "required", field: "name" },
      { kind: "required", field: "universityId" },
    ],
    areas: ["catalogue"],
    pages: PUBLIC_CATALOGUE,
    order: "t.sort_order, t.name",
  },
  fees: {
    type: "fees",
    table: "fee_structure",
    fields: [
      { key: "universityId", kind: "ref", ref: "university", required: true },
      { key: "programmeId", kind: "ref", ref: "programme" },
      { key: "currency", kind: "select", options: CURRENCIES, required: true },
      { key: "amountMin", kind: "money", min: 0 },
      { key: "amountMax", kind: "money", min: 0 },
      text("period", { required: true, max: 60 }),
      { key: "dataConfirmed", kind: "boolean" },
      { key: "sourceUrl", kind: "url", max: 500 },
      sort,
    ],
    gates: [{ kind: "required", field: "universityId" }, { kind: "feeRange" }],
    areas: ["catalogue"],
    pages: PUBLIC_CATALOGUE,
    order: "t.sort_order, t.period",
    stale: "fee",
  },
  campus: {
    type: "campus",
    table: "campus_experience",
    fields: [
      { key: "universityId", kind: "ref", ref: "university", required: true },
      { key: "kind", kind: "select", options: CAMPUS_EXPERIENCE_KINDS, required: true },
      text("title", { required: true }),
      { key: "youtubeId", kind: "youtube" },
      { key: "url", kind: "url", max: 500 },
      { key: "thumbnailMediaId", kind: "media", mediaKind: "photo" },
      sort,
    ],
    gates: [{ kind: "required", field: "title" }, { kind: "campusLink" }],
    areas: ["catalogue"],
    pages: ["/campus-tours", "/universities"],
    order: "t.sort_order, t.title",
    stale: "link",
  },
  resources: {
    type: "resources",
    table: "official_resource",
    fields: [
      { key: "universityId", kind: "ref", ref: "university" },
      text("title", { required: true }),
      { key: "url", kind: "url", required: true, max: 500 },
      text("kind", { max: 60 }),
      sort,
    ],
    gates: [{ kind: "required", field: "title" }, { kind: "required", field: "url" }],
    areas: ["catalogue"],
    pages: ["/universities"],
    order: "t.sort_order, t.title",
    stale: "link",
  },
  testimonials: {
    type: "testimonials",
    table: "testimonial",
    fields: [
      text("studentName", { required: true }),
      { key: "country", kind: "select", options: STUDENT_COUNTRIES },
      { key: "universityId", kind: "ref", ref: "university" },
      { key: "quote", kind: "textarea", required: true, max: 2000 },
      { key: "photoMediaId", kind: "media", mediaKind: "testimonial" },
      { key: "verified", kind: "boolean" },
      { key: "consentId", kind: "ref", ref: "consent", consentScope: "testimonial" },
      sort,
    ],
    gates: [{ kind: "required", field: "quote" }, { kind: "verifiedAndConsent" }],
    areas: ["trust"],
    pages: PUBLIC_TRUST,
    order: "t.sort_order, t.student_name",
    consent: "testimonial",
  },
  journeys: {
    type: "journeys",
    table: "journey",
    fields: [
      text("studentName", { required: true }),
      { key: "country", kind: "select", options: STUDENT_COUNTRIES },
      { key: "universityId", kind: "ref", ref: "university" },
      { key: "summary", kind: "textarea", required: true, max: 2000 },
      { key: "verified", kind: "boolean" },
      { key: "consentId", kind: "ref", ref: "consent", consentScope: "journey" },
      sort,
    ],
    gates: [{ kind: "required", field: "summary" }, { kind: "verifiedAndConsent" }],
    areas: ["trust"],
    pages: PUBLIC_TRUST,
    order: "t.sort_order, t.student_name",
    consent: "journey",
    steps: true,
  },
  team: {
    type: "team",
    table: "team_member",
    fields: [
      text("name", { required: true }),
      text("roleTitle", { required: true, max: 120 }),
      { key: "bio", kind: "textarea", max: 2000 },
      { key: "photoMediaId", kind: "media", mediaKind: "photo" },
      { key: "confirmed", kind: "boolean" },
      sort,
    ],
    gates: [{ kind: "confirmed", field: "confirmed" }],
    areas: ["trust"],
    pages: PUBLIC_TRUST,
    order: "t.sort_order, t.name",
  },
  faqs: {
    type: "faqs",
    table: "faq",
    fields: [text("category", { max: 80 }), { key: "question", kind: "text", required: true, max: 300 }, { key: "answer", kind: "textarea", required: true, max: 5000 }, sort],
    gates: [{ kind: "required", field: "question" }, { kind: "required", field: "answer" }],
    areas: ["site"],
    pages: ["/faq", "/"],
    order: "t.sort_order, t.id",
  },
  stats: {
    type: "stats",
    table: "trust_stat",
    fields: [
      { key: "key", kind: "text", required: true, max: 60, immutable: true },
      text("label", { required: true, max: 120 }),
      text("value", { required: true, max: 60 }),
      { key: "confirmed", kind: "boolean" },
      { key: "asOf", kind: "date" },
      sort,
    ],
    gates: [{ kind: "confirmed", field: "confirmed" }],
    areas: ["trust"],
    pages: PUBLIC_TRUST,
    order: "t.sort_order, t.key",
  },
  steps: {
    type: "steps",
    table: "process_step",
    fields: [
      { key: "kind", kind: "select", options: PROCESS_STEP_KINDS, required: true },
      { key: "position", kind: "number", required: true, min: 1, max: 100 },
      text("title", { required: true }),
      { key: "body", kind: "textarea", required: true, max: 3000 },
    ],
    gates: [{ kind: "required", field: "title" }, { kind: "required", field: "body" }],
    areas: ["site"],
    pages: ["/process", "/visa"],
    order: "t.kind, t.position",
  },
  copy: {
    type: "copy",
    table: "content_block",
    fields: [{ key: "key", kind: "text", required: true, max: 80, immutable: true }, { key: "text", kind: "textarea", required: true, max: 10000, store: "translations.en" }],
    gates: [{ kind: "required", field: "key" }, { kind: "required", field: "text" }],
    areas: ["site"],
    pages: ["/", "/about", "/process", "/visa", "/fees", "/faq", "/contact", "/privacy", "/terms"],
    order: "t.key",
    keyed: true,
  },
  blog: {
    type: "blog",
    table: "post",
    fields: [
      text("title", { required: true }),
      { key: "slug", kind: "slug", required: true, max: 80, immutable: true },
      { key: "body", kind: "markdown", required: true, max: 100000 },
      { key: "coverMediaId", kind: "media", mediaKind: "blog" },
    ],
    gates: [{ kind: "required", field: "title" }, { kind: "required", field: "body" }],
    areas: ["blog"],
    pages: ["/blog", "/"],
    order: "t.published_at desc nulls first, t.title",
    publicPath: { prefix: "/blog", slugField: "slug" },
  },
  templates: {
    type: "templates",
    table: "message_template",
    fields: [
      { key: "stageCode", kind: "ref", ref: "stage", required: true },
      { key: "locale", kind: "select", options: ["en"], required: true },
      { key: "body", kind: "textarea", required: true, max: 1000 },
    ],
    gates: [{ kind: "required", field: "body" }],
    // Staff only: nothing on the public site reads these.
    areas: [],
    pages: [],
    order: "t.stage_code, t.locale",
  },
};

export const CONTENT_TYPE_KEYS = Object.keys(TYPE_DEFS) as ContentTypeKey[];

export function isContentType(value: string): value is ContentTypeKey {
  return Object.hasOwn(TYPE_DEFS, value);
}

/** The known page-copy keys, from the seed (`data/seed/content-blocks.json`). A new key can still be typed in. */
export const KNOWN_COPY_KEYS = [
  "site.tagline",
  "hero.title",
  "hero.subtitle",
  "about.summary",
  "about.mission",
  "about.motto",
  "why.summary",
  "services.free_notice",
  "visa.note",
  "fees.disclaimer",
  "contact.email",
  "contact.office",
  "privacy.body",
  "terms.body",
] as const;

export const COPY_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** The columns of a field in the database. */
export function columnOf(field: FieldDef): string {
  return field.key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export const STAGE_OPTIONS = PIPELINE_STAGE_CODES;

export function isYoutubeId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_ID_PATTERN.test(value);
}

/** One step of a journey (the only child list). Positions are 1, 2, 3 in the order given. */
export interface JourneyStepInput {
  title: string;
  body: string;
  dateLabel: string | null;
}
