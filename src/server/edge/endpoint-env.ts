import type { Db } from "@/server/db/client";
import type { MediaStore } from "@/server/media/store";

/**
 * What an endpoint (a data call or a mutation) needs from the Worker, already bound to the real bindings by
 * `authed-runtime.ts`. Endpoints take this instead of `CloudflareEnv`, so they are plain functions that tests call with a
 * test database and a fixed clock (ADR-040).
 */
export interface EndpointEnv {
  db: Db;
  /** The one email that may become the owner (architecture 9.3). May be empty in a test. */
  ownerEmail: string;
  /** Base64 of 32 random bytes; encrypts the owner's authenticator secret. */
  totpKey: string;
  now: () => Date;
  /** The image store (Neon Object Storage). Built on first use, so a request that never touches images pays nothing. */
  media?: () => MediaStore;
}
