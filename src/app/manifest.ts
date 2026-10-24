import type { MetadataRoute } from "next";

/**
 * The web app manifest (S4.1): what makes Scollarly installable on a phone. Served at `/manifest.webmanifest` and linked from
 * every page by Next.js. The icons are made by `scripts/make-icons.mjs` and committed under `public/icons`.
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
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
