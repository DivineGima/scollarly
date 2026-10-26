"use client";

import { useTranslations } from "next-intl";
import { api } from "@/lib/client/api";
import { type ContentTypeKey, isContentType } from "@/modules/content-admin/definitions";
import { Badge } from "../ui/badge";

/** What a change tells the screen to refresh on the public site (S6.4). Declared here so the browser bundle stays free of server code. */
export interface Revalidate {
  areas: string[];
  paths: string[];
}

export type Status = "draft" | "published" | "archived";

const WAIT_MS = 1500;

/**
 * After a change that touched the public site, one small second request marks the pages stale and drops their edge copies (S6.4).
 * The first request after a deploy can be refused for CPU, so it is tried a second time. Returns whether the site was told. If it
 * was not, the change is still saved and the site catches up on its own (the edge copy expires in 30 seconds, pages regenerate hourly).
 */
export async function refreshPublicSite(revalidate: Revalidate | null | undefined): Promise<boolean> {
  if (!revalidate || revalidate.areas.length === 0) return true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await api<unknown>("POST", "/api/v1/admin/revalidate", revalidate);
    if (result.ok) return true;
    if (result.status === 401 || result.status === 403) return false;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
  return false;
}

const LOCALE_PREFIX = /^\/en(?=\/)/;

/** The content type and the item id from the address. The shell is the same for every item, so both are read in the browser. */
export function contentRoute(pathname: string): { type: ContentTypeKey | null; id: string | null } {
  const parts = pathname.replace(LOCALE_PREFIX, "").split("/").filter(Boolean);
  // ["admin", "content", <type>, <id | "new">]
  const type = parts[2] ?? "";
  const id = parts[3] ?? null;
  return { type: isContentType(type) ? type : null, id };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations("admin.content.status");
  return <Badge variant={status === "published" ? "success" : status === "archived" ? "default" : "warning"}>{t(status)}</Badge>;
}

/** The message for a failed request, from the error envelope's `code` and `fields` tokens (the server sends tokens, never sentences, FR-15). */
export function failureKey(result: { status: number; code: string; fields: Record<string, string> }): "network" | "stale" | "archived" | "forbidden" | "notFound" | "storage" | "tooBig" | "generic" {
  if (result.status === 0) return "network";
  if (result.code === "CONFLICT" && result.fields.version === "STALE") return "stale";
  if (result.code === "CONFLICT" && result.fields.status === "ARCHIVED") return "archived";
  if (result.code === "NOT_FOUND") return "notFound";
  if (result.status === 401 || result.status === 403) return "forbidden";
  if (result.code === "TEMPORARILY_UNAVAILABLE") return "storage";
  if (result.code === "PAYLOAD_TOO_LARGE") return "tooBig";
  return "generic";
}

/** `/media/<hash>.webp`, the only way a page or the admin shows an uploaded picture (no hotlinking, no optimiser). */
export const mediaSrc = (sha256: string) => `/media/${sha256}.webp`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
