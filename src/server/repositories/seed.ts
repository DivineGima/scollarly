import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { campusExperience, contentBlock, faq, feeStructure, officialResource, pageImage, processStep, programme, siteSetting, university } from "@/server/db/schema";

/**
 * Inserts the seed rows (S1.7). It is run by `scripts/seed.ts` with the OWNER database role, which is how migrations run
 * (architecture 13.3): the runtime role cannot write content without a signed-in staff member, and a one-off script has none.
 *
 * Insert-only and idempotent: every row has a deterministic id (`src/modules/seed/ids.ts`), and a row that already exists
 * is left exactly as it is (`ON CONFLICT DO NOTHING`), so a second run changes nothing and never overwrites an edit made
 * later in the admin screens.
 */

export interface SeedRows {
  universities: (typeof university.$inferInsert)[];
  programmes: (typeof programme.$inferInsert)[];
  feeStructures: (typeof feeStructure.$inferInsert)[];
  campusExperiences: (typeof campusExperience.$inferInsert)[];
  officialResources: (typeof officialResource.$inferInsert)[];
  faqs: (typeof faq.$inferInsert)[];
  processSteps: (typeof processStep.$inferInsert)[];
  contentBlocks: (typeof contentBlock.$inferInsert)[];
  pageImages: (typeof pageImage.$inferInsert)[];
  siteSettings: { key: string; value: unknown }[];
}

/** Rows newly inserted per table. A second run reports zeros. */
export type SeedReport = Record<keyof SeedRows, number>;

const CHUNK = 100;

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

export async function applySeed(db: Db, rows: SeedRows): Promise<SeedReport> {
  const report: SeedReport = {
    universities: 0,
    programmes: 0,
    feeStructures: 0,
    campusExperiences: 0,
    officialResources: 0,
    faqs: 0,
    processSteps: 0,
    contentBlocks: 0,
    pageImages: 0,
    siteSettings: 0,
  };

  // Parents before children, so every foreign key resolves.
  for (const batch of chunks(rows.universities)) report.universities += (await db.insert(university).values(batch).onConflictDoNothing().returning({ id: university.id })).length;
  for (const batch of chunks(rows.programmes))
    report.programmes += (
      await db
        .insert(programme)
        .values(batch)
        // Version 2: a programme row that already exists gets its course field and level filled in once (they were empty before), and
        // is never overwritten after that, so an admin's edit stays. A second run therefore reports zero.
        .onConflictDoUpdate({
          target: programme.id,
          set: { field: sql`coalesce(${programme.field}, excluded.field)`, level: sql`coalesce(${programme.level}, excluded.level)`, updatedAt: sql`now()` },
          setWhere: sql`(${programme.field} is null and excluded.field is not null) or (${programme.level} is null and excluded.level is not null)`,
        })
        .returning({ id: programme.id })
    ).length;
  for (const batch of chunks(rows.feeStructures)) report.feeStructures += (await db.insert(feeStructure).values(batch).onConflictDoNothing().returning({ id: feeStructure.id })).length;
  for (const batch of chunks(rows.campusExperiences)) report.campusExperiences += (await db.insert(campusExperience).values(batch).onConflictDoNothing().returning({ id: campusExperience.id })).length;
  for (const batch of chunks(rows.officialResources)) report.officialResources += (await db.insert(officialResource).values(batch).onConflictDoNothing().returning({ id: officialResource.id })).length;
  for (const batch of chunks(rows.faqs)) report.faqs += (await db.insert(faq).values(batch).onConflictDoNothing().returning({ id: faq.id })).length;
  for (const batch of chunks(rows.processSteps)) report.processSteps += (await db.insert(processStep).values(batch).onConflictDoNothing().returning({ id: processStep.id })).length;
  for (const batch of chunks(rows.contentBlocks)) report.contentBlocks += (await db.insert(contentBlock).values(batch).onConflictDoNothing().returning({ id: contentBlock.id })).length;
  for (const batch of chunks(rows.pageImages)) report.pageImages += (
      await db
        .insert(pageImage)
        .values(batch)
        // A changed file for an existing slot replaces its photo (there is no admin screen for page photos); an unchanged one is left alone, so a second run reports zero.
        .onConflictDoUpdate({ target: pageImage.key, set: { mediaAssetId: sql`excluded.media_asset_id`, updatedAt: sql`now()` }, setWhere: sql`${pageImage.mediaAssetId} <> excluded.media_asset_id` })
        .returning({ id: pageImage.id })
    ).length;

  // A setting is filled only while it is still "not set" (JSON null); a value an admin has set is left alone.
  for (const s of rows.siteSettings) {
    const written = await db
      .insert(siteSetting)
      .values({ key: s.key, value: sql`${JSON.stringify(s.value)}::jsonb` })
      .onConflictDoUpdate({ target: siteSetting.key, set: { value: sql`excluded.value` }, setWhere: sql`${siteSetting.value} = 'null'::jsonb` })
      .returning({ key: siteSetting.key });
    report.siteSettings += written.length;
  }

  return report;
}
