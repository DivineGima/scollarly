import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/server/db/client";
import {
  campusExperience,
  contentBlock,
  faq,
  feeStructure,
  journey,
  journeyStep,
  mediaAsset,
  officialResource,
  post,
  processStep,
  programme,
  siteSetting,
  teamMember,
  testimonial,
  trustStat,
  university,
} from "@/server/db/schema";
import { runPublic } from "./as-actor";

/**
 * What public pages read (architecture 6.1, 10.4). Every query asks for published rows only, and the row level security
 * policies say the same thing, so a draft cannot be returned even if a `where` is forgotten. Each function is one round
 * trip to Neon (the queries run together in one HTTP request, ADR-038) and is called at build or revalidate time, never
 * on a page request that hits the cache.
 */

const published = (status: AnyPgColumn) => eq(status, "published");

/** Universities with their programmes, fees, campus experiences and resources, plus the image metadata they point at. */
export async function readCatalogueRows(db: Db) {
  const [universities, programmes, fees, experiences, resources, media] = await runPublic(
    db,
    db
      .select({
        id: university.id,
        slug: university.slug,
        name: university.name,
        city: university.city,
        state: university.state,
        type: university.type,
        naacGrade: university.naacGrade,
        websiteUrl: university.websiteUrl,
        logoMediaId: university.logoMediaId,
        translations: university.translations,
      })
      .from(university)
      .where(published(university.status))
      .orderBy(asc(university.sortOrder), asc(university.name)),
    db
      .select({
        id: programme.id,
        universityId: programme.universityId,
        name: programme.name,
        level: programme.level,
        field: programme.field,
        durationMonths: programme.durationMonths,
      })
      .from(programme)
      .where(published(programme.status))
      .orderBy(asc(programme.sortOrder), asc(programme.name)),
    // Only confirmed fees leave the database. The page checks the range again (modules/content/fees.ts).
    db
      .select({
        id: feeStructure.id,
        universityId: feeStructure.universityId,
        programmeId: feeStructure.programmeId,
        currency: feeStructure.currency,
        amountMin: feeStructure.amountMin,
        amountMax: feeStructure.amountMax,
        period: feeStructure.period,
        dataConfirmed: feeStructure.dataConfirmed,
        lastUpdatedAt: feeStructure.lastUpdatedAt,
      })
      .from(feeStructure)
      .where(and(published(feeStructure.status), eq(feeStructure.dataConfirmed, true)))
      .orderBy(asc(feeStructure.sortOrder), asc(feeStructure.period)),
    db
      .select({
        id: campusExperience.id,
        universityId: campusExperience.universityId,
        kind: campusExperience.kind,
        title: campusExperience.title,
        youtubeId: campusExperience.youtubeId,
        url: campusExperience.url,
        thumbnailMediaId: campusExperience.thumbnailMediaId,
      })
      .from(campusExperience)
      .where(published(campusExperience.status))
      .orderBy(asc(campusExperience.sortOrder), asc(campusExperience.title)),
    db
      .select({ id: officialResource.id, universityId: officialResource.universityId, title: officialResource.title, url: officialResource.url, kind: officialResource.kind })
      .from(officialResource)
      .where(published(officialResource.status))
      .orderBy(asc(officialResource.sortOrder), asc(officialResource.title)),
    readMediaQuery(db),
  );
  return { universities, programmes, fees, experiences, resources, media };
}

/** Image metadata for every live asset. A few hundred rows at most (the image budget caps the count). */
function readMediaQuery(db: Db) {
  return db
    .select({ id: mediaAsset.id, sha256: mediaAsset.sha256, width: mediaAsset.width, height: mediaAsset.height, alt: mediaAsset.alt })
    .from(mediaAsset)
    .where(isNull(mediaAsset.archivedAt));
}

