/**
 * S14.6 (PRD_3 F22, architecture 22.6): copies the preview image of each campus tour video into our own files, so no page loads an image from
 * another site (CLAUDE.md: no hotlinked images). Run once when a tour video is added or changed:
 *
 *   node scripts/ops/fetch-tour-thumbnails.mjs
 *
 * It reads `data/seed/tour-videos.json` (the list of verified videos), downloads each public preview picture once, converts it to WebP and
 * writes it to `data/seed/tour-thumbs/<slug>.webp`. The seed script then imports those files through the media store like any other
 * image. A video that cannot be read is reported and skipped, never replaced by a guess.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = new URL("../../data/seed/", import.meta.url);
const list = JSON.parse(await readFile(new URL("tour-videos.json", ROOT), "utf8"));
const outDir = fileURLToPath(new URL("tour-thumbs/", ROOT));
await mkdir(outDir, { recursive: true });

let failed = 0;
for (const entry of list.videos) {
  const url = `https://i.ytimg.com/vi/${entry.youtube_id}/hqdefault.jpg`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const webp = await sharp(bytes).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    await writeFile(join(outDir, `${entry.slug}.webp`), webp);
    console.log(`${entry.slug}: ${webp.length} bytes`);
  } catch (error) {
    failed += 1;
    console.error(`${entry.slug}: could not copy the preview (${error instanceof Error ? error.message : error})`);
  }
}
process.exit(failed === 0 ? 0 : 1);
