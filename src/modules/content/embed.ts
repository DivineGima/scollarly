import { YOUTUBE_ID_PATTERN } from "@/lib/constants";

/**
 * Video and tour facades (FR-3, architecture 16 A3): nothing from YouTube or a tour host loads until the visitor taps.
 * These helpers decide what a tap may load. The video uses the privacy-enhanced host `youtube-nocookie.com`.
 */

export function isYoutubeId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_ID_PATTERN.test(value);
}

/** The embed address for a valid id, or null. The id is validated again here, so a bad value can never reach an iframe. */
export function youtubeEmbedUrl(id: unknown): string | null {
  return isYoutubeId(id) ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1` : null;
}

/** An https address with a host and no credentials, in its normal form; anything else (http, javascript:, data:) is refused. */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return url.href;
}
