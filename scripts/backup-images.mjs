#!/usr/bin/env node
/**
 * Copies the pictures from the public image bucket to a folder on your own disk, and checks each one (S10.3, decision D17).
 *
 *   node scripts/backup-images.mjs --manifest scollarly-export-2026-10-26.json --base-url https://<branch>.storage.<n>.<region>.aws.neon.tech/images --out D:/scollarly-images
 *
 *  --manifest   the full export from Settings (or a JSON list of media_asset rows, or a text file with one hash per line)
 *  --base-url   the public address of the `images` bucket (or set IMAGES_PUBLIC_BASE_URL)
 *  --out        the folder to keep the copy in (default ./image-backup)
 *  --fast       do not re-check pictures that are already on disk (default: every file is hashed again)
 *
 * It needs no password and no key. Run it monthly and after any bulk upload (tracker H14). It only ever adds files to the folder; it never
 * deletes a good copy. Exit code 0 means every picture of the manifest is on disk and matches its hash.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { backupImages, readManifest, summarise } from "./lib/image-backup.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    "base-url": { type: "string" },
    out: { type: "string", default: "image-backup" },
    fast: { type: "boolean", default: false },
  },
});

const baseUrl = values["base-url"] ?? process.env.IMAGES_PUBLIC_BASE_URL;
if (!values.manifest || !baseUrl) {
  console.error("Usage: node scripts/backup-images.mjs --manifest <export.json> --base-url <https://.../images> [--out <folder>] [--fast]");
  process.exit(2);
}

try {
  const hashes = readManifest(await readFile(values.manifest, "utf8"));
  const result = await backupImages({ hashes, baseUrl, out: values.out, verifyExisting: !values.fast, log: (line) => console.log(line) });
  const { lines, exitCode } = summarise(result);
  console.log(lines.join("\n"));
  process.exit(exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
