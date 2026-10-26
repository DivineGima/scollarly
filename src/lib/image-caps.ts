/**
 * Image size caps in bytes by `media_asset.kind` (FR-18, proposed [Mine, confirm]: 300 KB photos, 50 KB logos). The browser uses them to
 * shrink a picture until it fits; the server (`server/media/ingest.ts`) checks the same numbers again. One list, so they cannot drift.
 */
export const IMAGE_CAPS = {
  logo: 50 * 1024,
  photo: 300 * 1024,
  blog: 300 * 1024,
  testimonial: 300 * 1024,
  other: 300 * 1024,
} as const;
export type ImageKind = keyof typeof IMAGE_CAPS;

/** The longest side of the picture the browser makes, by kind. A logo is small; a photo does not need more than a phone screen. */
export const IMAGE_MAX_SIDE: Record<ImageKind, number> = { logo: 512, photo: 1280, blog: 1280, testimonial: 800, other: 1280 };
