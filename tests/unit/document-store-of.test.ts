import { describe, expect, it } from "vitest";
import { documentStoreOf, type EndpointEnv } from "@/server/edge/endpoint-env";
import type { DocumentStore } from "@/server/media/documents";

const base = { db: {} as EndpointEnv["db"], ownerEmail: "", totpKey: "", now: () => new Date() };

describe("documentStoreOf", () => {
  it("gives the store when it is configured", () => {
    const store = {} as DocumentStore;
    expect(documentStoreOf({ ...base, documents: () => store })).toBe(store);
  });

  it("gives null when there is none, or when building it throws (missing secrets), so a caller after an erasure never fails", () => {
    expect(documentStoreOf(base)).toBeNull();
    expect(
      documentStoreOf({
        ...base,
        documents: () => {
          throw new Error("storage secrets are missing");
        },
      }),
    ).toBeNull();
  });
});
