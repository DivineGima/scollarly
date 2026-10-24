import type { MediaRef } from "@/modules/content/types";

/**
 * A stored image (architecture 6.5): a plain `<img>` with its real size, lazy and async, from our own `/media/<hash>.webp`.
 * Never a hotlinked picture. With no image the caller shows a text placeholder instead.
 */
export function MediaImage({ media, className, eager = false }: { media: MediaRef; className?: string; eager?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the Next.js image optimiser is not used on this platform (architecture 6.5)
    <img
      src={`/media/${media.sha256}.webp`}
      width={media.width}
      height={media.height}
      alt={media.alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
