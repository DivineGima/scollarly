#!/usr/bin/env node
/**
 * Makes the app icon set (S13.7, architecture 21.12, ADR-048) from the traced logo: the white mark `public/brand/logo-white.svg` on the
 * dark neon blue the owner confirmed (R4). Build-time only, so there is no runtime dependency; the outputs are committed.
 *
 *   public/icons/icon-192.png, icon-512.png   the manifest's ordinary icons
 *   public/icons/maskable-512.png             the mark inside the safe zone, so any platform mask keeps all of it
 *   public/icons/apple-touch-icon.png         180 px, full square (iOS rounds it itself)
 *   public/favicon.ico                        16, 32 and 48 px PNGs in one ICO file
 *   src/app/icon.svg                          the browser tab icon: the mark on a rounded blue square
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

export const BRAND_BLUE = "#1F3BFF";
const LOGO = "public/brand/logo-white.svg";
const logoSvg = readFileSync(LOGO, "utf8");
const viewBox = /viewBox="([\d.\s-]+)"/.exec(logoSvg)?.[1].split(/\s+/).map(Number);
if (!viewBox || viewBox.length !== 4) throw new Error(`${LOGO} has no viewBox`);
const [, , vw, vh] = viewBox;
const aspect = vw / vh;

/** A square of the brand blue with the mark centred; `fraction` is the share of the width the mark takes. */
async function square(size, fraction) {
  const markWidth = Math.round(size * fraction);
  const markHeight = Math.round(markWidth / aspect);
  const mark = await sharp(Buffer.from(logoSvg), { density: Math.max(72, Math.round((72 * markWidth) / vw) * 2) })
    .resize(markWidth, markHeight)
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND_BLUE } })
    .composite([{ input: mark, left: Math.round((size - markWidth) / 2), top: Math.round((size - markHeight) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, await square(size, 0.6));
// Maskable: platforms crop to a circle or rounded square; the safe zone is the inner 80%, and the mark's corners sit inside it at 50% width.
writeFileSync("public/icons/maskable-512.png", await square(512, 0.5));
writeFileSync("public/icons/apple-touch-icon.png", await square(180, 0.6));

// favicon.ico: an ICO file may hold PNG images, so the three sizes are written as they are.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => square(size, 0.72)));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(sizes[i], at);
  header.writeUInt8(sizes[i], at + 1);
  header.writeUInt8(0, at + 2);
  header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(image.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += image.length;
});
writeFileSync("public/favicon.ico", Buffer.concat([header, ...images]));

// The tab icon is vector: the white mark's path on a rounded blue square.
const path = /<path[^>]* d="([^"]+)"/.exec(logoSvg)?.[1];
if (!path) throw new Error(`${LOGO} has no path`);
const scale = (32 * 0.62) / vw;
const tx = (32 - vw * scale) / 2 - viewBox[0] * scale;
const ty = (32 - vh * scale) / 2 - viewBox[1] * scale;
writeFileSync(
  "src/app/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${BRAND_BLUE}"/><path fill="#fff" fill-rule="evenodd" transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(5)})" d="${path}"/></svg>\n`,
);
console.log("icons written to public/icons, public/favicon.ico and src/app/icon.svg");
