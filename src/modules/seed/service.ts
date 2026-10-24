import type { SeedRows } from "@/server/repositories/seed";
import { seedId } from "./ids";
import type { ImageRef, SeedBundle } from "./schema";

/**
 * Turns a validated seed bundle into database rows. Pure apart from hashing: no database, no storage, no files, so it is
 * tested without any of them. Images are imported first (the runner does that), and their `media_asset` ids are passed in
 * by file name.
 */

/** Every image file the bundle names, once each, with the kind the image will have in `media_asset`. */
export function imageFiles(bundle: SeedBundle): Map<string, { kind: "logo" | "photo"; alt?: string }> {
  const files = new Map<string, { kind: "logo" | "photo"; alt?: string }>();
  const add = (ref: ImageRef | undefined, kind: "logo" | "photo") => {
    if (!ref || files.has(ref.file)) return;
    files.set(ref.file, ref.alt ? { kind, alt: ref.alt } : { kind });
  };
  for (const u of bundle.universities) {
    add(u.logo, "logo");
    for (const c of u.campus_experiences) add(c.thumbnail, "photo");
  }
  return files;
}

const date = (value: string | undefined): Date | null => (value ? new Date(value) : null);
const publishedAt = (status: string, now: Date): Date | null => (status === "published" ? now : null);

export async function buildSeedRows(bundle: SeedBundle, mediaIds: ReadonlyMap<string, string>, now: Date = new Date()): Promise<SeedRows> {
  const rows: SeedRows = {
    universities: [],
    programmes: [],
    feeStructures: [],
    campusExperiences: [],
    officialResources: [],
    faqs: [],
    processSteps: [],
    contentBlocks: [],
  };
  const mediaId = (ref: ImageRef | undefined): string | null => {
    if (!ref) return null;
    const id = mediaIds.get(ref.file);
    if (!id) throw new Error(`No media asset was imported for ${ref.file}`);
    return id;
  };

  for (const [uIndex, u] of bundle.universities.entries()) {
    const universityId = await seedId("university", u.slug);
    rows.universities.push({
      id: universityId,
      slug: u.slug,
      name: u.name,
      city: u.city ?? null,
      state: u.state ?? null,
      type: u.type ?? null,
      naacGrade: u.naac_grade ?? null,
      websiteUrl: u.website_url ?? null,
      logoMediaId: mediaId(u.logo),
      translations: u.translations ?? {},
      sortOrder: u.sort_order ?? uIndex,
      status: u.status,
      publishedAt: publishedAt(u.status, now),
    });

    for (const [pIndex, p] of u.programmes.entries()) {
      rows.programmes.push({
        id: await seedId("programme", `${u.slug}/${p.name}`),
        universityId,
        name: p.name,
        level: p.level ?? null,
        field: p.field ?? null,
        durationMonths: p.duration_months ?? null,
        translations: p.translations ?? {},
        sortOrder: p.sort_order ?? pIndex,
        status: p.status,
        publishedAt: publishedAt(p.status, now),
      });
    }

    for (const [fIndex, f] of u.fees.entries()) {
      rows.feeStructures.push({
        id: await seedId("fee", `${u.slug}/${f.programme ?? "*"}/${f.currency}/${f.period}`),
        universityId,
        programmeId: f.programme === undefined ? null : await seedId("programme", `${u.slug}/${f.programme}`),
        currency: f.currency,
        amountMin: f.amount_min === undefined ? null : String(f.amount_min),
        amountMax: f.amount_max === undefined ? null : String(f.amount_max),
        period: f.period,
        dataConfirmed: f.data_confirmed,
        lastUpdatedAt: date(f.last_updated_at) ?? now,
        sourceUrl: f.source_url ?? null,
        translations: f.translations ?? {},
        sortOrder: f.sort_order ?? fIndex,
        status: f.status,
        publishedAt: publishedAt(f.status, now),
      });
    }

    for (const [cIndex, c] of u.campus_experiences.entries()) {
      rows.campusExperiences.push({
        id: await seedId("campus_experience", `${u.slug}/${c.kind}/${c.title}`),
        universityId,
        kind: c.kind,
        title: c.title,
        youtubeId: c.youtube_id ?? null,
        url: c.url ?? null,
        thumbnailMediaId: mediaId(c.thumbnail),
        urlLastCheckedAt: date(c.url_last_checked_at),
        translations: c.translations ?? {},
        sortOrder: c.sort_order ?? cIndex,
        status: c.status,
        publishedAt: publishedAt(c.status, now),
      });
    }

    for (const [rIndex, r] of u.resources.entries()) {
      rows.officialResources.push({
        id: await seedId("official_resource", `${u.slug}/${r.title}`),
        universityId,
        title: r.title,
        url: r.url,
        kind: r.kind ?? null,
        urlLastCheckedAt: date(r.url_last_checked_at),
        translations: r.translations ?? {},
        sortOrder: r.sort_order ?? rIndex,
        status: r.status,
        publishedAt: publishedAt(r.status, now),
      });
    }
  }

  for (const [index, f] of bundle.faqs.entries()) {
    rows.faqs.push({
      id: await seedId("faq", f.question),
      category: f.category ?? null,
      question: f.question,
      answer: f.answer,
      translations: f.translations ?? {},
      sortOrder: f.sort_order ?? index,
      status: f.status,
      publishedAt: publishedAt(f.status, now),
    });
  }

  for (const s of bundle.process_steps) {
    rows.processSteps.push({
      id: await seedId("process_step", `${s.kind}/${s.position}`),
      kind: s.kind,
      position: s.position,
      title: s.title,
      body: s.body,
      translations: s.translations ?? {},
      status: s.status,
      publishedAt: publishedAt(s.status, now),
    });
  }

  for (const b of bundle.content_blocks) {
    rows.contentBlocks.push({
      id: await seedId("content_block", b.key),
      key: b.key,
      translations: b.translations,
      status: b.status,
      publishedAt: publishedAt(b.status, now),
    });
  }

  return rows;
}