/** FAQs, process steps, copy blocks and the two contact settings. */
export async function readSiteRows(db: Db) {
  const [faqs, steps, blocks, settings] = await runPublic(
    db,
    db
      .select({ id: faq.id, category: faq.category, question: faq.question, answer: faq.answer, translations: faq.translations })
      .from(faq)
      .where(published(faq.status))
      .orderBy(asc(faq.sortOrder), asc(faq.id)),
    db
      .select({ id: processStep.id, kind: processStep.kind, position: processStep.position, title: processStep.title, body: processStep.body, translations: processStep.translations })
      .from(processStep)
      .where(published(processStep.status))
      .orderBy(asc(processStep.kind), asc(processStep.position)),
    db.select({ key: contentBlock.key, translations: contentBlock.translations }).from(contentBlock).where(published(contentBlock.status)),
    db
      .select({ key: siteSetting.key, value: siteSetting.value })
      .from(siteSetting)
      .where(sql`${siteSetting.key} in ('whatsapp_number_e164', 'contact_phone_display')`),
  );
  return { faqs, steps, blocks, settings };
}

/** Trust content. The publish rules are in the database CHECKs and again in `builders.ts`; the filters here are the third lock. */
export async function readTrustRows(db: Db) {
  const [stats, testimonials, journeys, steps, team, universities, media] = await runPublic(
    db,
    db
      .select({ key: trustStat.key, label: trustStat.label, value: trustStat.value, asOf: trustStat.asOf, confirmed: trustStat.confirmed, translations: trustStat.translations })
      .from(trustStat)
      .where(and(published(trustStat.status), eq(trustStat.confirmed, true)))
      .orderBy(asc(trustStat.sortOrder), asc(trustStat.key)),
    db
      .select({
        id: testimonial.id,
        studentName: testimonial.studentName,
        country: testimonial.country,
        universityId: testimonial.universityId,
        quote: testimonial.quote,
        photoMediaId: testimonial.photoMediaId,
        verified: testimonial.verified,
        consentId: testimonial.consentId,
        translations: testimonial.translations,
      })
      .from(testimonial)
      .where(and(published(testimonial.status), eq(testimonial.verified, true)))
      .orderBy(asc(testimonial.sortOrder), asc(testimonial.id)),
    db
      .select({
        id: journey.id,
        studentName: journey.studentName,
        country: journey.country,
        universityId: journey.universityId,
        summary: journey.summary,
        verified: journey.verified,
        consentId: journey.consentId,
        translations: journey.translations,
      })
      .from(journey)
      .where(and(published(journey.status), eq(journey.verified, true)))
      .orderBy(asc(journey.sortOrder), asc(journey.id)),
    db
      .select({ journeyId: journeyStep.journeyId, position: journeyStep.position, title: journeyStep.title, body: journeyStep.body, dateLabel: journeyStep.dateLabel })
      .from(journeyStep)
      .orderBy(asc(journeyStep.journeyId), asc(journeyStep.position)),
    db
      .select({ id: teamMember.id, name: teamMember.name, roleTitle: teamMember.roleTitle, bio: teamMember.bio, photoMediaId: teamMember.photoMediaId, confirmed: teamMember.confirmed, translations: teamMember.translations })
      .from(teamMember)
      .where(and(published(teamMember.status), eq(teamMember.confirmed, true)))
      .orderBy(asc(teamMember.sortOrder), asc(teamMember.name)),
    db.select({ id: university.id, name: university.name }).from(university).where(published(university.status)),
    readMediaQuery(db),
  );
  return { stats, testimonials, journeys, steps, team, universities, media };
}

/** Published posts, newest first. */
export async function readPostRows(db: Db) {
  const [posts, media] = await runPublic(
    db,
    db
      .select({ slug: post.slug, title: post.title, body: post.body, coverMediaId: post.coverMediaId, publishedAt: post.publishedAt, translations: post.translations })
      .from(post)
      .where(published(post.status))
      .orderBy(desc(post.publishedAt), asc(post.slug)),
    readMediaQuery(db),
  );
  return { posts, media };
}

export type CatalogueRows = Awaited<ReturnType<typeof readCatalogueRows>>;
export type SiteRows = Awaited<ReturnType<typeof readSiteRows>>;
export type TrustRows = Awaited<ReturnType<typeof readTrustRows>>;
export type PostRows = Awaited<ReturnType<typeof readPostRows>>;

