import { AwsClient } from "aws4fetch";
import { sha256Hex } from "@/lib/hash";

/**
 * Image storage (ADR-011, ADR-039): a Neon Object Storage bucket named `images`, public-read.
 *
 *  - Reads are a plain `fetch` of the public object URL. No signing, no credential, no database.
 *  - Writes are S3 `PutObject` requests signed with a Neon credential (SigV4, path-style).
 *  - The key is the content hash (`<sha256>.webp`), and `put` refuses bytes whose hash differs from the key. An object
 *    therefore never changes once written, an upload of an existing image is harmless, and there is deliberately no
 *    delete or overwrite method (decision D17). Only `server/media` imports this file's credential config.
 */

export const MEDIA_BUCKET = "images";
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // the cap in FR-18 is lower; this is the hard ceiling the store accepts

const SHA256 = /^[a-f0-9]{64}$/;

export interface MediaStoreConfig {
  /** `AWS_ENDPOINT_URL_S3` of the branch, for example `https://<branch>.storage.<n>.<region>.aws.neon.tech`. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket?: string;
}

export interface MediaStore {
  publicUrl(sha256: string): string;
  /** The image, or null if no object has this hash. Throws `MediaStoreError` on any other failure. */
  get(sha256: string): Promise<Response | null>;
  /** Stores the bytes under their own hash. Throws if the bytes do not hash to `sha256`. */
  put(sha256: string, data: Uint8Array): Promise<void>;
}

export class MediaStoreError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MediaStoreError";
  }
}

export function mediaKey(sha256: string): string {
  if (!SHA256.test(sha256)) throw new MediaStoreError("Not a SHA-256 hash");
  return `${sha256}.webp`;
}

export function createMediaStore(config: MediaStoreConfig, fetchImpl: typeof fetch = fetch): MediaStore {
  const bucket = config.bucket ?? MEDIA_BUCKET;
  const base = config.endpoint.replace(/\/+$/, "");
  const url = (sha256: string) => `${base}/${bucket}/${mediaKey(sha256)}`;
  const signer = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });

  return {
    publicUrl: url,

    async get(sha256) {
      let response: Response;
      try {
        response = await fetchImpl(url(sha256));
      } catch {
        throw new MediaStoreError("Storage is not reachable");
      }
      if (response.status === 404 || response.status === 403) return null; // a missing key answers 404 (or 403 on some S3 stores)
      if (!response.ok) throw new MediaStoreError("Storage read failed", response.status);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_IMAGE_BYTES) throw new MediaStoreError("Stored image is larger than the allowed size");
      return response;
    },

    async put(sha256, data) {
      if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) throw new MediaStoreError("Image size is outside the allowed range");
      if ((await sha256Hex(data)) !== sha256) throw new MediaStoreError("The image does not match its hash");
      let response: Response;
      try {
        response = await signer.fetch(url(sha256), {
          method: "PUT",
          body: data as BodyInit,
          headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" },
        });
      } catch {
        throw new MediaStoreError("Storage is not reachable");
      }
      if (!response.ok) throw new MediaStoreError("Storage write failed", response.status);
    },
  };
}
