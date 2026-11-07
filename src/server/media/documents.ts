import { AwsClient } from "aws4fetch";
import { type MediaStoreConfig, MediaStoreError } from "./store";

/**
 * Student documents (architecture 24.5, ADR-066, ADR-067): a Neon Object Storage bucket named `student-docs`, PRIVATE. Nothing here is ever
 * read through a public address. Like `store.ts`, this file is part of `server/media`, the only module that holds the storage credential.
 *
 *  - The browser sends the file straight to storage with a presigned PUT (the Worker only signs, so a 5 MB upload costs it no CPU). The
 *    signature binds the content type. It cannot bind the size, so `head` and `readHead` check the object afterwards, before it counts.
 *  - Staff and students read a file only through a short presigned GET that asks storage to serve it as an attachment, uncached.
 *  - The key is `<student id>/<document id>`, never a file name. Nothing about a document is logged, and a signed URL is never logged.
 *  - Unlike the public `images` bucket (decision D17), documents are deleted: by the daily purge and by erasure.
 */

export const DOCUMENTS_BUCKET = "student-docs";

/** A student id (any id Neon Auth issues) and a document id (a UUID): the only shape of key this store will sign. */
const KEY = /^[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const UPLOAD_LINK_SECONDS = 600;
export const DOWNLOAD_LINK_SECONDS = 300;

export function documentKey(studentId: string, documentId: string): string {
  const key = `${studentId}/${documentId}`;
  if (!KEY.test(key)) throw new MediaStoreError("Not a document key");
  return key;
}

export interface SignedUpload {
  url: string;
  /** The headers the browser must send with the PUT, exactly as given: the signature covers them. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface DocumentStore {
  signUpload(key: string, contentType: string): Promise<SignedUpload>;
  /** A link that serves the object as an attachment, for `DOWNLOAD_LINK_SECONDS`. */
  signDownload(key: string): Promise<{ url: string; expiresInSeconds: number }>;
  /** The size of the object, or null when there is none. */
  head(key: string): Promise<{ size: number } | null>;
  /** The first `length` bytes, or null when there is no object. */
  readHead(key: string, length: number): Promise<Uint8Array | null>;
  /** Deleting an object that is already gone is not an error. */
  deleteObject(key: string): Promise<void>;
}

export function createDocumentStore(config: MediaStoreConfig, fetchImpl: typeof fetch = fetch, bucket: string = DOCUMENTS_BUCKET): DocumentStore {
  const base = config.endpoint.replace(/\/+$/, "");
  const urlOf = (key: string) => {
    if (!KEY.test(key)) throw new MediaStoreError("Not a document key");
    return `${base}/${bucket}/${key}`;
  };
  const signer = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: "s3", region: config.region });

  /** A query-signed URL: `extra` is added to the query before signing, so it cannot be changed afterwards. */
  async function presign(method: "GET" | "PUT", key: string, seconds: number, extra: Record<string, string>, headers?: Record<string, string>): Promise<string> {
    const url = new URL(urlOf(key));
    url.searchParams.set("X-Amz-Expires", String(seconds));
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
    const signed = await signer.sign(url.toString(), { method, ...(headers ? { headers } : {}), aws: { signQuery: true, allHeaders: true } });
    return signed.url;
  }

  /** Signs the request (headers, not the query) and sends it with the injected `fetch`, so a test needs no network. */
  async function send(url: string, init: { method: string; headers?: Record<string, string> }): Promise<Response> {
    try {
      return await fetchImpl(await signer.sign(url, init));
    } catch {
      throw new MediaStoreError("Storage is not reachable");
    }
  }

  return {
    async signUpload(key, contentType) {
      const headers = { "content-type": contentType };
      return { url: await presign("PUT", key, UPLOAD_LINK_SECONDS, {}, headers), headers, expiresInSeconds: UPLOAD_LINK_SECONDS };
    },

    async signDownload(key) {
      const url = await presign("GET", key, DOWNLOAD_LINK_SECONDS, {
        "response-content-disposition": "attachment",
        "response-cache-control": "no-store",
      });
      return { url, expiresInSeconds: DOWNLOAD_LINK_SECONDS };
    },

    async head(key) {
      const response = await send(urlOf(key), { method: "HEAD" });
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new MediaStoreError("Storage read failed", response.status);
      return { size: Number(response.headers.get("content-length") ?? 0) };
    },

    async readHead(key, length) {
      const response = await send(urlOf(key), { method: "GET", headers: { range: `bytes=0-${Math.max(0, length - 1)}` } });
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new MediaStoreError("Storage read failed", response.status);
      return new Uint8Array(await response.arrayBuffer()).subarray(0, length);
    },

    async deleteObject(key) {
      const response = await send(urlOf(key), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new MediaStoreError("Storage delete failed", response.status);
    },
  };
}
