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

/**
 * The longest side of the picture the browser makes, by kind. A logo is small; a photo does not need more than a phone
 * screen. `other` (page-level decorative photos, S12.1) is kept to 800: one of these can be the hero image, loaded
 * eagerly and counted against the 200 KB first-load page-weight budget, where the baseline page was already at
 * ~108 KB before any photo existed, leaving little room (tracker Session 3, finding 5). 800px at quality ~82 keeps a
 * real photo under ~50 KB instead of ~95 KB at 1280, which is the difference between fitting the budget and not.
 */
export const IMAGE_MAX_SIDE: Record<ImageKind, number> = { logo: 512, photo: 1280, blog: 1280, testimonial: 800, other: 800 };
