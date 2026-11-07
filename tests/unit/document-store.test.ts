import { describe, expect, it } from "vitest";
import { createDocumentStore, documentKey } from "@/server/media/documents";

const CONFIG = { endpoint: "https://br-test.storage.c-7.eu-central-1.aws.neon.tech", region: "eu-central-1", accessKeyId: "AKTEST", secretAccessKey: "secret" };
const STUDENT = "0190a3b2-1111-7222-8333-444455556666";
const DOC = "0190a3b2-aaaa-7bbb-8ccc-ddddeeeeffff";

describe("documentKey", () => {
  it("is the student id and the document id, never a file name", () => {
    expect(documentKey(STUDENT, DOC)).toBe(`${STUDENT}/${DOC}`);
  });

  it("refuses anything that could climb out of the student's folder", () => {
    expect(() => documentKey("../other", DOC)).toThrow();
    expect(() => documentKey(STUDENT, "passport.pdf")).toThrow();
    expect(() => documentKey(`${STUDENT}/x`, DOC)).toThrow();
  });
});

describe("the document store", () => {
  const store = createDocumentStore(CONFIG, (() => Promise.reject(new Error("no network in a unit test"))) as typeof fetch);
  const key = documentKey(STUDENT, DOC);

  it("signs an upload to the private bucket with the content type bound and a short life", async () => {
    const signed = await store.signUpload(key, "image/png");
    const url = new URL(signed.url);
    expect(url.pathname).toBe(`/student-docs/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.headers).toEqual({ "content-type": "image/png" });
  });

  it("signs a download for five minutes that asks storage for an attachment that is not cached", async () => {
    const signed = await store.signDownload(key);
    const url = new URL(signed.url);
    expect(signed.expiresInSeconds).toBe(300);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
    expect(url.searchParams.get("response-cache-control")).toBe("no-store");
  });

  it("reports an unreachable store as a storage error and never signs a bad key", async () => {
    await expect(store.head(key)).rejects.toThrow("Storage is not reachable");
    await expect(store.signDownload("../x/y")).rejects.toThrow("Not a document key");
  });
});
