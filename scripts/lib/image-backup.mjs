/**
 * The logic behind `scripts/backup-images.mjs` (S10.3, decision D17), kept here so it can be unit tested without a network. The owner runs the
 * script now and then to keep a copy of the pictures on their own disk. It needs no password: the bucket is public-read, and each object's
 * name IS the SHA-256 of its bytes (`<sha256>.webp`, `src/server/media/store.ts`), so every copy can be checked against the name it
 * was fetched under and against the `media_asset` manifest.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SHA256 = /^[a-f0-9]{64}$/;

/**
 * The hashes that must exist, from what the owner has: the full export (`tables.media_asset`), a JSON list of `media_asset` rows (each with
 * `sha256`), or a plain text file with one hash per line. Anything else is refused, because backing up from a wrong file would look fine and
 * protect nothing. Duplicates are removed; the order is kept.
 */
export function readManifest(text) {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed === "") throw new Error("The manifest file is empty.");
  let hashes;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new Error("The manifest is not valid JSON.");
    }
    const rows = Array.isArray(json) ? json : json?.tables?.media_asset;
    if (!Array.isArray(rows)) throw new Error("The JSON has no media_asset rows. Use the full export from Settings, or a list of rows.");
    hashes = rows.map((row) => (typeof row === "string" ? row : row?.sha256));
  } else {
    hashes = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  const bad = hashes.filter((hash) => typeof hash !== "string" || !SHA256.test(hash));
  if (bad.length > 0) throw new Error(`The manifest has ${bad.length} entr${bad.length === 1 ? "y" : "ies"} that ${bad.length === 1 ? "is" : "are"} not a SHA-256 hash.`);
  return [...new Set(hashes)];
}

export const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** `https://host/images` -> `https://host/images/<hash>.webp`. The base must be https (a copy fetched over plain http could be altered on the way). */
export function objectUrl(baseUrl, hash) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
    throw new Error("The base URL must start with https://");
  }
  return `${base.origin}${base.pathname.replace(/\/+$/, "")}/${hash}.webp`;
}

/**
 * Makes `out` hold every picture of the manifest. For each hash: a copy already on disk is hashed and kept if it is right and replaced if
 * it is not; a missing one is downloaded, hashed, and written only if the bytes match their name. The result lists what could not be
 * made whole, which is what the owner has to look at.
 *
 * `fetchImpl`, `deps` (file system) and `log` are injected for tests.
 */
export async function backupImages({ hashes, baseUrl, out, fetchImpl = fetch, log = () => {}, verifyExisting = true, concurrency = 4 }) {
  await mkdir(out, { recursive: true });
  const present = new Set((await readdir(out)).filter((name) => /^[a-f0-9]{64}\.webp$/.test(name)).map((name) => name.slice(0, 64)));
  const result = { total: hashes.length, kept: 0, downloaded: 0, replacedCorrupt: [], missingRemote: [], corruptRemote: [], failed: [], extraLocal: [...present].filter((h) => !hashes.includes(h)) };

  async function one(hash) {
    const path = join(out, `${hash}.webp`);
    if (present.has(hash)) {
      if (!verifyExisting) {
        result.kept += 1;
        return;
      }
      if (sha256Of(await readFile(path)) === hash) {
        result.kept += 1;
        return;
      }
      result.replacedCorrupt.push(hash);
      log(`corrupt copy on disk, fetching again: ${hash}`);
    }
    let response;
    try {
      response = await fetchImpl(objectUrl(baseUrl, hash));
    } catch {
      result.failed.push(hash);
      return;
    }
    if (response.status === 404 || response.status === 403) {
      result.missingRemote.push(hash);
      return;
    }
    if (!response.ok) {
      result.failed.push(hash);
      return;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256Of(bytes) !== hash) {
      // The stored object is not the picture its name says. Nothing is written, so the bad bytes never look like a good copy.
      result.corruptRemote.push(hash);
      return;
    }
    const temp = `${path}.part`;
    await writeFile(temp, bytes);
    await rename(temp, path);
    result.downloaded += 1;
  }

  const queue = [...hashes];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, async () => {
      for (let hash = queue.shift(); hash !== undefined; hash = queue.shift()) await one(hash);
    }),
  );
  // A replaced copy that could not be fetched again is now missing, not merely corrupt: the old bytes are removed so they are not trusted later.
  for (const hash of result.replacedCorrupt) {
    if (result.missingRemote.includes(hash) || result.corruptRemote.includes(hash) || result.failed.includes(hash)) await rm(join(out, `${hash}.webp`), { force: true });
  }
  return result;
}

/** The lines the script prints. Exit code 0 only when every picture of the manifest is on disk and checked. */
export function summarise(result) {
  const problems = result.missingRemote.length + result.corruptRemote.length + result.failed.length;
  const lines = [
    `Pictures in the manifest: ${result.total}`,
    `Already on disk and correct: ${result.kept}`,
    `Downloaded now: ${result.downloaded}`,
  ];
  if (result.replacedCorrupt.length) lines.push(`Corrupt copies replaced: ${result.replacedCorrupt.length}`);
  if (result.extraLocal.length) lines.push(`On disk but not in the manifest (left alone): ${result.extraLocal.length}`);
  if (result.missingRemote.length) lines.push(`MISSING in the bucket: ${result.missingRemote.length}`, ...result.missingRemote.slice(0, 20).map((h) => `  ${h}`));
  if (result.corruptRemote.length) lines.push(`CORRUPT in the bucket (bytes do not match the name): ${result.corruptRemote.length}`, ...result.corruptRemote.slice(0, 20).map((h) => `  ${h}`));
  if (result.failed.length) lines.push(`Could not be fetched (network or server error, try again): ${result.failed.length}`, ...result.failed.slice(0, 20).map((h) => `  ${h}`));
  lines.push(problems === 0 ? "RESULT: every picture is on disk and checked." : `RESULT: ${problems} picture${problems === 1 ? "" : "s"} could not be copied. See above and docs/recovery.md.`);
  return { lines, exitCode: problems === 0 ? 0 : 1 };
}
