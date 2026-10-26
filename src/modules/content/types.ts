import type { Currency } from "./fees";

/**
 * The shapes public pages render (architecture 7.3, section 16 Part A). They are built from database rows by
 * `builders.ts`, which is where the publish rules (FR-2 fees, FR-13 testimonials, confirmed figures and bios) are applied
 * a second time, so a page can never show something the rules forbid even if a row slipped past the database CHECKs.
 * Everything here is plain data: the page components receive it as props and a client island receives only what it shows.
 */

/** An image the page may show: `<img src=/media/<sha256>.webp width height alt>` (architecture 6.5). */
export interface MediaRef {
  sha256: string;
  width: number;
  height: number;
  alt: string;
}

export interface ProgrammeView {
  id: string;
  name: string;
  level: string | null;
  field: string | null;
  durationMonths: number | null;
}

/** A fee line that passed the FR-2 rules: confirmed, with `0 < min <= max`. Unconfirmed fees never become a `FeeLine`. */
export interface FeeLine {
  id: string;
  currency: Currency;
  min: number;
  max: number;
  period: string;
  /** ISO instant, shown as "last updated". */
  lastUpdatedAt: string;
  programmeId: string | null;
}

export type CampusKind = "video" | "tour360" | "gallery";

export interface CampusView {
  id: string;
  kind: CampusKind;
  title: string;
  /** Present only for a video, and only when it is a valid 11 character id (FR-3). */
  youtubeId: string | null;
  /** An https address for a 360 tour or a gallery link; anything else is dropped. */
  url: string | null;
  thumbnail: MediaRef | null;
}

export interface ResourceView {
  id: string;
  title: string;
  url: string;
  kind: string | null;
}

export interface UniversityView {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  type: string | null;
  naacGrade: string | null;
  websiteUrl: string | null;
  logo: MediaRef | null;
  /** The overview paragraph(s); empty when none was written. */
  overview: string;
  programmes: ProgrammeView[];
  /** Confirmed fee lines only. Empty means "Fees to be confirmed" (FR-2). */
  fees: FeeLine[];
  experiences: CampusView[];
  resources: ResourceView[];
}

export interface FaqView {
  id: string;
  category: string | null;
  question: string;
  answer: string;
}

export interface ProcessStepView {
  id: string;
  kind: "application" | "visa";
  position: number;
  title: string;
  body: string;
}

export interface TrustStatView {
  key: string;
  label: string;
  value: string;
  /** WAT calendar date `YYYY-MM-DD`, or null. */
  asOf: string | null;
}

export interface TestimonialView {
  id: string;
  studentName: string;
  country: string | null;
  universityName: string | null;
  quote: string;
  photo: MediaRef | null;
}

export interface JourneyView {
  id: string;
  studentName: string;
  country: string | null;
  universityName: string | null;
  summary: string;
  steps: { position: number; title: string; body: string; dateLabel: string | null }[];
}

export interface TeamMemberView {
  id: string;
  name: string;
  roleTitle: string;
  bio: string | null;
  photo: MediaRef | null;
}

export interface PostSummary {
  slug: string;
  title: string;
  /** ISO instant. */
  publishedAt: string;
  excerpt: string;
  cover: MediaRef | null;
}

export interface PostView extends PostSummary {
  /** Markdown source; rendered by `markdown.ts`, which never produces HTML from it. */
  body: string;
}

/** The two contact settings. Null means the owner has not set it, and the pages say so instead of inventing a number (H3). */
export interface ContactView {
  whatsappE164: string | null;
  phoneDisplay: string | null;
}

export interface CatalogueSnapshot {
  universities: UniversityView[];
}

export interface SiteSnapshot {
  faqs: FaqView[];
  processSteps: ProcessStepView[];
  /** Copy blocks by key (`hero.title`, `about.mission`, ...). */
  blocks: Record<string, string>;
  contact: ContactView;
}

export interface TrustSnapshot {
  stats: TrustStatView[];
  testimonials: TestimonialView[];
  journeys: JourneyView[];
  team: TeamMemberView[];
}

export interface BlogSnapshot {
  posts: PostView[];
}

/** Page-level decorative photos, by key (`home.hero`, `about.photo`, ...). A missing key means no photo for that slot. */
export type PageImageSnapshot = Record<string, MediaRef>;

export const EMPTY_CATALOGUE: CatalogueSnapshot = { universities: [] };
export const EMPTY_SITE: SiteSnapshot = { faqs: [], processSteps: [], blocks: {}, contact: { whatsappE164: null, phoneDisplay: null } };
export const EMPTY_TRUST: TrustSnapshot = { stats: [], testimonials: [], journeys: [], team: [] };
export const EMPTY_BLOG: BlogSnapshot = { posts: [] };
export const EMPTY_PAGE_IMAGES: PageImageSnapshot = {};
