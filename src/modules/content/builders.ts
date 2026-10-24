import type { CatalogueRows, PostRows, SiteRows, TrustRows } from "@/server/repositories/content";
import { isE164 } from "@/lib/phone";
import { isYoutubeId, safeHttpsUrl } from "./embed";
import { confirmedRange } from "./fees";
import { localisedField, localisedText } from "./localise";
import { plainExcerpt } from "./markdown";
import type {
  BlogSnapshot,
  CampusView,
  CatalogueSnapshot,
  FeeLine,
  MediaRef,
  SiteSnapshot,
  TrustSnapshot,
  UniversityView,
} from "./types";

/**
 * Turns database rows into what pages render, and applies the publish rules a second time (FR-2, FR-13, confirmed
 * figures and bios, FR-3). The database refuses to publish a row that breaks them; these builders also drop any row that
 * does, so a page can never show one. They are pure functions of rows, tested without a database.
 */

type MediaRow = { id: string; sha256: string; width: number; height: number; alt: Record<string, string> };

function mediaIndex(rows: readonly MediaRow[], locale: string): (id: string | null) => MediaRef | null {
  const byId = new Map(rows.map((m) => [m.id, m]));
  return (id) => {
    const m = id ? byId.get(id) : undefined;
    if (!m || !/^[a-f0-9]{64}$/.test(m.sha256)) return null;
    return { sha256: m.sha256, width: m.width, height: m.height, alt: m.alt[locale] ?? m.alt.en ?? "" };
  };
}

function group<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function buildCatalogue(rows: CatalogueRows, locale = "en"): CatalogueSnapshot {
  const media = mediaIndex(rows.media, locale);
  const programmes = group(rows.programmes, (p) => p.universityId);
  const fees = group(rows.fees, (f) => f.universityId);
  const experiences = group(rows.experiences, (e) => e.universityId);
  const resources = group(rows.resources, (r) => r.universityId);

  const universities = rows.universities.map((u): UniversityView => {
    const feeLines: FeeLine[] = [];
    for (const f of fees.get(u.id) ?? []) {
      const range = confirmedRange(f);
      if (range) feeLines.push({ id: f.id, ...range, period: f.period, lastUpdatedAt: new Date(f.lastUpdatedAt).toISOString(), programmeId: f.programmeId });
    }

    const campus: CampusView[] = [];
    for (const e of experiences.get(u.id) ?? []) {
      const kind = e.kind as CampusView["kind"];
      // A video needs a valid id (FR-3); a tour or gallery needs an https address. Anything else is not shown at all.
      const youtubeId = kind === "video" && isYoutubeId(e.youtubeId) ? e.youtubeId : null;
      const url = kind === "video" ? null : safeHttpsUrl(e.url);
      if (kind === "video" ? !youtubeId : !url) continue;
      campus.push({ id: e.id, kind, title: e.title, youtubeId, url, thumbnail: media(e.thumbnailMediaId) });
    }

    return {
      id: u.id,
      slug: u.slug,
      name: u.name,
      city: u.city,
      state: u.state,
      type: u.type,
      naacGrade: u.naacGrade,
      websiteUrl: safeHttpsUrl(u.websiteUrl),
      logo: media(u.logoMediaId),
      overview: localisedText(u.translations, locale),
      programmes: (programmes.get(u.id) ?? []).map((p) => ({ id: p.id, name: p.name, level: p.level, field: p.field, durationMonths: p.durationMonths })),
      fees: feeLines,
      experiences: campus,
      resources: (resources.get(u.id) ?? []).flatMap((r) => {
        const url = safeHttpsUrl(r.url);
        return url ? [{ id: r.id, title: r.title, url, kind: r.kind }] : [];
      }),
    };
  });

  return { universities };
}

