import type { MetadataRoute } from "next";

/**
 * The web app manifest (S4.1): what makes Scollarly installable on a phone. Served at `/manifest.webmanifest` and linked from
 * every page by Next.js. The icons are made by `scripts/make-icons.mjs` from the traced logo (white on the owner's dark neon blue, S13.7) and committed under `public/icons`. The launch screen is the icon on `background_color`: no script, no delay.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scollarly",
    short_name: "Scollarly",
    description: "Study in India from Africa. Apply and chat with an adviser on WhatsApp.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1F3BFF",
    theme_color: "#1F3BFF",
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
