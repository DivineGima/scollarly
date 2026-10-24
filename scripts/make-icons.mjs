#!/usr/bin/env node
/**
 * Makes the installable-app icons (S4.1) from a drawn letter S on the brand blue (the same look as `src/app/icon.svg`): 192 and 512 pixel PNGs, and a 512 pixel "maskable"
 * icon with the letter inside the safe zone. Run once; the PNGs are committed under `public/icons`.
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

// The letter is drawn as a path, not typed as text, so it looks the same on every machine that runs this script.
const letter = `<path d="M21.2 10.4C20.6 8.2 18.6 7 16 7c-3 0-5 1.4-5 3.7 0 5.2 10.3 2.8 10.3 9.4 0 2.6-2.2 4.9-5.6 4.9-3 0-5.2-1.4-5.9-3.7" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>`;
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1d4ed8"/>${letter}</svg>`);
mkdirSync("public/icons", { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(`public/icons/icon-${size}.png`, await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
}

// Maskable: a full-bleed blue square with the letter at 60% so any platform mask keeps it.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1d4ed8"/><g transform="translate(16 16) scale(0.62) translate(-16 -16)">${letter}</g></svg>`;
writeFileSync("public/icons/maskable-512.png", await sharp(Buffer.from(maskable), { density: 384 }).resize(512, 512).png({ compressionLevel: 9 }).toBuffer());
console.log("icons written to public/icons");
