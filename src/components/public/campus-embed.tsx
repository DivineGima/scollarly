"use client";

import { useState } from "react";
import { youtubeEmbedUrl } from "@/modules/content/embed";

export interface CampusEmbedProps {
  kind: "video" | "tour360" | "gallery";
  title: string;
  youtubeId: string | null;
  url: string | null;
  thumbnail: { src: string; width: number; height: number; alt: string } | null;
  labels: {
    play: string;
    openTour: string;
    needsConnection: string;
    dataNotice: string;
    dataNoticeConfirm: string;
    viewGallery: string;
    noThumbnail: string;
  };
}

/**
 * Thumbnail first (FR-3, architecture 16 A3). Nothing from YouTube or a tour host loads until the visitor taps:
 * the page holds only our own thumbnail (or a text placeholder, never a hotlinked picture) and a button. A video then
 * opens in place from `youtube-nocookie.com`; a 360 tour first shows a data-use notice and opens after a second tap.
 * Offline, the tap says "Needs connection" instead of showing a broken frame.
 */
export function CampusEmbed({ kind, title, youtubeId, url, thumbnail, labels }: CampusEmbedProps) {
  const [phase, setPhase] = useState<"idle" | "notice" | "open" | "offline">("idle");
  const src = kind === "video" ? youtubeEmbedUrl(youtubeId) : kind === "tour360" ? url : null;

  function start() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setPhase("offline");
    setPhase(kind === "tour360" ? "notice" : "open");
  }

  if (kind === "gallery") {
    return (
      <figure className="embed">
        <Poster title={title} thumbnail={thumbnail} placeholder={labels.noThumbnail} />
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
            {labels.viewGallery}
          </a>
        ) : null}
        <figcaption>{title}</figcaption>
      </figure>
    );
  }

  if (!src) return null;

  return (
    <figure className="embed">
      {phase === "open" ? (
        <div className="frame">
          <iframe
            src={src}
            title={title}
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            {...(kind === "tour360" ? { sandbox: "allow-scripts allow-same-origin allow-popups allow-pointer-lock" } : {})}
          />
        </div>
      ) : (
        <>
          <Poster title={title} thumbnail={thumbnail} placeholder={labels.noThumbnail} />
          {phase === "notice" ? (
            <div role="alert" className="notice">
              <p>{labels.dataNotice}</p>
              <button type="button" className="btn btn-primary" onClick={() => setPhase("open")}>
                {labels.dataNoticeConfirm}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={start}>
              {kind === "video" ? labels.play : labels.openTour}
              <span className="sr-only">: {title}</span>
            </button>
          )}
          {phase === "offline" ? (
            <p role="status" className="muted">
              {labels.needsConnection}
            </p>
          ) : null}
        </>
      )}
      <figcaption>{title}</figcaption>
    </figure>
  );
}

function Poster({ title, thumbnail, placeholder }: { title: string; thumbnail: CampusEmbedProps["thumbnail"]; placeholder: string }) {
  return thumbnail ? (
    // eslint-disable-next-line @next/next/no-img-element -- our own stored image (architecture 6.5)
    <img src={thumbnail.src} width={thumbnail.width} height={thumbnail.height} alt={thumbnail.alt || title} loading="lazy" decoding="async" className="poster" />
  ) : (
    <div className="poster poster-placeholder" aria-hidden="true">
      {placeholder}
    </div>
  );
}