export function buildSite(rows: SiteRows, locale = "en"): SiteSnapshot {
  const settings = new Map(rows.settings.map((s) => [s.key, s.value]));
  const whatsapp = settings.get("whatsapp_number_e164");
  const display = settings.get("contact_phone_display");
  return {
    faqs: rows.faqs.map((f) => ({
      id: f.id,
      category: f.category,
      question: localisedField(f.translations, locale, "question", f.question),
      answer: localisedField(f.translations, locale, "answer", f.answer),
    })),
    processSteps: rows.steps.flatMap((s) =>
      s.kind === "application" || s.kind === "visa"
        ? [{ id: s.id, kind: s.kind, position: s.position, title: localisedField(s.translations, locale, "title", s.title), body: localisedField(s.translations, locale, "body", s.body) }]
        : [],
    ),
    blocks: Object.fromEntries(rows.blocks.map((b) => [b.key, localisedText(b.translations, locale)]).filter(([, text]) => text)),
    contact: {
      whatsappE164: isE164(whatsapp) ? whatsapp : null,
      phoneDisplay: typeof display === "string" && display.trim() ? display.trim() : null,
    },
  };
}

export function buildTrust(rows: TrustRows, locale = "en"): TrustSnapshot {
  const media = mediaIndex(rows.media, locale);
  const universityName = new Map(rows.universities.map((u) => [u.id, u.name]));
  const steps = group(rows.steps, (s) => s.journeyId);

  return {
    // Unconfirmed figures are never published (CLAUDE.md): the row must be confirmed here as well as in the query.
    stats: rows.stats
      .filter((s) => s.confirmed)
      .map((s) => ({
        key: s.key,
        label: localisedField(s.translations, locale, "label", s.label),
        value: localisedField(s.translations, locale, "value", s.value),
        asOf: s.asOf,
      })),
    // FR-13: verified and with a consent record, or it is not shown.
    testimonials: rows.testimonials
      .filter((t) => t.verified && t.consentId)
      .map((t) => ({
        id: t.id,
        studentName: t.studentName,
        country: t.country,
        universityName: t.universityId ? (universityName.get(t.universityId) ?? null) : null,
        quote: localisedField(t.translations, locale, "quote", t.quote),
        photo: media(t.photoMediaId),
      })),
    journeys: rows.journeys
      .filter((j) => j.verified && j.consentId)
      .map((j) => ({
        id: j.id,
        studentName: j.studentName,
        country: j.country,
        universityName: j.universityId ? (universityName.get(j.universityId) ?? null) : null,
        summary: localisedField(j.translations, locale, "summary", j.summary),
        steps: (steps.get(j.id) ?? []).map((s) => ({ position: s.position, title: s.title, body: s.body, dateLabel: s.dateLabel })),
      })),
    // Unconfirmed bios are never published.
    team: rows.team
      .filter((m) => m.confirmed)
      .map((m) => ({ id: m.id, name: m.name, roleTitle: m.roleTitle, bio: m.bio, photo: media(m.photoMediaId) })),
  };
}

export function buildBlog(rows: PostRows, locale = "en"): BlogSnapshot {
  const media = mediaIndex(rows.media, locale);
  return {
    posts: rows.posts.flatMap((p) => {
      if (!p.publishedAt) return [];
      const body = localisedField(p.translations, locale, "body", p.body);
      return [
        {
          slug: p.slug,
          title: localisedField(p.translations, locale, "title", p.title),
          body,
          publishedAt: new Date(p.publishedAt).toISOString(),
          excerpt: plainExcerpt(body),
          cover: media(p.coverMediaId),
        },
      ];
    }),
  };
}

/**
 * The line a card quotes: "Fees from USD 3,000 tuition per year". It prefers the tuition lines, stays inside one
 * currency (currencies are never compared or summed), and takes the lowest start. Null when nothing is confirmed (FR-2).
 */
export function headlineFee(university: Pick<UniversityView, "fees">): FeeLine | null {
  const tuition = university.fees.filter((line) => /tuition/i.test(line.period));
  const pool = tuition.length > 0 ? tuition : university.fees;
  const first = pool[0];
  if (!first) return null;
  let best = first;
  for (const line of pool) if (line.currency === first.currency && line.min < best.min) best = line;
  return best;
}
